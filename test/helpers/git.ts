import { cpSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("../../fixtures/calc", import.meta.url));

export function git(args: string[], cwd: string): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

/** Creates a bare repo "origin/<name>.git" on branch main containing the calc fixture (with a failing test). */
export function seedBareRepo(name = "calc"): { root: string; bare: string } {
  const root = mkdtempSync(path.join(tmpdir(), "drydock-seed-"));
  const work = path.join(root, "seed");
  mkdirSync(work);
  cpSync(FIXTURE, work, { recursive: true });
  git(["init", "-q", "-b", "main"], work);
  git(["add", "-A"], work);
  git(["commit", "-q", "-m", "seed calc project"], work);
  const bare = path.join(root, "origin", `${name}.git`);
  mkdirSync(path.dirname(bare), { recursive: true });
  git(["clone", "-q", "--bare", work, bare], root);
  return { root, bare };
}
