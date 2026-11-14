/**
 * Keyless end-to-end demo. Starts the API with the scripted model, seeds a local bare repo with a
 * failing test, submits a task over HTTP, follows the SSE timeline, then verifies the branch on the
 * bare remote and the PR record. Set DEMO_KEEP=1 to leave the server running for the web UI.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = path.join(ROOT, ".demo");
const API = "http://127.0.0.1:4100";
const IMAGE = "drydock-sandbox:latest";
const TASK = "add() in src/math.js subtracts instead of adding, so the test suite fails. Fix it and make the tests pass.";

const log = (msg: string) => console.log(`\x1b[2m[demo]\x1b[0m ${msg}`);
const git = (args: string[], cwd: string) =>
  execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();

function ensureImage(): void {
  try {
    execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
  } catch {
    log(`building ${IMAGE} (one-time)`);
    execFileSync("docker", ["build", "-q", "-t", IMAGE, "-f", path.join(ROOT, "docker/sandbox.Dockerfile"), path.join(ROOT, "docker")], { stdio: "inherit" });
  }
}

function seedBareRemote(): string {
  rmSync(DEMO, { recursive: true, force: true });
  const seed = path.join(DEMO, "seed");
  mkdirSync(seed, { recursive: true });
  cpSync(path.join(ROOT, "fixtures/calc"), seed, { recursive: true });
  git(["init", "-q", "-b", "main"], seed);
  git(["add", "-A"], seed);
  git(["commit", "-q", "-m", "calc: initial project (add() is broken)"], seed);
  const bare = path.join(DEMO, "origin", "calc.git");
  mkdirSync(path.dirname(bare), { recursive: true });
  git(["clone", "-q", "--bare", seed, bare], DEMO);
  return bare;
}

async function waitForHealth(child: ChildProcess): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      if ((await fetch(`${API}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

interface Frame {
  type: string;
  seq: number;
  data: Record<string, unknown>;
}

/** Reads the SSE stream until the run's outcome, printing each event as it arrives. */
async function followTimeline(runId: string): Promise<Frame[]> {
  const res = await fetch(`${API}/api/runs/${runId}/events?after=0`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      const parsed = JSON.parse(dataLine.slice(6)) as { seq: number; type: string; data: Record<string, unknown> };
      frames.push(parsed);
      printFrame(parsed);
      if (parsed.type === "outcome") {
        await reader.cancel();
        return frames;
      }
    }
  }
  return frames;
}

function toolArg(d: Record<string, unknown>): string {
  const input = (d.input ?? {}) as Record<string, unknown>;
  return String(input.command ?? input.path ?? input.status ?? "");
}

/** TAP runs print a summary near the end; surface it instead of the first line. */
function resultSummary(output: string): string {
  const counts = output.split("\n").filter((l) => /^# (tests|pass|fail)\b/.test(l));
  if (counts.length > 0) return counts.map((l) => l.replace(/^# /, "")).join(", ");
  return output.split("\n")[0] ?? "";
}

function printFrame(f: { type: string; data: Record<string, unknown> }): void {
  const d = f.data;
  const text = (v: unknown) => String(v ?? "").split("\n")[0];
  switch (f.type) {
    case "status":
      return log(`status   ${text(d.status)}${d.message ? ` (${text(d.message)})` : ""}`);
    case "model_text":
      return log(`agent    ${text(d.text)}`);
    case "tool_call":
      return log(`tool     ${text(d.name)} ${toolArg(d)}`);
    case "tool_result":
      return log(`result   ${d.isError ? "ERROR " : ""}${resultSummary(String(d.output ?? ""))}`);
    case "diff":
      return log(`diff     ${String(d.diff ?? "").split("\n").filter((l) => /^[+-](?![+-])/.test(l)).length} changed lines`);
    case "delivery":
      return log(`deliver  ${text(d.provider)} ${text(d.branch)} -> ${text(d.url)}`);
    case "outcome":
      return log(`outcome  ${text(d.status)}: ${text(d.summary)}`);
    default:
      return log(`${f.type} ${text(JSON.stringify(d))}`);
  }
}

function fail(msg: string): never {
  throw new Error(`demo check failed: ${msg}`);
}

async function main(): Promise<void> {
  ensureImage();
  const bare = seedBareRemote();
  log(`seeded bare remote ${path.relative(ROOT, bare)} (add() is broken, one test fails)`);

  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, DRYDOCK_DATA_DIR: path.join(DEMO, "data"), DRYDOCK_MODEL_PROVIDER: "scripted", DRYDOCK_SCRIPT: "fix-failing-test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (c: Buffer) => process.stdout.write(`\x1b[2m${c.toString()}\x1b[0m`));
  server.stderr!.on("data", (c: Buffer) => process.stderr.write(c));
  const stopServer = () => new Promise<void>((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    server.kill("SIGINT");
  });

  try {
    await waitForHealth(server);
    log("api is up on :4100 with the scripted model (no keys used)");
    const created = await fetch(`${API}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: bare, branch: "main", instruction: TASK, delivery: "local" }),
    });
    if (!created.ok) fail(`create run returned HTTP ${created.status}: ${await created.text()}`);
    const { run } = (await created.json()) as { run: { id: string } };
    log(`submitted run ${run.id}; following the timeline over SSE`);

    const frames = await followTimeline(run.id);
    const outcome = frames.findLast((f) => f.type === "outcome");
    if (outcome?.data.status !== "succeeded") fail(`run ended as ${String(outcome?.data.status)}`);

    const testRuns = frames.filter((f) => f.type === "tool_result" && f.data.name === "bash");
    const before = String(testRuns[0]?.data.output ?? "");
    const after = String(testRuns.at(-1)?.data.output ?? "");
    if (!before.includes("fail 1")) fail("expected the first test run to fail");
    if (!after.includes("fail 0") || testRuns.at(-1)?.data.isError) fail("expected the final test run to pass inside the sandbox");
    log(`tests: before fix -> "fail 1"; after fix in sandbox -> "fail 0", exit 0`);

    const branch = `drydock/run-${run.id}`;
    const remoteRefs = git(["--git-dir", bare, "for-each-ref", "--format=%(refname)", "refs/heads"], bare);
    if (!remoteRefs.includes(`refs/heads/${branch}`)) fail(`branch ${branch} not on the bare remote`);
    const fixed = git(["--git-dir", bare, "show", `${branch}:src/math.js`], bare);
    if (!fixed.includes("return a + b;")) fail("pushed branch does not contain the fix");
    log(`bare remote has refs/heads/${branch} with the fix; main is unchanged`);

    const detail = (await (await fetch(`${API}/api/runs/${run.id}`)).json()) as {
      pullRequests: { provider: string; url: string; diff: string }[];
    };
    if (detail.pullRequests.length !== 1) fail(`expected 1 PR record, found ${detail.pullRequests.length}`);
    const pr = detail.pullRequests[0]!;
    log(`PR record: provider=${pr.provider} url=${pr.url}`);
    log(`diff recorded with the PR:\n${pr.diff.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-")).slice(0, 6).join("\n")}`);

    const containers = execFileSync("docker", ["ps", "--filter", `name=drydock-${run.id}`, "--format", "{{.Names}}"], { encoding: "utf8" }).trim();
    log(`sandbox container still running for follow-ups: ${containers || "(none)"}`);
    log(`DEMO PASSED: run ${run.id} fixed add() in a container, tests pass, branch and PR recorded.`);
    if (process.env.DEMO_KEEP === "1") {
      log("DEMO_KEEP=1: leaving the API running on :4100 (Ctrl+C to stop; sandboxes are removed on shutdown)");
      await new Promise<void>((resolve) => server.once("exit", () => resolve()));
    }
  } finally {
    if (process.env.DEMO_KEEP !== "1") await stopServer();
  }
  if (process.env.DEMO_KEEP !== "1") {
    const left = execFileSync("docker", ["ps", "-a", "--filter", "label=drydock.managed=true", "--format", "{{.Names}}"], { encoding: "utf8" }).trim();
    log(`shutdown complete; managed containers left: ${left || "none"}`);
  }
}

main().catch((err: unknown) => {
  console.error(`\n[demo] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
