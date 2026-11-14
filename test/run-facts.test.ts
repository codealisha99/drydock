import { describe, expect, it } from "vitest";
import { diffStats, summarizeRun, testSummary } from "../src/shared/run-facts";
import { parseRoute, pathFor } from "../src/web/route";

describe("summarizeRun", () => {
  it("counts steps, test totals before and after, files, follow-ups and duration", () => {
    const t = (ms: number) => new Date(Date.parse("2026-01-01T00:00:00.000Z") + ms).toISOString();
    const facts = summarizeRun([
      { type: "tool_call", data: { id: "a", name: "bash" }, createdAt: t(0) },
      { type: "tool_result", data: { id: "a", name: "bash", output: "# pass 2\n# fail 3" }, createdAt: t(100) },
      { type: "tool_call", data: { id: "b", name: "finish" }, createdAt: t(150) },
      { type: "user_message", data: { text: "first shares" }, createdAt: t(200) },
      { type: "tool_call", data: { id: "c", name: "bash" }, createdAt: t(300) },
      { type: "tool_result", data: { id: "c", name: "bash", output: "# pass 5\n# fail 0" }, createdAt: t(400) },
      { type: "diff", data: { diff: "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n" }, createdAt: t(450) },
    ]);
    expect(facts).toMatchObject({
      events: 7,
      steps: 2,
      testRuns: 2,
      testsBefore: { pass: 2, fail: 3 },
      testsAfter: { pass: 5, fail: 0 },
      filesChanged: 1,
      added: 1,
      removed: 1,
      followUps: 1,
      durationMs: 450,
    });
  });

  it("reports zeros for a run with no events", () => {
    expect(summarizeRun([])).toMatchObject({ events: 0, steps: 0, testsBefore: null, durationMs: 0 });
  });
});

describe("testSummary and diffStats", () => {
  it("returns null without TAP totals and ignores +++ / --- headers in diff counts", () => {
    expect(testSummary("Error")).toBeNull();
    expect(diffStats("diff --git a/a b/a\n--- a/a\n+++ b/a\n+one\n-two")).toEqual({ files: 1, added: 1, removed: 1 });
  });
});

describe("parseRoute", () => {
  it("maps paths to screens and keeps legacy hash run links", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("/runs/abc123def456")).toEqual({ name: "run", id: "abc123def456" });
    expect(parseRoute("/", "#/runs/abc123def456")).toEqual({ name: "run", id: "abc123def456" });
    expect(parseRoute("/no/such/page")).toEqual({ name: "missing", path: "/no/such/page" });
    expect(pathFor({ name: "run", id: "abc123def456" })).toBe("/runs/abc123def456");
  });
});
