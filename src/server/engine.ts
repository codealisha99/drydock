import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config";
import { CreateRunInput, DomainError } from "./api-types";
import type { RunRow } from "./db";
import { createEventLog, type EventLog } from "./events";
import { RepoError, resolveRepo } from "./repos";
import { createStore, type Store } from "./store";
import { sandboxName, type SandboxOps } from "./sandbox";
import { RunQueue } from "./queue";
import { executeRun, type WorkerDeps } from "./worker";
import type { ModelClient } from "./model/types";
import type { deliverBranch } from "./git/deliver";

export interface EngineDeps {
  cfg: Config;
  db: DatabaseSync;
  sandboxOps: SandboxOps;
  modelFactory: () => ModelClient;
  deliver?: typeof deliverBranch;
  log?: (msg: string) => void;
}

export interface Engine {
  store: Store;
  events: EventLog;
  createRun(input: unknown): RunRow;
  sendMessage(runId: string, message: string): RunRow;
  cancelRun(runId: string): RunRow;
  /** Boot-time recovery: fail anything left queued/running and remove every managed container. */
  recover(): Promise<{ failedRuns: string[]; removedContainers: string[] }>;
  /** Removes containers of finished runs that have been idle longer than the TTL. */
  sweepIdle(now?: Date): Promise<string[]>;
  shutdown(): Promise<void>;
  queueStats(): { pending: number; active: number };
}

const FOLLOW_UP_STATUSES = ["needs_input", "succeeded", "failed"] as const;
const nowIso = () => new Date().toISOString();

export function createEngine(deps: EngineDeps): Engine {
  const { cfg, db, sandboxOps } = deps;
  const store = createStore(db);
  const events = createEventLog(db);
  const log = deps.log ?? (() => undefined);
  const workerDeps: WorkerDeps = { cfg, store, events, sandboxOps, modelFactory: deps.modelFactory, deliver: deps.deliver };

  const queue = new RunQueue({
    concurrency: cfg.concurrency,
    work: (runId, signal) => executeRun(workerDeps, runId, signal),
    onError: (runId, err) => {
      log(`run ${runId} crashed in worker: ${String(err)}`);
      store.updateRun(runId, { status: "failed", summary: "internal error; see server log" }, nowIso());
    },
  });

  const requireRun = (runId: string): RunRow => {
    const run = store.getRun(runId);
    if (!run) throw new DomainError(404, `run ${runId} not found`);
    return run;
  };

  const markCancelled = (runId: string) => {
    store.updateRun(runId, { status: "cancelled", summary: "Cancelled by user", container_name: null }, nowIso());
    events.append(runId, "status", { status: "cancelled", summary: "Cancelled by user" });
  };

  return {
    store,
    events,

    createRun(input) {
      const parsed = CreateRunInput.safeParse(input);
      if (!parsed.success) throw new DomainError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
      let repo;
      try {
        repo = resolveRepo(parsed.data.repo, parsed.data.delivery, cfg);
      } catch (err) {
        if (err instanceof RepoError) throw new DomainError(400, err.message);
        throw err;
      }
      const id = randomBytes(6).toString("hex");
      const now = nowIso();
      const run = store.insertRun({
        id,
        repo_input: repo.repoInput,
        clone_url: repo.cloneUrl,
        local_remote: repo.localRemote,
        base_branch: parsed.data.branch,
        work_branch: `drydock/run-${id}`,
        instruction: parsed.data.instruction,
        delivery: parsed.data.delivery,
        messages: [{ role: "user", content: [{ type: "text", text: parsed.data.instruction }] }],
        now,
      });
      events.append(id, "status", { status: "queued" });
      queue.enqueue(id);
      return run;
    },

    sendMessage(runId, message) {
      const run = requireRun(runId);
      if (!(FOLLOW_UP_STATUSES as readonly string[]).includes(run.status)) {
        throw new DomainError(409, `run is ${run.status}; follow-ups need a finished run`);
      }
      if (!run.container_name) throw new DomainError(409, "the sandbox for this run was cleaned up; start a new run");
      const messages = [...store.readMessages(run), { role: "user" as const, content: [{ type: "text" as const, text: message }] }];
      const now = nowIso();
      store.setMessages(runId, messages, now);
      store.updateRun(runId, { status: "queued", summary: null }, now);
      events.append(runId, "user_message", { text: message });
      events.append(runId, "status", { status: "queued" });
      queue.enqueue(runId);
      return requireRun(runId);
    },

    cancelRun(runId) {
      const run = requireRun(runId);
      if (run.status === "queued") {
        queue.cancelPending(runId);
        markCancelled(runId);
      } else if (run.status === "running") {
        if (!queue.abort(runId)) markCancelled(runId);
      } else {
        throw new DomainError(409, `run already ${run.status}`);
      }
      return requireRun(runId);
    },

    async recover() {
      const failedRuns = store.activeRunIds();
      for (const runId of failedRuns) {
        const summary = "Server restarted before this run finished";
        store.updateRun(runId, { status: "failed", summary, container_name: null }, nowIso());
        events.append(runId, "status", { status: "failed", summary });
      }
      const removedContainers = await sandboxOps.removeAll();
      store.clearContainerNames();
      return { failedRuns, removedContainers };
    },

    async sweepIdle(now = new Date()) {
      const cutoff = new Date(now.getTime() - cfg.idleTtlMs).toISOString();
      const swept: string[] = [];
      for (const run of store.idleSandboxRuns(cutoff)) {
        await sandboxOps.remove(sandboxName(run.id)).catch(() => undefined);
        store.updateRun(run.id, { container_name: null }, nowIso());
        swept.push(run.id);
      }
      return swept;
    },

    async shutdown() {
      queue.abortAll();
      await sandboxOps.removeAll();
    },

    queueStats: () => queue.stats(),
  };
}

