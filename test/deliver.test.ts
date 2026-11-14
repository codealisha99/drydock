import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deliverBranch } from "../src/server/git/deliver";
import { openGithubPullRequest, parseGithubRepo } from "../src/server/git/github";
import { patchSince, cloneWorkspace, commitPending } from "../src/server/sandbox-git";
import { runProcess } from "../src/server/process";
import type { Sandbox } from "../src/server/sandbox";
import { git, seedBareRepo } from "./helpers/git";

/** Clones the bare repo into a host dir (standing in for the sandbox) and commits a change there. */
async function sandboxWithChange(bare: string, branch: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "drydock-sb-"));
  const work = path.join(dir, "work");
  mkdirSync(work);
  const sb: Sandbox = {
    name: "sb",
    workspace: work,
    exec: (script, args = [], opts = {}) => runProcess("sh", ["-c", script, "drydock", ...args], { ...opts, cwd: work }),
  };
  const base = await cloneWorkspace(sb, { cloneUrl: bare, baseBranch: "main", workBranch: branch });
  writeFileSync(path.join(work, "src", "math.js"), "export function add(a, b) {\n  return a + b;\n}\n");
  await commitPending(sb, "drydock: fix add");
  return { sb, base };
}

const req = (overrides: Partial<Parameters<typeof deliverBranch>[1]> = {}) => ({
  workBranch: "drydock/run-1",
  baseBranch: "main",
  patch: "",
  title: "drydock: fix add",
  body: "body",
  diff: "diff",
  openPullRequest: true,
  ...overrides,
});

describe("deliverBranch (local bare remote)", () => {
  it("pushes the work branch to the bare remote and returns a PR record", async () => {
    const { bare } = seedBareRepo();
    const { sb, base } = await sandboxWithChange(bare, "drydock/run-1");
    const patch = await patchSince(sb, base);
    const result = await deliverBranch({ kind: "local", remotePath: bare }, req({ patch }));

    expect(result.provider).toBe("local");
    expect(result.url).toBe(`${bare}#drydock/run-1`);
    const pushed = git(["--git-dir", bare, "show", "drydock/run-1:src/math.js"], bare);
    expect(pushed).toContain("a + b");
    // main is untouched
    expect(git(["--git-dir", bare, "show", "main:src/math.js"], bare)).toContain("a - b");
  });

  it("appends follow-up commits to an existing branch", async () => {
    const { bare } = seedBareRepo();
    const { sb, base } = await sandboxWithChange(bare, "drydock/run-2");
    await deliverBranch({ kind: "local", remotePath: bare }, req({ workBranch: "drydock/run-2", patch: await patchSince(sb, base) }));
    const tip = await sb.exec("git rev-parse HEAD");
    writeFileSync(path.join(sb.workspace, "README.md"), "# calc\n\nUpdated by follow-up.\n");
    await commitPending(sb, "drydock: docs");
    const followPatch = await patchSince(sb, tip.stdout.trim());
    const second = await deliverBranch(
      { kind: "local", remotePath: bare },
      req({ workBranch: "drydock/run-2", patch: followPatch, openPullRequest: false }),
    );
    expect(second.provider).toBe("local");
    expect(git(["--git-dir", bare, "show", "drydock/run-2:README.md"], bare)).toContain("follow-up");
    expect(git(["--git-dir", bare, "show", "drydock/run-2:src/math.js"], bare)).toContain("a + b");
  });

  it("rejects an empty patch and invalid branch names", async () => {
    const { bare } = seedBareRepo();
    await expect(deliverBranch({ kind: "local", remotePath: bare }, req())).rejects.toThrow("nothing to deliver");
    await expect(deliverBranch({ kind: "local", remotePath: bare }, req({ workBranch: "a;rm -rf /", patch: "x" }))).rejects.toThrow(
      "invalid branch",
    );
  });
});

describe("GitHub PR client", () => {
  it("parses only github.com repo URLs", () => {
    expect(parseGithubRepo("https://github.com/acme/widgets.git")).toEqual({ owner: "acme", repo: "widgets" });
    expect(parseGithubRepo("https://github.com/acme/widgets")).toEqual({ owner: "acme", repo: "widgets" });
    expect(parseGithubRepo("https://evil.example.com/acme/widgets")).toBeNull();
    expect(parseGithubRepo("https://github.com/acme/widgets/../../x")).toBeNull();
  });

  it("opens a PR through the REST API with a bearer token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ html_url: "https://github.com/acme/widgets/pull/7", number: 7 }), { status: 201 });
    };
    const pr = await openGithubPullRequest({
      owner: "acme", repo: "widgets", token: "tok", head: "drydock/run-1", base: "main", title: "t", body: "b", fetchImpl,
    });
    expect(pr).toEqual({ url: "https://github.com/acme/widgets/pull/7", number: 7 });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/widgets/pulls");
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ head: "drydock/run-1", base: "main" });
  });

  it("surfaces GitHub errors", async () => {
    const fetchImpl = async () => new Response("Validation Failed", { status: 422 });
    await expect(
      openGithubPullRequest({ owner: "a", repo: "b", token: "t", head: "h", base: "main", title: "t", body: "", fetchImpl }),
    ).rejects.toThrow("HTTP 422");
  });
});
