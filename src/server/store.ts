import type { DatabaseSync } from "node:sqlite";
import type { PullRequestRow, RunRow, RunStatus } from "./db";
import type { Message } from "./model/types";

export type RunPatch = Partial<Pick<RunRow, "status" | "summary" | "base_sha" | "delivered_sha" | "container_name" | "local_remote">>;

export interface NewRun {
  id: string;
  repo_input: string;
  clone_url: string;
  local_remote: string | null;
  base_branch: string;
  work_branch: string;
  instruction: string;
  delivery: "local" | "github";
  messages: Message[];
  now: string;
}

export interface NewPullRequest {
  run_id: string;
  provider: "local" | "github";
  url: string;
  number: number | null;
  branch: string;
  base_branch: string;
  title: string;
  diff: string;
  now: string;
}

/** Thin query layer over the runs/pull_requests tables. Every update returns a fresh row. */
export function createStore(db: DatabaseSync) {
  const getRunStmt = db.prepare("SELECT * FROM runs WHERE id = ?");
  const listStmt = db.prepare("SELECT * FROM runs ORDER BY created_at DESC, id DESC LIMIT 200");
  const inboxStmt = db.prepare("SELECT * FROM runs WHERE status IN (?, ?) ORDER BY updated_at DESC");
  const prsStmt = db.prepare("SELECT * FROM pull_requests WHERE run_id = ? ORDER BY id");
  const activeStmt = db.prepare("SELECT id FROM runs WHERE status IN ('queued', 'running')");
  const idleStmt = db.prepare(
    "SELECT * FROM runs WHERE container_name IS NOT NULL AND status NOT IN ('queued', 'running') AND updated_at < ?",
  );

  const getRun = (id: string): RunRow | undefined => getRunStmt.get(id) as RunRow | undefined;

  return {
    getRun,
    listRuns: (): RunRow[] => listStmt.all() as unknown as RunRow[],
    inbox: (): RunRow[] => inboxStmt.all("needs_input", "failed") as unknown as RunRow[],
    activeRunIds: (): string[] => (activeStmt.all() as { id: string }[]).map((r) => r.id),
    idleSandboxRuns: (olderThanIso: string): RunRow[] => idleStmt.all(olderThanIso) as unknown as RunRow[],
    pullRequests: (runId: string): PullRequestRow[] => prsStmt.all(runId) as unknown as PullRequestRow[],

    insertRun(run: NewRun): RunRow {
      db.prepare(
        `INSERT INTO runs (id, repo_input, clone_url, local_remote, base_branch, work_branch, instruction, delivery, status, messages, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      ).run(
        run.id, run.repo_input, run.clone_url, run.local_remote, run.base_branch, run.work_branch,
        run.instruction, run.delivery, JSON.stringify(run.messages), run.now, run.now,
      );
      return getRun(run.id)!;
    },

    updateRun(id: string, patch: RunPatch, now: string): RunRow {
      const current = getRun(id);
      if (!current) throw new Error(`run ${id} not found`);
      const next = { ...current, ...patch, updated_at: now };
      db.prepare(
        `UPDATE runs SET status = ?, summary = ?, base_sha = ?, delivered_sha = ?, container_name = ?, local_remote = ?, updated_at = ? WHERE id = ?`,
      ).run(next.status, next.summary, next.base_sha, next.delivered_sha, next.container_name, next.local_remote, now, id);
      return next;
    },

    clearContainerNames(): void {
      db.prepare("UPDATE runs SET container_name = NULL WHERE container_name IS NOT NULL").run();
    },

    setMessages(id: string, messages: Message[], now: string): void {
      db.prepare("UPDATE runs SET messages = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(messages), now, id);
    },

    readMessages(run: RunRow): Message[] {
      return JSON.parse(run.messages) as Message[];
    },

    insertPullRequest(pr: NewPullRequest): void {
      db.prepare(
        `INSERT INTO pull_requests (run_id, provider, url, number, branch, base_branch, title, diff, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(pr.run_id, pr.provider, pr.url, pr.number, pr.branch, pr.base_branch, pr.title, pr.diff, pr.now);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
export type { RunStatus };
