import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { PullRequestRow, RunRow } from "./db";
import type { RunEvent } from "./events";
import { sseFrame, toPullRequestDto, toRunDto } from "./read-model.js";
import { summarizeRun } from "../shared/run-facts";

/** The message every refused request returns in showcase mode; the UI shows it verbatim. */
export const SHOWCASE_MESSAGE = "showcase mode: run it locally to start real runs";

/** Caps concurrent replay streams per instance so a public showcase cannot be held open by a flood of EventSources. */
// ponytail: one per-instance cap, no per-IP limit; add one if the showcase gets real traffic.
export const MAX_REPLAY_STREAMS = 200;

/** "slow" replays with every recorded gap multiplied by this factor. Order is unchanged. */
export const SLOW_FACTOR = 4;

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

/** Validates the recorded seed at the boundary; a malformed file fails the function's cold start. */
export function parseSeed(raw: unknown): SeedFile {
  return SeedFile.parse(raw);
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

const INBOX = ["needs_input", "failed"];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Read-only app over recorded runs. Imports nothing that opens a database, spawns a process or touches a repo. */
export function createShowcaseApp(seed: SeedFile) {
  const app = new Hono();
  let activeReplays = 0;

  // Runs are rebuilt as row shapes so the same DTO functions serve live and showcase.
  const runs = seed.runs
    .map((r) => ({ ...r, container_name: null, status: r.status as RunRow["status"] }) as RunRow)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const runById = new Map(runs.map((r) => [r.id, r]));
  const eventsByRun = new Map<string, RunEvent[]>();
  for (const e of seed.events) {
    const list = eventsByRun.get(e.run_id) ?? [];
    list.push({ runId: e.run_id, seq: e.seq, type: e.type as RunEvent["type"], data: e.data, createdAt: e.created_at });
    eventsByRun.set(e.run_id, list.sort((a, b) => a.seq - b.seq));
  }
  const prsByRun = new Map<string, PullRequestRow[]>();
  for (const p of seed.pullRequests) {
    const list = prsByRun.get(p.run_id) ?? [];
    list.push({ ...p, created_at: p.created_at } as PullRequestRow);
    prsByRun.set(p.run_id, list);
  }

  // Refuses every write and every git route before any handler runs.
  app.use("*", async (c, next) => {
    const readOnly = c.req.method === "GET" || c.req.method === "HEAD";
    const gitRoute = c.req.path === "/git" || c.req.path.startsWith("/git/") || c.req.path.startsWith("/api/git");
    if (!readOnly || gitRoute) return c.json({ error: SHOWCASE_MESSAGE }, 403);
    return next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, mode: "showcase" }));
  const runDto = (run: RunRow) => ({ ...toRunDto(run), facts: summarizeRun(eventsByRun.get(run.id) ?? []) });
  app.get("/api/runs", (c) => c.json({ runs: runs.map(runDto) }));
  app.get("/api/inbox", (c) => c.json({ runs: runs.filter((r) => INBOX.includes(r.status)).map(runDto) }));

  app.get("/api/runs/:id", (c) => {
    const run = runById.get(c.req.param("id"));
    if (!run) return c.json({ error: `run ${c.req.param("id")} not found` }, 404);
    const diffs = (eventsByRun.get(run.id) ?? []).filter((e) => e.type === "diff");
    const latestDiff = (diffs.at(-1)?.data as { diff: string; baseSha: string; headSha: string } | undefined) ?? null;
    const pullRequests = (prsByRun.get(run.id) ?? []).map(toPullRequestDto);
    return c.json({ run: runDto(run), latestDiff, pullRequests });
  });

  app.get("/api/runs/:id/events", (c) => {
    const runId = c.req.param("id");
    if (!runById.has(runId)) return c.json({ error: `run ${runId} not found` }, 404);
    if (activeReplays >= MAX_REPLAY_STREAMS) return c.json({ error: "showcase is busy; try again shortly" }, 503);
    const n = Number(c.req.query("after") ?? 0);
    const after = Number.isInteger(n) && n >= 0 ? n : 0;
    const factor = c.req.query("pace") === "slow" ? SLOW_FACTOR : 1;
    const pending = paceEvents((eventsByRun.get(runId) ?? []).filter((e) => e.seq > after));
    return streamSSE(c, async (stream) => {
      activeReplays += 1;
      try {
        // Replays the recorded events in order with their recorded gaps (times SLOW_FACTOR when slowed).
        // Every turn of the run is in the recording, so the stream only ends at the end of the whole run.
        for (const { event, delayMs } of pending) {
          if (delayMs > 0) await sleep(delayMs * factor);
          if (stream.aborted) return;
          await stream.writeSSE(sseFrame(runId, event));
        }
        // The client closes on this frame. Without it, EventSource would reconnect and replay from the start.
        if (!stream.aborted) await stream.writeSSE({ event: "done", data: JSON.stringify({ runId, type: "done" }) });
      } finally {
        activeReplays -= 1;
      }
    });
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));
  return app;
}
