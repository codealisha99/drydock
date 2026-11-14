import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import { loadConfig, type Config } from "./config";
import { createEngine } from "./engine";
import { openDb } from "./db";
import { dockerSandboxOps } from "./sandbox";
import { createModelFactory } from "./model";
import { createShowcaseApp, parseSeed } from "./showcase-app";

const SWEEP_INTERVAL_MS = 60_000;
const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../showcase/seed.json");
const log = (msg: string) => console.log(`[drydock] ${msg}`);

/** Showcase: read-only app over the recorded seed. No database, Docker or repo store is opened. */
function startShowcase(cfg: Config): void {
  const app = createShowcaseApp(parseSeed(JSON.parse(fs.readFileSync(SEED_FILE, "utf8"))));
  const root = path.relative(process.cwd(), cfg.webDir) || ".";
  app.use("/*", serveStatic({ root }));
  // SPA fallback: any path that is not a file or an API route gets the app, so /runs/<id> loads directly.
  const indexFile = serveStatic({ root, path: "index.html" });
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
    const served = await indexFile(c, next);
    return served instanceof Response ? served : c.res;
  });
  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
    log(`showcase listening on http://${cfg.host}:${info.port} (read-only, recorded runs)`);
  });
  const stop = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function startLive(cfg: Config): Promise<void> {
  fs.mkdirSync(cfg.remotesDir, { recursive: true });
  const db = openDb(cfg.dbPath);
  const engine = createEngine({ cfg, db, sandboxOps: dockerSandboxOps, modelFactory: createModelFactory(cfg), log });
  const recovered = await engine.recover();
  log(`recovery: failed ${recovered.failedRuns.length} orphaned run(s), removed ${recovered.removedContainers.length} container(s)`);

  const app = createApp(engine, cfg);
  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
    log(`api listening on http://${cfg.host}:${info.port} (provider=${cfg.provider}, concurrency=${cfg.concurrency})`);
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

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.mode === "showcase") startShowcase(cfg);
  else await startLive(cfg);
}

main().catch((err: unknown) => {
  console.error("[drydock] fatal:", err);
  process.exit(1);
});
