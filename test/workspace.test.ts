import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../src/server/workspace";

describe("resolveWorkspacePath", () => {
  it("maps relative paths under /work", () => {
    expect(resolveWorkspacePath("src/math.js")).toBe("/work/src/math.js");
    expect(resolveWorkspacePath("./src/../src/math.js")).toBe("/work/src/math.js");
  });

  it.each([
    ["absolute path", "/etc/passwd"],
    ["parent escape", "../secrets"],
    ["nested escape", "src/../../etc"],
    ["NUL byte", "a\u0000b"],
    ["empty", ""],
    ["workspace root itself", "."],
  ])("rejects %s", (_label, input) => {
    expect(() => resolveWorkspacePath(input)).toThrow();
  });
});
