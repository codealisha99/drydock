import type { ExecOptions } from "./process";
import { expectOk } from "./process";
import type { Sandbox } from "./sandbox";

const GIT_IDENTITY = { name: "drydock-agent", email: "agent@drydock.invalid" } as const;
const BIG_OUTPUT = { maxBytes: 4 * 1024 * 1024 } satisfies ExecOptions;

/**
 * Clones the repo inside the sandbox and creates the work branch.
 * Returns the base commit SHA. The clone URL is passed as an argv element, never spliced into the script.
 */
export async function cloneWorkspace(
  sb: Sandbox,
  input: { cloneUrl: string; baseBranch: string; workBranch: string },
  opts: ExecOptions = {},
): Promise<string> {
  const script = [
    `git clone --quiet --branch "$1" --single-branch -- "$2" "$4"`,
    `cd "$4"`,
    `git checkout -q -b "$3"`,
    `git config user.name "${GIT_IDENTITY.name}"`,
    `git config user.email "${GIT_IDENTITY.email}"`,
    `git rev-parse HEAD`,
  ].join(" && ");
  const res = expectOk(await sb.exec(script, [input.baseBranch, input.cloneUrl, input.workBranch, sb.workspace], { ...opts, timeoutMs: 180_000 }), "cloning repo in sandbox");
  return res.stdout.trim();
}

/** Commits any pending changes. Returns true when a commit was created. */
export async function commitPending(sb: Sandbox, message: string, opts: ExecOptions = {}): Promise<boolean> {
  const script = `if [ -n "$(git status --porcelain)" ]; then git add -A && git commit -q -m "$1" && echo committed; else echo clean; fi`;
  const res = expectOk(await sb.exec(script, [message], opts), "committing in sandbox");
  return res.stdout.trim() === "committed";
}

export async function headSha(sb: Sandbox): Promise<string> {
  return expectOk(await sb.exec("git rev-parse HEAD"), "reading HEAD").stdout.trim();
}

/** Unified diff of base..HEAD (committed work only; call commitPending first). */
export async function diffSince(sb: Sandbox, baseSha: string, opts: ExecOptions = {}): Promise<string> {
  return expectOk(await sb.exec(`git diff --no-color --no-ext-diff "$1"..HEAD`, [baseSha], { ...BIG_OUTPUT, ...opts }), "diffing sandbox").stdout;
}

/** mbox-format patches for base..HEAD, applied on the host by the delivery target. */
export async function patchSince(sb: Sandbox, baseSha: string, opts: ExecOptions = {}): Promise<string> {
  return expectOk(await sb.exec(`git format-patch --stdout --no-color "$1"..HEAD`, [baseSha], { ...BIG_OUTPUT, ...opts }), "exporting patches").stdout;
}
