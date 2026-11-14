import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export interface ExecOptions {
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_MAX_BYTES = 256 * 1024;

/** Spawns a process with a timeout, abort signal and bounded output capture. Never uses a shell. */
export function runProcess(bin: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    const out = { stdout: [] as Buffer[], stderr: [] as Buffer[], size: 0 };
    let timedOut = false;
    let aborted = false;
    const kill = () => child.kill("SIGKILL");
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => {
      aborted = true;
      kill();
    };
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const collect = (bucket: Buffer[]) => (chunk: Buffer) => {
      if (out.size >= maxBytes) return;
      const room = maxBytes - out.size;
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
      out.size += piece.length;
      bucket.push(piece);
    };
    child.stdout.on("data", collect(out.stdout));
    child.stderr.on("data", collect(out.stderr));
    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out.stdout).toString("utf8"),
        stderr: Buffer.concat(out.stderr).toString("utf8"),
        timedOut,
        aborted,
      });
    });
    child.stdin.on("error", () => {
      /* child may exit before reading stdin; the close handler reports the result */
    });
    child.stdin.end(opts.input ?? "");
  });
}

/** Throws with stderr attached when a git/docker call does not succeed. */
export function expectOk(result: ExecResult, what: string): ExecResult {
  if (result.aborted) throw new Error(`${what} was cancelled`);
  if (result.timedOut) throw new Error(`${what} timed out`);
  if (result.code !== 0) throw new Error(`${what} failed (exit ${result.code}): ${result.stderr.trim().slice(0, 2000)}`);
  return result;
}
