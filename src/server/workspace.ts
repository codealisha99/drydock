import path from "node:path";

export const WORKSPACE_ROOT = "/work";

const MAX_PATH_LENGTH = 1024;

/**
 * Maps a model-supplied path onto the sandbox workspace. Rejects anything that
 * is absolute, contains NUL bytes, or lexically escapes /work via "..".
 * Returns an absolute path under `root`.
 */
export function resolveWorkspacePath(input: string, root: string = WORKSPACE_ROOT): string {
  if (typeof input !== "string" || input.length === 0) throw new Error("path must be a non-empty string");
  if (input.length > MAX_PATH_LENGTH) throw new Error("path is too long");
  if (input.includes("\0")) throw new Error("path contains a NUL byte");
  if (path.posix.isAbsolute(input)) throw new Error("path must be relative to the workspace");
  const normalized = path.posix.normalize(input);
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("path escapes the workspace");
  const resolved = path.posix.join(root, normalized);
  if (resolved === root) throw new Error("path must name a file inside the workspace");
  return resolved;
}
