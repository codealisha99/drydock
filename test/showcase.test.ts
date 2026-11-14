import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShowcaseApp, paceEvents, parseSeed, SHOWCASE_MESSAGE, SLOW_FACTOR, type SeedFile } from "../src/server/showcase-app";
import type { RunEvent } from "../src/server/events";
import { listenEphemeral } from "./helpers/server";

const ROOT = path.resolve(__dirname, "..");
const SEED_PATH = path.join(ROOT, "showcase/seed.json");
const OK = "4958fd73f9d8";
const NEEDS = "f7140d5b6960";
const FAILED = "099fc87e07c4";

/** Three runs in the recorded shape. The succeeded run has a diff and a PR; gaps are 60 ms so pacing is measurable. */
function miniSeed(): SeedFile {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const at = (ms: number) => new Date(base + ms).toISOString();
  const run = (id: string, status: string, created: number) => ({
    id, repo_input: "demo/calc.git", clone_url: "", local_remote: null, base_branch: "main", work_branch: `drydock/run-${id}`,
    instruction: "fix add()", delivery: "local" as const, status, summary: status, base_sha: null, delivered_sha: null,
    messages: "[]", created_at: at(created), updated_at: at(created + 60),
  });
  return {
    format: 1,
    recordedAt: at(0),
    runs: [run(OK, "succeeded", 0), run(NEEDS, "needs_input", 1000), run(FAILED, "failed", 2000)],
    events: [
      { run_id: OK, seq: 1, type: "status", data: { status: "queued" }, created_at: at(0) },
      { run_id: OK, seq: 2, type: "diff", data: { diff: "+x", baseSha: "a", headSha: "b" }, created_at: at(30) },
      { run_id: OK, seq: 3, type: "outcome", data: { status: "succeeded", summary: "done" }, created_at: at(60) },
      { run_id: NEEDS, seq: 1, type: "status", data: { status: "needs_input" }, created_at: at(1000) },
      { run_id: FAILED, seq: 1, type: "status", data: { status: "failed" }, created_at: at(2000) },
    ],
    pullRequests: [
      { id: 1, run_id: OK, provider: "local", url: "demo/calc.git#drydock/run-x", number: null, branch: "drydock/run-x", base_branch: "main", title: "t", diff: "+x", created_at: at(60) },
    ],
  };
}

/** Every frame of a replay, including the closing done frame. */
/** Event frames only: the closing done frame is left out. */
async function readFrames(url: string) {
  return (await readAllFrames(url)).filter((f) => f.type !== "done");
}

async function readAllFrames(url: string): Promise<{ type: string; seq: number; at: number }[]> {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: { type: string; seq: number; at: number }[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return frames;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const data = JSON.parse(line.slice(6)) as { type: string; seq: number };
      frames.push({ type: data.type, seq: data.seq, at: Date.now() });
    }
  }
}

describe("showcase app", () => {
  let listener: Awaited<ReturnType<typeof listenEphemeral>>;
  let base: string;

  beforeEach(async () => {
    listener = await listenEphemeral();
    listener.setHandler(createShowcaseApp(miniSeed()).fetch);
    base = `http://127.0.0.1:${listener.port}`;
  });

  afterEach(async () => {
    await listener.close();
  });

  it("refuses every write, with or without a body, before any handler runs", async () => {
    const reqs = [
      fetch(`${base}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: "/etc", instruction: "x" }) }),
      fetch(`${base}/api/runs`, { method: "POST" }),
      fetch(`${base}/api/runs/${OK}/cancel`, { method: "POST" }),
      fetch(`${base}/api/runs/${OK}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{\"message\":\"hi\"}" }),
      fetch(`${base}/api/runs/${OK}`, { method: "DELETE" }),
      fetch(`${base}/`, { method: "PUT" }),
    ];
    for (const res of await Promise.all(reqs)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: SHOWCASE_MESSAGE });
    }
  });

  it("refuses every git route, read or write", async () => {
    const paths: [string, string][] = [
      ["GET", "/git/x.git/info/refs?service=git-upload-pack"],
      ["POST", "/git/x.git/git-upload-pack"],
      ["POST", "/git/x.git/git-receive-pack"],
      ["GET", "/git"],
      ["GET", "/api/git/x.git/info/refs"],
    ];
    for (const [method, p] of paths) {
      const res = await fetch(`${base}${p}`, { method });
      expect(res.status).toBe(403);
      expect(await res.text()).toContain(SHOWCASE_MESSAGE);
    }
  });

  it("reports showcase mode and lists the three recorded runs, newest first", async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, mode: "showcase" });
    const list = (await (await fetch(`${base}/api/runs`)).json()) as { runs: { id: string; status: string; hasSandbox: boolean }[] };
    expect(list.runs.map((r) => r.id)).toEqual([FAILED, NEEDS, OK]);
    expect(list.runs.every((r) => r.hasSandbox === false)).toBe(true);
  });

  it("inbox lists only needs-input and failed runs", async () => {
    const inbox = (await (await fetch(`${base}/api/inbox`)).json()) as { runs: { id: string }[] };
    expect(inbox.runs.map((r) => r.id).sort()).toEqual([FAILED, NEEDS].sort());
  });

  it("run detail carries the latest diff and the PR record", async () => {
    const detail = (await (await fetch(`${base}/api/runs/${OK}`)).json()) as { run: { id: string }; latestDiff: { diff: string } | null; pullRequests: { url: string }[] };
    expect(detail.run.id).toBe(OK);
    expect(detail.latestDiff?.diff).toBe("+x");
    expect(detail.pullRequests.map((p) => p.url)).toEqual(["demo/calc.git#drydock/run-x"]);
    expect((await fetch(`${base}/api/runs/ffffff`)).status).toBe(404);
  });

  it("replays events in order with their recorded gaps, then ends the stream", async () => {
    const started = Date.now();
    const frames = await readFrames(`${base}/api/runs/${OK}/events?after=0`);
    expect(frames.map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(frames[2]!.at - started).toBeGreaterThanOrEqual(55);
  });

  it("slowed replay keeps the order and stretches the gaps by SLOW_FACTOR", async () => {
    const started = Date.now();
    const frames = await readFrames(`${base}/api/runs/${OK}/events?after=0&pace=slow`);
    expect(frames.map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(frames[2]!.at - started).toBeGreaterThanOrEqual(60 * SLOW_FACTOR - 10);
  });

  it("resumes a replay after a reconnect", async () => {
    const frames = await readFrames(`${base}/api/runs/${OK}/events?after=2`);
    expect(frames.map((f) => f.seq)).toEqual([3]);
  });
});

describe("showcase building blocks", () => {
  it("paces events by their real gaps, first one immediately", () => {
    const ev = (seq: number, at: string): RunEvent => ({ runId: "r", seq, type: "status", data: null, createdAt: at });
    const paced = paceEvents([ev(1, "2026-01-01T00:00:00.000Z"), ev(2, "2026-01-01T00:00:01.500Z"), ev(3, "2026-01-01T00:00:01.400Z")]);
    expect(paced.map((p) => p.delayMs)).toEqual([0, 1500, 0]);
  });

  it("rejects a malformed seed at the boundary", () => {
    expect(() => parseSeed({ format: 2 })).toThrow();
  });

  it("the committed seed has every outcome, a follow-up run and leaks no host paths", () => {
    const seed = parseSeed(JSON.parse(readFileSync(SEED_PATH, "utf8")));
    expect(seed.runs.map((r) => r.status).sort()).toEqual(["failed", "needs_input", "succeeded", "succeeded", "succeeded"]);
    const withFollowUp = seed.runs.filter((r) => seed.events.some((e) => e.run_id === r.id && e.type === "user_message"));
    expect(withFollowUp).toHaveLength(1);
    const raw = JSON.stringify(seed);
    expect(raw).not.toMatch(/\/Users\//);
    expect(raw).not.toMatch(/\.demo\//);
    expect(raw).not.toMatch(/[\w.+-]+@[\w.-]+\.\w+/);
  });

  it("the Vercel function's import graph reaches no database, process, Docker or git module", () => {
    const forbidden = [/sqlite/, /child_process/, /^node:fs$/, /sandbox/, /git\//, /\/db"/, /\/engine"/, /\/config"/, /\/app"/, /\/worker"/, /\/queue"/];
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file) || !existsSync(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/^import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)) {
        const spec = m[1]!;
        // Vercel runs the function as Node ESM, which needs the extension on relative imports.
        if (spec.startsWith(".") && !spec.endsWith(".json")) expect(spec, `${file} needs an explicit .js extension`).toMatch(/\.js$/);
        if (spec.startsWith(".")) {
          const base = path.resolve(path.dirname(file), spec.replace(/\.js$/, ""));
          visit(existsSync(`${base}.ts`) ? `${base}.ts` : base);
          continue;
        }
        if (forbidden.some((re) => re.test(spec))) throw new Error(`${path.relative(ROOT, file)} imports ${spec}`);
      }
    };
    visit(path.join(ROOT, "api/index.ts"));
    expect(seen.size).toBeGreaterThan(2);
    expect([...seen].map((f) => path.relative(ROOT, f))).not.toContain("src/server/db.ts");
  });
});


describe("showcase replay of a multi-turn run", () => {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const at = (ms: number) => new Date(base + ms).toISOString();
  const TURNS = "clarify0000";

  it("streams every turn's events in order, then a done frame, so the client does not stop at needs_input", async () => {
    const seed = miniSeed();
    const ev = (seq: number, type: string, data: unknown, ms: number) => ({ run_id: TURNS, seq, type, data, created_at: at(ms) });
    seed.runs.push({ ...seed.runs[1]!, id: TURNS, status: "succeeded", summary: "done" });
    seed.events.push(
      ev(1, "status", { status: "running" }, 0),
      ev(2, "tool_call", { id: "t1", name: "bash", input: { command: "node --test" } }, 10),
      ev(3, "tool_result", { id: "t1", name: "bash", output: "# pass 3\n# fail 2", isError: true }, 20),
      ev(4, "status", { status: "needs_input" }, 30),
      ev(5, "outcome", { status: "needs_input", summary: "Which convention wins?" }, 30),
      ev(6, "user_message", { text: "The first shares take the remainder." }, 40),
      ev(7, "tool_call", { id: "t2", name: "bash", input: { command: "node --test" } }, 50),
      ev(8, "tool_result", { id: "t2", name: "bash", output: "# pass 5\n# fail 0", isError: false }, 60),
      ev(9, "status", { status: "succeeded" }, 70),
      ev(10, "outcome", { status: "succeeded", summary: "All 5 tests pass." }, 70),
    );
    const listener2 = await listenEphemeral();
    listener2.setHandler(createShowcaseApp(seed).fetch);
    try {
      const frames = await readAllFrames(`http://127.0.0.1:${listener2.port}/api/runs/${TURNS}/events?after=0`);
      expect(frames.map((f) => f.type)).toEqual([
        "status", "tool_call", "tool_result", "status", "outcome",
        "user_message", "tool_call", "tool_result", "status", "outcome", "done",
      ]);
      expect(frames.slice(0, 10).map((f) => f.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await listener2.close();
    }
  });
});
