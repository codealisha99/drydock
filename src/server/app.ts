import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { DomainError, FollowUpInput } from "./api-types";
import type { Config } from "./config";
import type { RunRow } from "./db";
import type { RunEvent } from "./events";
import type { Engine } from "./engine";
import { serveGitHttp } from "./git/http";
import { ZodError } from "zod";
import { sseFrame, toRunDto } from "./read-model";

const HEARTBEAT_MS = 15_000;

function parseAfter(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function createApp(engine: Engine, cfg: Config) {
  const app = new Hono();

  const runOr404 = (id: string): RunRow => {
    const run = engine.store.getRun(id);
    if (!run) throw new DomainError(404, `run ${id} not found`);
    return run;
  };

  app.get("/api/health", (c) => c.json({ ok: true, mode: cfg.mode, queue: engine.queueStats() }));

  app.get("/api/runs", (c) => c.json({ runs: engine.store.listRuns().map(toRunDto) }));

  app.get("/api/inbox", (c) => c.json({ runs: engine.store.inbox().map(toRunDto) }));

  app.post("/api/runs", async (c) => {
    const body = await readJson(c);
    const run = engine.createRun(body);
    return c.json({ run: toRunDto(run) }, 201);
  });

  app.get("/api/runs/:id", (c) => {
    const run = runOr404(c.req.param("id"));
    const diffEvents = engine.events.list(run.id, 0).filter((e) => e.type === "diff");
    const latestDiff = diffEvents.at(-1)?.data ?? null;
    const pullRequests = engine.store.pullRequests(run.id).map((pr) => ({
      id: pr.id,
      provider: pr.provider,
      url: pr.url,
      number: pr.number,
      branch: pr.branch,
      baseBranch: pr.base_branch,
      title: pr.title,
      diff: pr.diff,
      createdAt: pr.created_at,
    }));
    return c.json({ run: toRunDto(run), latestDiff, pullRequests });
  });

  app.post("/api/runs/:id/cancel", (c) => c.json({ run: toRunDto(engine.cancelRun(c.req.param("id"))) }));

  app.post("/api/runs/:id/messages", async (c) => {
    const body = FollowUpInput.safeParse(await readJson(c));
    if (!body.success) throw new DomainError(400, body.error.issues.map((i) => i.message).join("; "));
    return c.json({ run: toRunDto(engine.sendMessage(c.req.param("id"), body.data.message)) }, 202);
  });

  app.get("/api/runs/:id/events", (c) => {
    const runId = runOr404(c.req.param("id")).id;
    const after = parseAfter(c.req.query("after"));
    return streamSSE(c, async (stream) => {
      let lastSeq = after;
      let chain: Promise<unknown> = Promise.resolve();
      const send = (e: RunEvent) => {
        if (e.seq <= lastSeq) return;
        lastSeq = e.seq;
        chain = chain.then(() => stream.writeSSE(sseFrame(runId, e)));
      };
      // Subscribe before the synchronous replay so no event can fall between the two.
      const unsubscribe = engine.events.subscribe(runId, send);
      for (const e of engine.events.list(runId, after)) send(e);
      let finish = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const heartbeat = setInterval(() => {
        chain = chain.then(() => stream.writeSSE({ event: "ping", data: "" }));
      }, HEARTBEAT_MS);
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
        finish();
      });
      await done;
    });
  });

  app.all("/git/*", (c) => serveGitHttp(c.req.raw, cfg.remotesDir));

  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => i.message).join("; ") }, 400);
    console.error("unhandled error:", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}

/**
 * Requires application/json. A cross-origin page can only send "simple" content types without a
 * CORS preflight, which this server never grants, so this blocks drive-by run creation from a browser.
 */
async function readJson(c: Context): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new DomainError(415, "request body must be application/json");
  }
  try {
    return await c.req.json();
  } catch {
    throw new DomainError(400, "request body must be valid JSON");
  }
}
