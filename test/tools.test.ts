import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/server/process";
import type { Sandbox } from "../src/server/sandbox";
import { runSandboxTool } from "../src/server/tools";

function localSandbox(): { sb: Sandbox; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "drydock-tools-"));
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "math.js"), "return a - b;\nreturn a - b;\n");
  const sb: Sandbox = {
    name: "test",
    workspace: dir,
    exec: (script, args = [], opts = {}) => runProcess("sh", ["-c", script, "drydock", ...args], { ...opts, cwd: dir }),
  };
  return { sb, dir };
}

describe("runSandboxTool", () => {
  it("reads and writes files inside the workspace", async () => {
    const { sb, dir } = localSandbox();
    const read = await runSandboxTool(sb, "read_file", { path: "src/math.js" });
    expect(read.isError).toBe(false);
    expect(read.content).toContain("return a - b;");
    const write = await runSandboxTool(sb, "write_file", { path: "notes/todo.txt", content: "hello" });
    expect(write.isError).toBe(false);
    expect(readFileSync(path.join(dir, "notes", "todo.txt"), "utf8")).toBe("hello");
  });

  it("refuses edits whose old_string is not unique", async () => {
    const { sb } = localSandbox();
    const res = await runSandboxTool(sb, "edit_file", { path: "src/math.js", old_string: "return a - b;", new_string: "x" });
    expect(res.isError).toBe(true);
    expect(res.content).toContain("found 2");
  });

  it("applies a unique edit", async () => {
    const { sb, dir } = localSandbox();
    writeFileSync(path.join(dir, "src", "math.js"), "export const add = (a, b) => a - b;\n");
    const res = await runSandboxTool(sb, "edit_file", { path: "src/math.js", old_string: "a - b", new_string: "a + b" });
    expect(res.isError).toBe(false);
    expect(readFileSync(path.join(dir, "src", "math.js"), "utf8")).toContain("a + b");
  });

  it("never truncates a file while editing it", async () => {
    const { sb, dir } = localSandbox();
    const big = `MARK\n${"x".repeat(300_000)}\n`;
    writeFileSync(path.join(dir, "big.txt"), big);
    const res = await runSandboxTool(sb, "edit_file", { path: "big.txt", old_string: "MARK", new_string: "DONE" });
    const onDisk = readFileSync(path.join(dir, "big.txt"), "utf8");
    expect(onDisk === big.replace("MARK", "DONE") || (res.isError && onDisk === big)).toBe(true);
  });

  it("rejects path escapes before touching the sandbox", async () => {
    const { sb } = localSandbox();
    const res = await runSandboxTool(sb, "read_file", { path: "../../etc/passwd" });
    expect(res.isError).toBe(true);
    expect(res.content).toContain("escapes");
  });

  it("returns invalid model input as an error result instead of throwing", async () => {
    const { sb } = localSandbox();
    const res = await runSandboxTool(sb, "bash", { command: 42 });
    expect(res.isError).toBe(true);
    expect(res.content).toContain("invalid input");
  });

  it("reports bash exit status", async () => {
    const { sb } = localSandbox();
    expect((await runSandboxTool(sb, "bash", { command: "echo hi" })).content).toContain("[exit 0]");
    const failed = await runSandboxTool(sb, "bash", { command: "echo boom >&2; exit 3" });
    expect(failed.isError).toBe(true);
    expect(failed.content).toContain("[exit 3]");
  });
});
