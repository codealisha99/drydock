import fs from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createEngine } from "./engine";
import { openDb } from "./db";
import { dockerSandboxOps } from "./sandbox";
import { createModelFactory } from "./model";

const SWEEP_INTERVAL_MS = 60_000;
const HOST = "127.0.0.1";

async function main(): Promise<void> {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.remotesDir, { recursive: true });
  const db = openDb(cfg.dbPath);
  const log = (msg: string) => console.log(`[drydock] ${msg}`);
  const engine = createEngine({ cfg, db, sandboxOps: dockerSandboxOps, modelFactory: createModelFactory(cfg), log });

  const recovered = await engine.recover();
  log(`recovery: failed ${recovered.failedRuns.length} orphaned run(s), removed ${recovered.removedContainers.length} container(s)`);

  const app = createApp(engine, cfg);
  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: HOST }, (info) => {
    log(`api listening on http://${HOST}:${info.port} (provider=${cfg.provider}, concurrency=${cfg.concurrency})`);
  });
  const sweep = setInterval(() => {
    engine.sweepIdle().catch((err: unknown) => log(`idle sweep failed: ${String(err)}`));
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  const stop = async () => {
    log("shutting down: cancelling active runs and removing sandboxes");
    clearInterval(sweep);
    await engine.shutdown();
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
