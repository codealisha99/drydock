import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { runProcess, type ExecOptions } from "../../src/server/process";
import type { Sandbox, SandboxOps } from "../../src/server/sandbox";

/**
 * Test double for the Docker sandbox: same Sandbox interface, but commands run with `sh` in a host
 * directory. Lets the whole pipeline (clone, agent tools, commit, diff, delivery) run without Docker.
 */
export function hostSandboxOps(root: string): SandboxOps {
  const running = new Set<string>();
  const dirFor = (name: string) => path.join(root, name, "work");
  const sandboxFor = (name: string): Sandbox => ({
    name,
    workspace: dirFor(name),
    exec: (script: string, args: string[] = [], opts: ExecOptions = {}) =>
      runProcess("sh", ["-c", script, "drydock", ...args], { ...opts, cwd: dirFor(name) }),
  });
  const remove = async (name: string) => {
    running.delete(name);
    rmSync(path.join(root, name), { recursive: true, force: true });
  };
  return {
    async start({ name }) {
      mkdirSync(dirFor(name), { recursive: true });
      running.add(name);
      return sandboxFor(name);
    },
    attach: sandboxFor,
    remove,
    async isRunning(name) {
      return running.has(name);
    },
    async removeAll() {
      const names = [...running];
      await Promise.all(names.map(remove));
      return names;
    },
  };
}
