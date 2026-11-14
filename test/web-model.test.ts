import { describe, expect, it } from "vitest";
import { buildTimeline, testSummary, toolHeadline } from "../src/web/timeline-model";
import { parseDiff } from "../src/web/DiffView";
import { tokenizeCode } from "../src/web/code-highlight";
import { LOCAL_RUN_COMMAND } from "../src/web/local-run";
import type { StreamEvent } from "../src/web/api";

const ev = (seq: number, type: StreamEvent["type"], data: Record<string, unknown>): StreamEvent => ({
  runId: "r", seq, type, data, createdAt: "2026-01-01T00:00:00.000Z",
});

describe("buildTimeline", () => {
  it("attaches tool results to their call and hides diff events", () => {
    const items = buildTimeline([
      ev(1, "status", { status: "running", message: "workspace ready" }),
      ev(2, "tool_call", { id: "t1", name: "bash", input: { command: "node --test" } }),
      ev(3, "diff", { diff: "x" }),
      ev(4, "tool_result", { id: "t1", name: "bash", output: "fail 1\n[exit 1]", isError: true }),
      ev(5, "outcome", { status: "succeeded", summary: "done" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["status", "tool", "outcome"]);
    expect(items[1]).toMatchObject({ kind: "tool", output: "fail 1\n[exit 1]", isError: true });
  });

  it("keeps an unmatched tool result from corrupting other rows", () => {
    const items = buildTimeline([ev(1, "tool_result", { id: "ghost", output: "x", isError: false })]);
    expect(items).toEqual([]);
  });

  it("headlines tool calls by their most useful field", () => {
    expect(toolHeadline("edit_file", { path: "src/math.js", old_string: "a", new_string: "b" })).toBe("src/math.js");
    expect(toolHeadline("bash", { command: "npm test" })).toBe("npm test");
  });
});

describe("parseDiff", () => {
  it("counts additions and removals per file", () => {
    const diff = [
      "diff --git a/src/math.js b/src/math.js",
      "--- a/src/math.js",
      "+++ b/src/math.js",
      "@@ -1,3 +1,3 @@",
      "-  return a - b;",
      "+  return a + b;",
      " }",
    ].join("\n");
    const [file] = parseDiff(diff);
    expect(file).toMatchObject({ path: "src/math.js", added: 1, removed: 1 });
  });
});

describe("parseDiff rows", () => {
  it("numbers old and new lines from hunk headers and keeps context rows", () => {
    const diff = [
      "diff --git a/src/cart.js b/src/cart.js",
      "--- a/src/cart.js",
      "+++ b/src/cart.js",
      "@@ -10,3 +10,4 @@ export function cartTotal() {",
      "   const subtotal = 1;",
      "-  const tax = 2;",
      "+  const discount = 3;",
      "+  const tax = 4;",
      "   return subtotal;",
    ].join("\n");
    const [file] = parseDiff(diff);
    expect(file!.rows.map((r) => [r.kind, r.oldNo, r.newNo])).toEqual([
      ["hunk", null, null],
      ["context", 10, 10],
      ["del", 11, null],
      ["add", null, 11],
      ["add", null, 12],
      ["context", 12, 13],
    ]);
  });
});

describe("tokenizeCode", () => {
  it("splits keywords, strings, numbers and comments", () => {
    const tokens = tokenizeCode("  return a + 'x'; // done 42");
    expect(tokens.filter((t) => t.kind !== "plain")).toEqual([
      { text: "return", kind: "keyword" },
      { text: "'x'", kind: "string" },
      { text: "// done 42", kind: "comment" },
    ]);
  });

  it("keeps the text exactly, so the highlighted line is the original line", () => {
    const line = "const t = `${a}` + 1.5 * (b - 2);";
    expect(tokenizeCode(line).map((t) => t.text).join("")).toBe(line);
  });
});

describe("testSummary", () => {
  it("reads the node --test TAP totals and returns null when there are none", () => {
    expect(testSummary("ok 1 - a\n# tests 5\n# pass 2\n# fail 3\n")).toEqual({ pass: 2, fail: 3 });
    expect(testSummary("Error: boom")).toBeNull();
  });
});

describe("LOCAL_RUN_COMMAND", () => {
  it("is the keyless one-line command that starts real runs locally", () => {
    expect(LOCAL_RUN_COMMAND).toBe("DRYDOCK_MODEL_PROVIDER=scripted pnpm api");
  });
});

describe("finish tool calls", () => {
  it("are left out of the timeline because the outcome row carries their summary", () => {
    const items = buildTimeline([
      ev(1, "tool_call", { id: "f1", name: "finish", input: { status: "succeeded", summary: "done" } }),
      ev(2, "tool_result", { id: "f1", name: "finish", output: "finished", isError: false }),
      ev(3, "outcome", { status: "succeeded", summary: "done" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["outcome"]);
  });
});
