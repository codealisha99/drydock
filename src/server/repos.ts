import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DeliveryKind } from "./api-types";
import { parseGithubRepo } from "./git/github";

export interface ResolvedRepo {
  repoInput: string;
  /** URL the sandbox clones from. Always reachable from inside the sandbox. */
  cloneUrl: string;
  /** Bare repo on this host that the "local" delivery target pushes to. */
  localRemote: string | null;
  owner: string | null;
  repo: string | null;
}

const gitSync = (args: string[], cwd: string): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Exposes a local repo under remotesDir (a symlink, served read-only over git HTTP). Returns its slug. */
function publishLocalRepo(absPath: string, remotesDir: string): string {
  const base = path.basename(absPath).replace(/\.git$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "repo";
  const slug = `${base}-${createHash("sha1").update(absPath).digest("hex").slice(0, 8)}`;
  const link = path.join(remotesDir, `${slug}.git`);
  fs.mkdirSync(remotesDir, { recursive: true });
  if (!fs.existsSync(link)) fs.symlinkSync(absPath, link, "dir");
  return slug;
}

/**
 * Turns the user's repo field into a clone URL for the sandbox and a delivery target.
 * https URLs are cloned directly (GitHub delivery). Local paths are published to the git HTTP route
 * and used as the local bare remote (local delivery).
 */
export function resolveRepo(
  input: string,
  delivery: DeliveryKind,
  cfg: { remotesDir: string; sandboxApiUrl: string; githubToken: string | undefined },
): ResolvedRepo {
  if (/^https:\/\//.test(input)) {
    if (delivery === "local") throw new RepoError("local delivery needs a local bare repository path; use a path or switch delivery to github");
    const gh = parseGithubRepo(input);
    if (!gh) throw new RepoError("github delivery needs a https://github.com/owner/repo URL");
    if (!cfg.githubToken) throw new RepoError("GITHUB_TOKEN is not set on the server; github delivery is unavailable");
    return { repoInput: input, cloneUrl: input, localRemote: null, owner: gh.owner, repo: gh.repo };
  }
  if (!path.isAbsolute(input)) throw new RepoError("repo must be an https URL or an absolute local path");
  const abs = path.resolve(input);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new RepoError(`no such directory: ${abs}`);
  try {
    gitSync(["rev-parse", "--git-dir"], abs);
  } catch {
    throw new RepoError(`not a git repository: ${abs}`);
  }
  if (delivery === "github") throw new RepoError("github delivery needs a https://github.com/owner/repo URL");
  const isBare = gitSync(["rev-parse", "--is-bare-repository"], abs) === "true";
  if (delivery === "local" && !isBare) throw new RepoError("local delivery pushes to a bare repository; create one with git clone --bare");
  const slug = publishLocalRepo(abs, cfg.remotesDir);
  return { repoInput: input, cloneUrl: `${cfg.sandboxApiUrl.replace(/\/$/, "")}/git/${slug}.git`, localRemote: abs, owner: null, repo: null };
}

export class RepoError extends Error {}
