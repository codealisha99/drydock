import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { openDb } from "../../src/server/db";
import { createEngine, type Engine } from "../../src/server/engine";
import { dockerSandboxOps, MANAGED_LABEL, sandboxName, startSandbox, removeSandbox } from "../../src/server/sandbox";
import { SCRIPTS, scriptedModel } from "../../src/server/model/scripted";
import { loadConfig } from "../../src/server/config";
import { git, seedBareRepo } from "../helpers/git";
import { listenEphemeral, waitFor } from "../helpers/server";

const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const dockerReady = (() => {
  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
    docker(["image", "inspect", "drydock-sandbox:latest", "--format", "{{.Id}}"]);
    return true;
  } catch {
    return false;
  }
})();

const TERMINAL = ["needs_input", "succeeded", "failed", "cancelled"];
const runId = () => Math.random().toString(16).slice(2, 10);

describe.skipIf(!dockerReady)("real Docker sandbox (requires drydock-sandbox:latest; run `pnpm sandbox:build`)", () => {
  let listener: Awaited<ReturnType<typeof listenEphemeral>>;
  let engine: Engine;
  let app: ReturnType<typeof createApp>;
  let bare: string;
  let cfg: ReturnType<typeof loadConfig>;

  beforeAll(async () => {
    listener = await listenEphemeral();
    const dataDir = mkdtempSync(path.join(tmpdir(), "drydock-int-"));
    cfg = loadConfig({
      DRYDOCK_DATA_DIR: dataDir,
      // Containers reach the host through host.docker.internal; the listener is bound to 127.0.0.1.
      DRYDOCK_SANDBOX_API_URL: `http://host.docker.internal:${listener.port}`,
      DRYDOCK_MODEL_PROVIDER: "scripted",
      DRYDOCK_CONCURRENCY: "2",
      ANTHROPIC_API_KEY: "must-not-enter-sandbox",
      GITHUB_TOKEN: "",
    });
    bare = seedBareRepo().bare;
    engine = createEngine({ cfg, db: openDb(":memory:"), sandboxOps: dockerSandboxOps, modelFactory: () => scriptedModel(SCRIPTS["fix-failing-test"]!) });
    app = createApp(engine, cfg);
    listener.setHandler(app.fetch);
  });

  afterAll(async () => {
    await engine?.shutdown();
    await listener?.close();
  });

  it("starts a hardened container with no host mounts and no API keys", async () => {
    const id = runId();
    const name = sandboxName(id);
    const sb = await startSandbox({ name, image: cfg.sandboxImage, runId: id });
    try {
      const inspected = JSON.parse(docker(["inspect", name]))[0];
      expect(inspected.HostConfig.CapDrop).toEqual(["ALL"]);
      expect(inspected.HostConfig.ReadonlyRootfs).toBe(true);
      expect(inspected.HostConfig.Memory).toBe(1024 ** 3);
      expect(inspected.HostConfig.PidsLimit).toBe(256);
      expect(inspected.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
      expect(inspected.Mounts).toEqual([]);
      expect(inspected.Config.Labels[MANAGED_LABEL.split("=")[0]!]).toBe("true");
      expect(inspected.Config.User).toBe("1000:1000");

      const env = await sb.exec("env");
      expect(env.stdout).not.toContain("ANTHROPIC_API_KEY");
      expect(env.stdout).not.toContain("must-not-enter-sandbox");
      const writeRoot = await sb.exec("touch /usr/local/x-probe 2>&1; echo rc=$?");
      expect(writeRoot.stdout).toContain("rc=1");
    } finally {
      await removeSandbox(name);
    }
  });

  it("runs the agent in a container, pushes the branch and records a PR", async () => {
    const run = engine.createRun({ repo: bare, branch: "main", instruction: "Fix add() so the tests pass", delivery: "local" });
    const done = await waitFor(() => {
      const r = engine.store.getRun(run.id);
      return r && TERMINAL.includes(r.status) ? r : undefined;
    }, 170_000);
    expect(done.status).toBe("succeeded");
    expect(done.container_name).toBe(sandboxName(run.id));
    expect(docker(["inspect", "-f", "{{.State.Running}}", done.container_name!])).toBe("true");

    const events = engine.events.list(run.id, 0);
    const bashResults = events.filter((e) => e.type === "tool_result" && (e.data as { name: string }).name === "bash");
    expect((bashResults.at(-1)!.data as { output: string }).output).toContain("fail 0");
    expect(git(["--git-dir", bare, "show", `drydock/run-${run.id}:src/math.js`], bare)).toContain("return a + b;");
    expect(engine.store.pullRequests(run.id)).toHaveLength(1);
  }, 180_000);

  it("cleans up managed containers on shutdown", async () => {
    await engine.shutdown();
    const left = docker(["ps", "-a", "--filter", `label=${MANAGED_LABEL}`, "--format", "{{.Names}}"]);
    expect(left).toBe("");
  }, 120_000);
});
