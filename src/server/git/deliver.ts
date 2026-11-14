import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expectOk, runProcess } from "../process";
import { openGithubPullRequest, type FetchLike } from "./github";

export interface LocalTarget {
  kind: "local";
  /** Path to a bare repository on this host (the "remote"). */
  remotePath: string;
}

export interface GithubTarget {
  kind: "github";
  owner: string;
  repo: string;
  token: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
}

export type DeliveryTarget = LocalTarget | GithubTarget;

export interface DeliveryRequest {
  workBranch: string;
  baseBranch: string;
  /** mbox patches from `git format-patch --stdout base..HEAD`, produced inside the sandbox. */
  patch: string;
  title: string;
  body: string;
  /** Diff stored with the PR record so the UI can show it without re-reading git. */
  diff: string;
  /** Only the first delivery for a run opens a PR; follow-up pushes just update the branch. */
  openPullRequest: boolean;
}

export interface DeliveryResult {
  provider: "local" | "github";
  url: string;
  number: number | null;
  branch: string;
  baseBranch: string;
  title: string;
  diff: string;
}

const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const GIT_IDENTITY = ["-c", "user.name=drydock-agent", "-c", "user.email=agent@drydock.invalid"];

/** Runs git with the GitHub token passed through env config, keeping it out of argv and logs. */
async function git(args: string[], cwd: string, token?: string): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    Object.assign(env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    });
  }
  const res = await runProcess("git", args, { cwd, env, timeoutMs: 120_000 });
  return expectOk(res, `git ${args[0]}`).stdout;
}

function remoteUrl(target: DeliveryTarget): string {
  return target.kind === "local" ? target.remotePath : `https://github.com/${target.owner}/${target.repo}.git`;
}

/** Checks out the work branch from the remote (or base branch if it is new) and applies the patches. */
async function checkoutAndApply(work: string, req: DeliveryRequest, token: string | undefined, patchFile: string): Promise<void> {
  const remoteHasBranch = await runProcess("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${req.workBranch}`], { cwd: work });
  const startPoint = remoteHasBranch.code === 0 ? req.workBranch : req.baseBranch;
  await git(["checkout", "--quiet", "-B", req.workBranch, `origin/${startPoint}`], work);
  await git([...GIT_IDENTITY, "am", "--quiet", patchFile], work, token);
}

/**
 * Pushes the sandbox's commits to the target and, for GitHub, opens a PR.
 * The host applies the patches to a fresh clone: the sandbox never holds credentials.
 */
export async function deliverBranch(target: DeliveryTarget, req: DeliveryRequest): Promise<DeliveryResult> {
  if (!BRANCH_RE.test(req.workBranch) || !BRANCH_RE.test(req.baseBranch)) throw new Error("invalid branch name");
  if (!req.patch.trim()) throw new Error("nothing to deliver: the patch is empty");
  const token = target.kind === "github" ? target.token : undefined;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "drydock-deliver-"));
  try {
    const work = path.join(tmp, "work");
    const patchFile = path.join(tmp, "changes.mbox");
    await writeFile(patchFile, req.patch, "utf8");
    await git(["clone", "--quiet", remoteUrl(target), work], tmp, token);
    await checkoutAndApply(work, req, token, patchFile);
    await git(["push", "--quiet", "origin", `HEAD:refs/heads/${req.workBranch}`], work, token);

    const base = { branch: req.workBranch, baseBranch: req.baseBranch, title: req.title, diff: req.diff };
    if (target.kind === "local") {
      return { ...base, provider: "local", url: `${target.remotePath}#${req.workBranch}`, number: null };
    }
    if (!req.openPullRequest) {
      return { ...base, provider: "github", url: `https://github.com/${target.owner}/${target.repo}/tree/${req.workBranch}`, number: null };
    }
    const pr = await openGithubPullRequest({
      owner: target.owner,
      repo: target.repo,
      token: target.token,
      head: req.workBranch,
      base: req.baseBranch,
      title: req.title,
      body: req.body,
      apiBase: target.apiBase,
      fetchImpl: target.fetchImpl,
    });
    return { ...base, provider: "github", url: pr.url, number: pr.number };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
