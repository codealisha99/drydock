import { describe, expect, it } from "vitest";
import { buildTimeline, toolHeadline } from "../src/web/timeline-model";
import { parseDiff } from "../src/web/DiffView";
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
