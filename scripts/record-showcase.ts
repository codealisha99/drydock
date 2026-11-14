/**
 * Records the showcase seed. Runs each keyless scripted scenario through the real server and real
 * Docker sandbox (one server per scenario, each with its own database), then exports the runs,
 * events and PR rows to showcase/seed.json with host paths replaced. Needs drydock-sandbox:latest.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_DIR = path.join(ROOT, ".demo", "showcase");
const SEED_OUT = path.join(ROOT, "showcase", "seed.json");
const API = "http://127.0.0.1:4100";
const IMAGE = "drydock-sandbox:latest";
const TASK = "add() in src/math.js subtracts instead of adding, so the test suite fails. Fix it and make the tests pass.";

/** Each scenario and the outcome its script must reach. */
const SCENARIOS = [
  { script: "fix-failing-test", expected: "succeeded" },
  { script: "needs-input", expected: "needs_input" },
  { script: "cannot-fix", expected: "failed" },
] as const;

const log = (msg: string) => console.log(`\x1b[2m[record]\x1b[0m ${msg}`);
const git = (args: string[], cwd: string) =>
  execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();

function seedBareRemote(dir: string): string {
  rmSync(dir, { recursive: true, force: true });
  const seed = path.join(dir, "seed");
  mkdirSync(seed, { recursive: true });
  cpSync(path.join(ROOT, "fixtures/calc"), seed, { recursive: true });
  git(["init", "-q", "-b", "main"], seed);
  git(["add", "-A"], seed);
  git(["commit", "-q", "-m", "calc: initial project (add() is broken)"], seed);
  const bare = path.join(dir, "origin", "calc.git");
  mkdirSync(path.dirname(bare), { recursive: true });
  git(["clone", "-q", "--bare", seed, bare], dir);
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

async function waitForOutcome(runId: string): Promise<string> {
  for (let i = 0; i < 600; i += 1) {
    const detail = (await (await fetch(`${API}/api/runs/${runId}`)).json()) as { run: { status: string } };
    if (!["queued", "running"].includes(detail.run.status)) return detail.run.status;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`run ${runId} did not finish`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGINT");
  await exited;
}

/** Runs one scenario end to end and returns the run id. */
async function record(script: string, expected: string, dir: string): Promise<string> {
  const bare = seedBareRemote(dir);
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, DRYDOCK_DATA_DIR: path.join(dir, "data"), DRYDOCK_MODEL_PROVIDER: "scripted", DRYDOCK_SCRIPT: script, DRYDOCK_MODE: "live" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await waitForHealth(server);
    const created = await fetch(`${API}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: bare, branch: "main", instruction: TASK, delivery: "local" }),
    });
    if (!created.ok) throw new Error(`create run returned HTTP ${created.status}: ${await created.text()}`);
    const { run } = (await created.json()) as { run: { id: string } };
    const status = await waitForOutcome(run.id);
    if (status !== expected) throw new Error(`scenario ${script} ended as ${status}, expected ${expected}`);
    log(`${script}: run ${run.id} ended as ${status}`);
    return run.id;
  } finally {
    await stopServer(server);
  }
}

/** Replaces every host-specific string (repo paths, home dir, project root) before anything is written. */
function sanitize(text: string, hostPaths: string[], repoLabel: readonly [string, string]): string {
  let out = text.split(repoLabel[0]).join(repoLabel[1]);
  for (const p of hostPaths) out = out.split(p).join("<host>");
  return out;
}

function exportRun(dbFile: string, runId: string, hostPaths: string[], repoLabel: readonly [string, string]) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const clean = <T>(rows: T[]): T[] => JSON.parse(sanitize(JSON.stringify(rows), hostPaths, repoLabel)) as T[];
    // container_name is live-only state; a replayed run has no sandbox, so it is left out of the seed.
    const runs = clean(db.prepare("SELECT * FROM runs WHERE id = ?").all(runId) as Record<string, unknown>[]).map(({ container_name: _unused, ...run }) => run);
    const events = clean(db.prepare("SELECT run_id, seq, type, data, created_at FROM events WHERE run_id = ? ORDER BY seq").all(runId) as Record<string, unknown>[]);
    const pullRequests = clean(db.prepare("SELECT * FROM pull_requests WHERE run_id = ? ORDER BY id").all(runId) as Record<string, unknown>[]);
    // Events store their payload as JSON text; the seed keeps it structured so it is readable.
    const parsedEvents = events.map((e) => ({ ...e, data: JSON.parse(String(e.data)) as unknown }));
    return { runs, events: parsedEvents, pullRequests };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  try {
    execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
  } catch {
    throw new Error(`${IMAGE} is missing; run pnpm sandbox:build first`);
  }
  rmSync(RECORD_DIR, { recursive: true, force: true });
  const seed = { format: 1, recordedAt: new Date().toISOString(), source: "pnpm record:showcase", runs: [] as unknown[], events: [] as unknown[], pullRequests: [] as unknown[] };
  for (const { script, expected } of SCENARIOS) {
    const dir = path.join(RECORD_DIR, script);
    const runId = await record(script, expected, dir);
    const hostPaths = [dir, path.join(ROOT, ".demo"), ROOT, os.homedir()];
    // The bare repo is the recorded run's "repository": label it as the demo repo, not as a host path.
    const repoLabel = [`${path.join(dir, "origin", "calc.git")}`, "demo/calc.git"] as const;
    const part = exportRun(path.join(dir, "data", "drydock.sqlite"), runId, hostPaths, repoLabel);
    seed.runs.push(...part.runs);
    seed.events.push(...part.events);
    seed.pullRequests.push(...part.pullRequests);
  }
  const text = `${JSON.stringify(seed, null, 2)}\n`;
  if (/\/Users\//.test(text)) throw new Error("seed still contains a host path; refusing to write it");
  writeFileSync(SEED_OUT, text);
  log(`wrote ${path.relative(ROOT, SEED_OUT)}: ${seed.runs.length} runs, ${seed.events.length} events, ${seed.pullRequests.length} PR rows`);
}

main().catch((err: unknown) => {
  console.error(`\n[record] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
