import type { Config } from "./config";
import type { RunRow, RunStatus } from "./db";
import type { EventLog, RunEventType } from "./events";
import { runAgent, SYSTEM_PROMPT } from "./agent";
import { cloneWorkspace, commitPending, diffSince, headSha, patchSince } from "./sandbox-git";
import { sandboxName, type Sandbox, type SandboxOps } from "./sandbox";
import type { DeliveryTarget } from "./git/deliver";
import { deliverBranch } from "./git/deliver";
import { parseGithubRepo } from "./git/github";
import type { ModelClient } from "./model/types";
import type { Store, RunPatch } from "./store";
import type { Outcome } from "./tools";

export interface WorkerDeps {
  cfg: Config;
  store: Store;
  events: EventLog;
  sandboxOps: SandboxOps;
  modelFactory: () => ModelClient;
  deliver?: typeof deliverBranch;
}

const nowIso = () => new Date().toISOString();
const firstLine = (s: string, max: number) => (s.split("\n")[0] ?? "").slice(0, max);

/** Gets the run's sandbox: a fresh one (clone + branch) for the first turn, the existing one for follow-ups. */
async function ensureSandbox(d: WorkerDeps, run: RunRow, signal: AbortSignal): Promise<Sandbox> {
  if (run.container_name) {
    if (!(await d.sandboxOps.isRunning(run.container_name))) throw new Error("the sandbox for this run no longer exists; start a new run");
    return d.sandboxOps.attach(run.container_name);
  }
  const name = sandboxName(run.id);
  const sandbox = await d.sandboxOps.start({ name, image: d.cfg.sandboxImage, runId: run.id });
  d.store.updateRun(run.id, { container_name: name }, nowIso());
  const baseSha = await cloneWorkspace(sandbox, { cloneUrl: run.clone_url, baseBranch: run.base_branch, workBranch: run.work_branch }, { signal });
  d.store.updateRun(run.id, { base_sha: baseSha, delivered_sha: baseSha }, nowIso());
  return sandbox;
}

function targetFor(d: WorkerDeps, run: RunRow): DeliveryTarget {
  if (run.delivery === "local") {
    if (!run.local_remote) throw new Error("local delivery has no bare repository path");
    return { kind: "local", remotePath: run.local_remote };
  }
  const gh = parseGithubRepo(run.clone_url);
  if (!gh || !d.cfg.githubToken) throw new Error("github delivery is not configured");
  return { kind: "github", owner: gh.owner, repo: gh.repo, token: d.cfg.githubToken };
}

/** Commits, records the diff, and (on success with changes) pushes the branch and records a PR. */
async function finalize(d: WorkerDeps, run: RunRow, sandbox: Sandbox, outcome: Outcome, emit: (t: RunEventType, data: unknown) => void, signal: AbortSignal): Promise<Outcome> {
  const baseSha = run.base_sha ?? "";
  await commitPending(sandbox, `drydock: ${firstLine(run.instruction, 60)}`, { signal });
  const head = await headSha(sandbox);
  const diff = await diffSince(sandbox, baseSha, { signal });
  if (diff.trim()) emit("diff", { diff, baseSha, headSha: head });
  if (outcome.status !== "succeeded") return outcome;
  if (!diff.trim()) {
    return { status: "needs_input", summary: "Finished without changing any files; confirm whether that is intended." };
  }
  const title = `drydock: ${firstLine(run.instruction, 72)}`;
  const body = `${outcome.summary}\n\nRun: ${run.id}\n\n${run.instruction}`;
  const patch = await patchSince(sandbox, run.delivered_sha ?? baseSha, { signal });
  // The diff above is cumulative; a follow-up may add nothing new since the last delivery.
  if (!patch.trim()) return outcome;
  const result = await (d.deliver ?? deliverBranch)(targetFor(d, run), {
    workBranch: run.work_branch,
    baseBranch: run.base_branch,
    patch,
    title,
    body,
    diff,
    openPullRequest: d.store.pullRequests(run.id).length === 0,
  });
  d.store.insertPullRequest({
    run_id: run.id, provider: result.provider, url: result.url, number: result.number, branch: result.branch,
    base_branch: result.baseBranch, title: result.title, diff: result.diff, now: nowIso(),
  });
  d.store.updateRun(run.id, { delivered_sha: head }, nowIso());
  emit("delivery", { provider: result.provider, url: result.url, number: result.number, branch: result.branch, baseBranch: result.baseBranch });
  return outcome;
}

async function discardSandbox(d: WorkerDeps, runId: string): Promise<void> {
  const name = sandboxName(runId);
  await d.sandboxOps.remove(name).catch(() => undefined);
  d.store.updateRun(runId, { container_name: null }, nowIso());
}

/** Runs one turn of a run (first turn or follow-up) and records its terminal state. */
export async function executeRun(d: WorkerDeps, runId: string, signal: AbortSignal): Promise<void> {
  const emit = (type: RunEventType, data: unknown) => {
    d.events.append(runId, type, data);
  };
  const setStatus = (status: RunStatus, extra: RunPatch = {}) => {
    d.store.updateRun(runId, { status, ...extra }, nowIso());
    emit("status", { status, ...(extra.summary ? { summary: extra.summary } : {}) });
  };

  const run = d.store.getRun(runId);
  if (!run || run.status === "cancelled") return;
  setStatus("running");
  const fresh = !run.container_name;
  try {
    const sandbox = await ensureSandbox(d, d.store.getRun(runId)!, signal);
    emit("status", { status: "running", message: "workspace ready" });
    const current = d.store.getRun(runId)!;
    const result = await runAgent(d.store.readMessages(current), {
      model: d.modelFactory(),
      sandbox,
      emit: (type, data) => emit(type, data),
      signal,
      maxSteps: d.cfg.maxSteps,
      system: SYSTEM_PROMPT,
    });
    d.store.setMessages(runId, result.messages, nowIso());
    const outcome = await finalize(d, current, sandbox, result.outcome, emit, signal);
    emit("outcome", outcome);
    setStatus(outcome.status, { summary: outcome.summary });
  } catch (err) {
    if (signal.aborted) {
      await discardSandbox(d, runId);
      setStatus("cancelled", { summary: "Cancelled by user" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    emit("error", { message });
    if (fresh) await discardSandbox(d, runId);
    setStatus("failed", { summary: message.slice(0, 200) });
  }
}

