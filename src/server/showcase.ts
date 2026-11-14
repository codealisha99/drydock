import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { RunEvent } from "./events";
import type { SandboxOps } from "./sandbox";

/** The message every refused request returns in showcase mode; the UI shows it verbatim. */
export const SHOWCASE_MESSAGE = "showcase mode: run it locally to start real runs";

/** Caps concurrent replay streams so a public showcase cannot be held open by a flood of EventSources. */
// ponytail: one global cap, no per-IP limit; add one if the showcase ever gets real traffic.
export const MAX_REPLAY_STREAMS = 200;

const SeedRun = z
  .object({
    id: z.string(),
    repo_input: z.string(),
    clone_url: z.string(),
    local_remote: z.string().nullable(),
    base_branch: z.string(),
    work_branch: z.string(),
    instruction: z.string(),
    delivery: z.enum(["local", "github"]),
    status: z.string(),
    summary: z.string().nullable(),
    base_sha: z.string().nullable(),
    delivered_sha: z.string().nullable(),
    messages: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

const SeedEvent = z
  .object({ run_id: z.string(), seq: z.number().int(), type: z.string(), data: z.unknown(), created_at: z.string() })
  .strict();

const SeedPullRequest = z
  .object({
    id: z.number().int(),
    run_id: z.string(),
    provider: z.enum(["local", "github"]),
    url: z.string(),
    number: z.number().int().nullable(),
    branch: z.string(),
    base_branch: z.string(),
    title: z.string(),
    diff: z.string(),
    created_at: z.string(),
  })
  .strict();

export const SeedFile = z.object({
  format: z.literal(1),
  recordedAt: z.string(),
  runs: z.array(SeedRun),
  events: z.array(SeedEvent),
  pullRequests: z.array(SeedPullRequest),
});
export type SeedFile = z.infer<typeof SeedFile>;

export function loadSeedFile(file: string): SeedFile {
  return SeedFile.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Copies recorded runs, events and PRs into the (in-memory) database. Idempotent on an empty database only. */
export function importSeed(db: DatabaseSync, seed: SeedFile): void {
  const insertRun = db.prepare(
    `INSERT INTO runs (id, repo_input, clone_url, local_remote, base_branch, work_branch, instruction, delivery, status, summary,
      base_sha, delivered_sha, container_name, messages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  );
  const insertEvent = db.prepare("INSERT INTO events (run_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?)");
  const insertPr = db.prepare(
    `INSERT INTO pull_requests (id, run_id, provider, url, number, branch, base_branch, title, diff, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    for (const r of seed.runs) {
      insertRun.run(r.id, r.repo_input, r.clone_url, r.local_remote, r.base_branch, r.work_branch, r.instruction, r.delivery, r.status,
        r.summary, r.base_sha, r.delivered_sha, r.messages, r.created_at, r.updated_at);
    }
    for (const e of seed.events) insertEvent.run(e.run_id, e.seq, e.type, JSON.stringify(e.data ?? null), e.created_at);
    for (const p of seed.pullRequests) {
      insertPr.run(p.id, p.run_id, p.provider, p.url, p.number, p.branch, p.base_branch, p.title, p.diff, p.created_at);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Pairs each event with the wait before it: the real gap since the previous event. The first event
 * goes out immediately, so a reconnect that starts mid-run resumes from the next event.
 */
export function paceEvents(events: readonly RunEvent[]): { event: RunEvent; delayMs: number }[] {
  return events.map((event, i) => {
    const prev = events[i - 1];
    const delayMs = prev ? Math.max(0, Date.parse(event.createdAt) - Date.parse(prev.createdAt)) : 0;
    return { event, delayMs };
  });
}

const refuse = (what: string) => {
  throw new Error(`${what} is disabled in showcase mode`);
};

/** Stands in for Docker in showcase mode. Any call is a bug, so it throws instead of touching the host. */
export const refusingSandboxOps: SandboxOps = {
  start: async () => refuse("starting a sandbox"),
  attach: () => refuse("attaching to a sandbox"),
  remove: async () => refuse("removing a sandbox"),
  isRunning: async () => refuse("checking a sandbox"),
  removeAll: async () => refuse("removing sandboxes"),
};
