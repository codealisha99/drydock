import { expectOk, runProcess, type ExecOptions, type ExecResult } from "./process";
import { WORKSPACE_ROOT } from "./workspace";

export const MANAGED_LABEL = "drydock.managed=true";
export const SANDBOX_USER = "1000:1000";

/** A running per-run container. All commands go through `docker exec`; no secrets are injected. */
export interface Sandbox {
  readonly name: string;
  /** Absolute path of the repo checkout inside the sandbox; commands run with this as cwd. */
  readonly workspace: string;
  /** Runs `script` with `sh -c` in /work. Extra args are available as $1, $2, ... (never interpolated). */
  exec(script: string, args?: string[], opts?: ExecOptions): Promise<ExecResult>;
}

export function sandboxName(runId: string): string {
  return `drydock-${runId}`;
}

export function attachSandbox(name: string): Sandbox {
  return {
    name,
    workspace: WORKSPACE_ROOT,
    exec(script, args = [], opts = {}) {
      const dockerArgs = ["exec", "-i", "-w", WORKSPACE_ROOT, name, "sh", "-c", script, "drydock", ...args];
      return runProcess("docker", dockerArgs, opts);
    },
  };
}

/** Starts a hardened container: no capabilities, read-only root, tmpfs workspace, memory/CPU/pid caps, no host mounts. */
export async function startSandbox(opts: { name: string; image: string; runId: string }): Promise<Sandbox> {
  const args = [
    "run", "-d",
    "--name", opts.name,
    "--label", MANAGED_LABEL,
    "--label", `drydock.run=${opts.runId}`,
    "--memory", "1g", "--memory-swap", "1g",
    "--cpus", "1",
    "--pids-limit", "256",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--read-only",
    "--tmpfs", "/tmp:rw,size=256m",
    "--tmpfs", `${WORKSPACE_ROOT}:rw,exec,size=1g,uid=1000,gid=1000,mode=755`,
    "--user", SANDBOX_USER,
    "-e", "HOME=/tmp",
    "--add-host", "host.docker.internal:host-gateway",
    opts.image,
    "tail", "-f", "/dev/null",
  ];
  expectOk(await runProcess("docker", args, { timeoutMs: 60_000 }), "starting sandbox");
  const sandbox = attachSandbox(opts.name);
  expectOk(await sandbox.exec("git --version"), "sandbox health check");
  return sandbox;
}

export async function removeSandbox(name: string): Promise<void> {
  await runProcess("docker", ["rm", "-f", name], { timeoutMs: 60_000 });
}

export async function isSandboxRunning(name: string): Promise<boolean> {
  const res = await runProcess("docker", ["inspect", "-f", "{{.State.Running}}", name], { timeoutMs: 15_000 });
  return res.code === 0 && res.stdout.trim() === "true";
}

/** Removes every container this server labelled; used on boot (orphans) and on shutdown. */
export async function removeManagedSandboxes(): Promise<string[]> {
  const listed = await runProcess("docker", ["ps", "-a", "--filter", `label=${MANAGED_LABEL}`, "--format", "{{.Names}}"], {
    timeoutMs: 30_000,
  });
  const names = listed.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  await Promise.all(names.map(removeSandbox));
  return names;
}

/** The container operations the engine needs. Injected so tests can run the pipeline on host directories. */
export interface SandboxOps {
  start(opts: { name: string; image: string; runId: string }): Promise<Sandbox>;
  attach(name: string): Sandbox;
  remove(name: string): Promise<void>;
  isRunning(name: string): Promise<boolean>;
  removeAll(): Promise<string[]>;
}

export const dockerSandboxOps: SandboxOps = {
  start: startSandbox,
  attach: attachSandbox,
  remove: removeSandbox,
  isRunning: isSandboxRunning,
  removeAll: removeManagedSandboxes,
};
