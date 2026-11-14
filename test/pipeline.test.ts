import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import type { Config } from "../src/server/config";
import { openDb } from "../src/server/db";
import { createEngine, type Engine } from "../src/server/engine";
import { SCRIPTS, scriptedModel } from "../src/server/model/scripted";
import type { ModelClient } from "../src/server/model/types";
import { hostSandboxOps } from "./helpers/host-sandbox";
import { seedBareRepo, git } from "./helpers/git";
import { testConfig } from "./helpers/config";
import { listenEphemeral, waitFor } from "./helpers/server";

type Listener = Awaited<ReturnType<typeof listenEphemeral>>;

interface Harness {
  engine: Engine;
  cfg: Config;
  bare: string;
  listener: Listener;
  close(): Promise<void>;
}

async function harness(modelFactory: () => ModelClient): Promise<Harness> {
  const seeded = seedBareRepo();
  const dataDir = mkdtempSync(path.join(tmpdir(), "drydock-data-"));
  const listener = await listenEphemeral();
  const cfg = testConfig(dataDir, listener.port);
  const db = openDb(":memory:");
  const engine = createEngine({ cfg, db, sandboxOps: hostSandboxOps(mkdtempSync(path.join(tmpdir(), "drydock-hosts-"))), modelFactory });
  listener.setHandler(createApp(engine, cfg).fetch);
  return {
    engine,
    cfg,
    bare: seeded.bare,
    listener,
    async close() {
      await engine.shutdown();
      await listener.close();
      db.close();
    },
  };
}

const TERMINAL = ["needs_input", "succeeded", "failed", "cancelled"];

describe("engine pipeline with real git over HTTP (host-directory sandbox)", () => {
  let h: Harness;

  afterEach(async () => {
    await h?.close();
  });

  it("fixes the failing test, pushes the branch, records a PR and streams the timeline", async () => {
    h = await harness(() => scriptedModel(SCRIPTS["fix-failing-test"]!));
    const run = h.engine.createRun({ repo: h.bare, branch: "main", instruction: "Fix add() so the tests pass", delivery: "local" });

    const done = await waitFor(() => {
      const r = h.engine.store.getRun(run.id);
      return r && TERMINAL.includes(r.status) ? r : undefined;
    });
    expect(done.status).toBe("succeeded");
    expect(done.summary).toContain("passes");

    const branch = `drydock/run-${run.id}`;
    expect(git(["--git-dir", h.bare, "show", `${branch}:src/math.js`], h.bare)).toContain("return a + b;");
    expect(git(["--git-dir", h.bare, "show", "main:src/math.js"], h.bare)).toContain("return a - b;");

    const prs = h.engine.store.pullRequests(run.id);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ provider: "local", branch, base_branch: "main" });
    expect(prs[0]!.diff).toContain("+  return a + b;");

    const events = h.engine.events.list(run.id, 0);
    const testRuns = events.filter((e) => e.type === "tool_result" && (e.data as { name: string }).name === "bash");
    expect((testRuns[0]!.data as { output: string }).output).toContain("fail 1");
    expect((testRuns.at(-1)!.data as { output: string; isError: boolean })).toMatchObject({ isError: false });
    expect((testRuns.at(-1)!.data as { output: string }).output).toContain("fail 0");
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["status", "model_text", "tool_call", "tool_result", "diff", "delivery", "outcome"]));
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });

  it("serves the event timeline over SSE with replay from a cursor", async () => {
    h = await harness(() => scriptedModel(SCRIPTS["fix-failing-test"]!));
    const run = h.engine.createRun({ repo: h.bare, branch: "main", instruction: "Fix add()", delivery: "local" });
    await waitFor(() => (TERMINAL.includes(h.engine.store.getRun(run.id)!.status) ? true : undefined));

    const app = createApp(h.engine, h.cfg);
    const res = await app.request(`/api/runs/${run.id}/events?after=0`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: outcome")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    await reader.cancel();
    expect(text).toContain("event: status");
    expect(text).toContain("event: diff");
    expect(text).toContain("event: outcome");
  });

  it("asks for input without delivering, then resumes on a follow-up", async () => {
    h = await harness(() => scriptedModel(SCRIPTS["needs-input"]!));
    const run = h.engine.createRun({ repo: h.bare, branch: "main", instruction: "Fix add()", delivery: "local" });
    const first = await waitFor(() => {
      const r = h.engine.store.getRun(run.id);
      return r && r.status === "needs_input" ? r : undefined;
    });
    expect(first.summary).toContain("which API should win");
    expect(h.engine.store.inbox().map((r) => r.id)).toContain(run.id);
    expect(h.engine.store.pullRequests(run.id)).toHaveLength(0);

    const before = h.engine.store.readMessages(first).length;
    h.engine.sendMessage(run.id, "Use the + operator.");
    await waitFor(() => (h.engine.store.getRun(run.id)!.status === "needs_input" && h.engine.store.readMessages(h.engine.store.getRun(run.id)!).length > before ? true : undefined));
    expect(h.engine.events.list(run.id, 0).some((e) => e.type === "user_message")).toBe(true);
  });

  it("keeps a follow-up that adds no new changes succeeded instead of failing delivery", async () => {
    h = await harness(() => scriptedModel(SCRIPTS["fix-failing-test"]!));
    const run = h.engine.createRun({ repo: h.bare, branch: "main", instruction: "Fix add() so the tests pass", delivery: "local" });
    await waitFor(() => (TERMINAL.includes(h.engine.store.getRun(run.id)!.status) ? true : undefined));
    expect(h.engine.store.getRun(run.id)!.status).toBe("succeeded");

    // The replayed script makes no new change on this turn; the run already has a delivered commit.
    h.engine.sendMessage(run.id, "Double-check the result and confirm.");
    const after = await waitFor(() => {
      const r = h.engine.store.getRun(run.id)!;
      return TERMINAL.includes(r.status) && h.engine.events.list(run.id, 0).some((e) => e.type === "user_message") ? r : undefined;
    });
    expect(after.status).toBe("succeeded");
    expect(after.summary).not.toContain("nothing to deliver");
    expect(h.engine.store.pullRequests(run.id)).toHaveLength(1);
  });

  it("cancels a running run and removes its sandbox", async () => {
    const hanging: ModelClient = {
      complete: (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    };
    h = await harness(() => hanging);
    const run = h.engine.createRun({ repo: h.bare, branch: "main", instruction: "Do something slow", delivery: "local" });
    await waitFor(() => (h.engine.store.getRun(run.id)!.status === "running" ? true : undefined));
    h.engine.cancelRun(run.id);
    const cancelled = await waitFor(() => {
      const r = h.engine.store.getRun(run.id);
      return r && r.status === "cancelled" ? r : undefined;
    });
    expect(cancelled.container_name).toBeNull();
    expect(() => h.engine.cancelRun(run.id)).toThrow("already cancelled");
  });

  it("rejects bad input at the boundary with a 400", async () => {
    h = await harness(() => scriptedModel([]));
    const app = createApp(h.engine, h.cfg);
    const post = (body: unknown) =>
      app.request("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    expect((await post({ repo: h.bare, instruction: "x", branch: "main; rm -rf /" })).status).toBe(400);
    expect((await post({ repo: "relative/path", instruction: "x" })).status).toBe(400);
    expect((await post({ repo: "https://evil.example.com/a/b", instruction: "x", delivery: "github" })).status).toBe(400);
    expect((await post({ repo: "https://github.com/a/b", instruction: "x", delivery: "github" })).status).toBe(400); // no GITHUB_TOKEN
    expect((await post({ repo: h.bare, instruction: "x", unexpected: true })).status).toBe(400);
    const bad = await app.request("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(400);
    // a cross-site "simple" request (text/plain) must not create a run
    const simple = await app.request("/api/runs", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ repo: h.bare, instruction: "x" }) });
    expect(simple.status).toBe(415);
    expect(h.engine.store.listRuns()).toHaveLength(0);
    expect((await app.request("/api/runs/nope")).status).toBe(404);
  });
});
