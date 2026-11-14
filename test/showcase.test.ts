import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import type { Config } from "../src/server/config";
import { openDb } from "../src/server/db";
import { createEngine, type Engine } from "../src/server/engine";
import type { RunEvent } from "../src/server/events";
import type { SandboxOps } from "../src/server/sandbox";
import { importSeed, loadSeedFile, paceEvents, refusingSandboxOps, SHOWCASE_MESSAGE, type SeedFile } from "../src/server/showcase";
import { testConfig } from "./helpers/config";
import { listenEphemeral } from "./helpers/server";

const SEED_PATH = path.resolve(__dirname, "../showcase/seed.json");
const RUN = "abc123def456";

/** A two-event-gap run: the 60 ms gap lets the pacing test measure real waits. */
function miniSeed(): SeedFile {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const at = (ms: number) => new Date(base + ms).toISOString();
  return {
    format: 1,
    recordedAt: at(0),
    runs: [
      {
        id: RUN, repo_input: "demo/calc.git", clone_url: "", local_remote: null, base_branch: "main", work_branch: `drydock/run-${RUN}`,
        instruction: "fix add()", delivery: "local", status: "succeeded", summary: "done", base_sha: null, delivered_sha: null,
        messages: "[]", created_at: at(0), updated_at: at(60),
      },
    ],
    events: [
      { run_id: RUN, seq: 1, type: "status", data: { status: "queued" }, created_at: at(0) },
      { run_id: RUN, seq: 2, type: "status", data: { status: "running" }, created_at: at(0) },
      { run_id: RUN, seq: 3, type: "outcome", data: { status: "succeeded", summary: "done" }, created_at: at(60) },
    ],
    pullRequests: [],
  };
}

/** Sandbox ops that record any call and throw, so a test can assert Docker was never reached. */
function trackingSandboxOps(): { ops: SandboxOps; calls: string[] } {
  const calls: string[] = [];
  const touched = (name: string): never => {
    calls.push(name);
    throw new Error(`sandbox ${name} reached in showcase mode`);
  };
  const ops: SandboxOps = {
    start: async () => touched("start"),
    attach: () => touched("attach"),
    remove: async () => touched("remove"),
    isRunning: async () => touched("isRunning"),
    removeAll: async () => touched("removeAll"),
  };
  return { ops, calls };
}

/** Reads SSE frames from a live response until `stopType` arrives, then aborts the stream. */
async function readFrames(url: string, stopType: string): Promise<{ type: string; seq: number; at: number }[]> {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: { type: string; seq: number; at: number }[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const data = JSON.parse(line.slice(6)) as { type: string; seq: number };
      frames.push({ type: data.type, seq: data.seq, at: Date.now() });
      if (data.type === stopType) {
        controller.abort();
        return frames;
      }
    }
  }
  return frames;
}

describe("showcase mode", () => {
  let dataDir: string;
  let webDir: string;
  let cfg: Config;
  let engine: Engine;
  let calls: string[];
  let listener: Awaited<ReturnType<typeof listenEphemeral>>;
  let base: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "drydock-showcase-"));
    webDir = path.join(dataDir, "web");
    mkdirSync(webDir);
    writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>showcase ui</title>");
    listener = await listenEphemeral();
    cfg = testConfig(dataDir, listener.port, { DRYDOCK_MODE: "showcase", DRYDOCK_WEB_DIR: webDir });
    const db = openDb(":memory:");
    importSeed(db, miniSeed());
    const tracked = trackingSandboxOps();
    calls = tracked.calls;
    engine = createEngine({
      cfg,
      db,
      sandboxOps: tracked.ops,
      modelFactory: () => {
        throw new Error("no model in showcase mode");
      },
    });
    listener.setHandler(createApp(engine, cfg).fetch);
    base = `http://127.0.0.1:${listener.port}`;
  });

  afterEach(async () => {
    await listener.close();
  });

  it("refuses every write before reading the body or touching Docker", async () => {
    const bodies = [
      fetch(`${base}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: "/etc", instruction: "x" }) }),
      fetch(`${base}/api/runs`, { method: "POST" }),
      fetch(`${base}/api/runs/${RUN}/cancel`, { method: "POST" }),
      fetch(`${base}/api/runs/${RUN}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{\"message\":\"hi\"}" }),
      fetch(`${base}/api/runs/${RUN}`, { method: "DELETE" }),
    ];
    for (const res of await Promise.all(bodies)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: SHOWCASE_MESSAGE });
    }
    expect(calls).toEqual([]);
    expect(listener).toBeDefined();
  });

  it("refuses every git route, read or write, and never reads the repo store", async () => {
    const paths: [string, string][] = [
      ["GET", "/git/x.git/info/refs?service=git-upload-pack"],
      ["POST", "/git/x.git/git-upload-pack"],
      ["POST", "/git/x.git/git-receive-pack"],
      ["GET", "/git"],
    ];
    for (const [method, p] of paths) {
      const res = await fetch(`${base}${p}`, { method });
      expect(res.status).toBe(403);
      expect(await res.text()).toContain(SHOWCASE_MESSAGE);
    }
    expect(calls).toEqual([]);
  });

  it("reports its mode so the UI can say so", async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, mode: "showcase" });
  });

  it("serves recorded runs and their detail read-only", async () => {
    const list = (await (await fetch(`${base}/api/runs`)).json()) as { runs: { id: string; status: string; hasSandbox: boolean }[] };
    expect(list.runs).toEqual([expect.objectContaining({ id: RUN, status: "succeeded", hasSandbox: false })]);
    const detail = await (await fetch(`${base}/api/runs/${RUN}`)).json();
    expect(detail).toMatchObject({ run: { id: RUN }, pullRequests: [] });
    expect((await fetch(`${base}/api/runs/ffffff`)).status).toBe(404);
  });

  it("replays the recorded events in order with their original gaps", async () => {
    const started = Date.now();
    const frames = await readFrames(`${base}/api/runs/${RUN}/events?after=0`, "outcome");
    expect(frames.map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(frames[2]!.at - started).toBeGreaterThanOrEqual(55);
  });

  it("resumes a replay after a reconnect", async () => {
    const frames = await readFrames(`${base}/api/runs/${RUN}/events?after=2`, "outcome");
    expect(frames.map((f) => f.seq)).toEqual([3]);
  });

  it("serves the built UI and nothing outside it", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("showcase ui");
    expect((await fetch(`${base}/..%2F..%2Fpackage.json`)).status).not.toBe(200);
    expect(calls).toEqual([]);
  });

  it("keeps the live server's write path (not refused by showcase)", async () => {
    const live = createApp(engine, { ...cfg, mode: "live" });
    const res = await live.request("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(400);
  });
});

describe("showcase building blocks", () => {
  it("paces events by their real gaps, first one immediately", () => {
    const ev = (seq: number, at: string): RunEvent => ({ runId: "r", seq, type: "status", data: null, createdAt: at });
    const paced = paceEvents([ev(1, "2026-01-01T00:00:00.000Z"), ev(2, "2026-01-01T00:00:01.500Z"), ev(3, "2026-01-01T00:00:01.400Z")]);
    expect(paced.map((p) => p.delayMs)).toEqual([0, 1500, 0]);
  });

  it("refusing sandbox ops throw instead of acting", async () => {
    await expect(refusingSandboxOps.start({ name: "n", image: "i", runId: "r" })).rejects.toThrow(/disabled in showcase mode/);
    await expect(refusingSandboxOps.removeAll()).rejects.toThrow(/disabled in showcase mode/);
  });

  it("the committed seed file loads, has all three outcomes, and leaks no host paths", () => {
    const seed = loadSeedFile(SEED_PATH);
    const statuses = seed.runs.map((r) => r.status).sort();
    expect(statuses).toEqual(["failed", "needs_input", "succeeded"]);
    expect(seed.events.length).toBeGreaterThan(0);
    const raw = JSON.stringify(seed);
    expect(raw).not.toMatch(/\/Users\//);
    expect(raw).not.toMatch(/\.demo\//);
    expect(raw).not.toMatch(/[\w.+-]+@[\w.-]+\.\w+/);
  });
});

