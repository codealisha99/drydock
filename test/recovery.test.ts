import { describe, expect, it } from "vitest";
import { openDb } from "../src/server/db";
import { createEngine } from "../src/server/engine";
import type { SandboxOps } from "../src/server/sandbox";
import { testConfig } from "./helpers/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelClient } from "../src/server/model/types";

const neverModel: ModelClient = { complete: () => new Promise(() => undefined) };

function fakeOps(containers: string[] = []) {
  const removed: string[] = [];
  const ops: SandboxOps = {
    start: async () => {
      throw new Error("not used");
    },
    attach: (name) => ({ name, workspace: "/work", exec: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false, aborted: false }) }),
    remove: async (name) => {
      removed.push(name);
    },
    isRunning: async () => true,
    removeAll: async () => {
      removed.push(...containers);
      return containers;
    },
  };
  return { ops, removed };
}

function setup(containers: string[] = [], idleTtlMs = 15 * 60 * 1000) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "drydock-rec-"));
  const cfg = { ...testConfig(dataDir, 4100), idleTtlMs };
  const db = openDb(":memory:");
  const { ops, removed } = fakeOps(containers);
  const engine = createEngine({ cfg, db, sandboxOps: ops, modelFactory: () => neverModel });
  const insert = (id: string, status: string, extra: Record<string, unknown> = {}) => {
    const now = new Date().toISOString();
    engine.store.insertRun({
      id, repo_input: "/x", clone_url: "http://127.0.0.1/git/x.git", local_remote: "/x", base_branch: "main",
      work_branch: `drydock/run-${id}`, instruction: "i", delivery: "local", messages: [], now,
    });
    engine.store.updateRun(id, { status: status as never, ...extra }, now);
  };
  return { engine, insert, removed };
}

describe("boot recovery", () => {
  it("fails orphaned queued/running runs and removes every managed container", async () => {
    const { engine, insert, removed } = setup(["drydock-aaa", "drydock-bbb"]);
    insert("aaa", "running", { container_name: "drydock-aaa" });
    insert("bbb", "queued", { container_name: "drydock-bbb" });
    insert("ccc", "needs_input", { container_name: "drydock-ccc" });

    const result = await engine.recover();

    expect(result.failedRuns.sort()).toEqual(["aaa", "bbb"]);
    expect(result.removedContainers).toEqual(["drydock-aaa", "drydock-bbb"]);
    expect(engine.store.getRun("aaa")).toMatchObject({ status: "failed", summary: "Server restarted before this run finished", container_name: null });
    expect(engine.store.getRun("bbb")!.status).toBe("failed");
    // a finished run keeps its row but loses its sandbox pointer
    expect(engine.store.getRun("ccc")).toMatchObject({ status: "needs_input", container_name: null });
    expect(removed).toEqual(["drydock-aaa", "drydock-bbb"]);
  });

  it("refuses follow-ups once the sandbox is gone", () => {
    const { engine, insert } = setup();
    insert("ddd", "failed", { container_name: null });
    expect(() => engine.sendMessage("ddd", "try again")).toThrow("start a new run");
  });

  it("sweeps sandboxes of finished runs that have been idle past the TTL", async () => {
    const { engine, insert, removed } = setup([], 60_000);
    insert("eee", "succeeded", { container_name: "drydock-eee" });
    insert("fff", "running", { container_name: "drydock-fff" });

    const swept = await engine.sweepIdle(new Date(Date.now() + 10 * 60_000));

    expect(swept).toEqual(["eee"]);
    expect(removed).toEqual(["drydock-eee"]);
    expect(engine.store.getRun("eee")!.container_name).toBeNull();
    expect(engine.store.getRun("fff")!.container_name).toBe("drydock-fff");
  });

  it("rejects cancelling a finished run", () => {
    const { engine, insert } = setup();
    insert("ggg", "succeeded");
    expect(() => engine.cancelRun("ggg")).toThrow("already succeeded");
  });
});
