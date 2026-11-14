import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createEngine } from "./engine";
import { openDb } from "./db";
import { dockerSandboxOps } from "./sandbox";
import { createModelFactory } from "./model";
import { importSeed, loadSeedFile, refusingSandboxOps } from "./showcase";

const SWEEP_INTERVAL_MS = 60_000;
const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../showcase/seed.json");

async function main(): Promise<void> {
  const cfg = loadConfig();
  const showcase = cfg.mode === "showcase";
  const log = (msg: string) => console.log(`[drydock] ${msg}`);

  // Showcase: in-memory database seeded with recorded runs, and no path to Docker or the repo store.
  if (!showcase) fs.mkdirSync(cfg.remotesDir, { recursive: true });
  const db = openDb(showcase ? ":memory:" : cfg.dbPath);
  if (showcase) importSeed(db, loadSeedFile(SEED_FILE));
  const engine = createEngine({
    cfg,
    db,
    sandboxOps: showcase ? refusingSandboxOps : dockerSandboxOps,
    modelFactory: createModelFactory(cfg),
    log,
  });

  if (showcase) {
    log(`showcase mode: serving ${engine.store.listRuns().length} recorded run(s), read-only`);
  } else {
    const recovered = await engine.recover();
    log(`recovery: failed ${recovered.failedRuns.length} orphaned run(s), removed ${recovered.removedContainers.length} container(s)`);
  }

  const app = createApp(engine, cfg);
  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
    log(`api listening on http://${cfg.host}:${info.port} (mode=${cfg.mode}, provider=${cfg.provider}, concurrency=${cfg.concurrency})`);
  });
  const sweep = setInterval(() => {
    engine.sweepIdle().catch((err: unknown) => log(`idle sweep failed: ${String(err)}`));
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  const stop = async () => {
    log(showcase ? "shutting down" : "shutting down: cancelling active runs and removing sandboxes");
    clearInterval(sweep);
    if (!showcase) await engine.shutdown();
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((err: unknown) => {
  console.error("[drydock] fatal:", err);
  process.exit(1);
});
