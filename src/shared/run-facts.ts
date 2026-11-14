/** Pure summaries of a run's event stream. Shared by the live API, the showcase and the web UI. No imports. */

export interface TestTotals {
  pass: number;
  fail: number;
}

export interface RunFacts {
  /** Events recorded for the run so far. */
  events: number;
  /** Tool calls the agent made, not counting the closing finish call. */
  steps: number;
  /** Shell test runs that printed TAP totals. */
  testRuns: number;
  testsBefore: TestTotals | null;
  testsAfter: TestTotals | null;
  filesChanged: number;
  added: number;
  removed: number;
  /** Follow-up messages the user sent after the first turn. */
  followUps: number;
  /** Milliseconds from the first recorded event to the last. */
  durationMs: number;
}

export interface FactSource {
  type: string;
  data: unknown;
  createdAt: string;
}

/** Reads node --test's TAP totals ("# pass 2", "# fail 3"). Null when the output has none. */
export function testSummary(output: string): TestTotals | null {
  const pass = /^# pass (\d+)$/m.exec(output);
  const fail = /^# fail (\d+)$/m.exec(output);
  if (!pass && !fail) return null;
  return { pass: Number(pass?.[1] ?? 0), fail: Number(fail?.[1] ?? 0) };
}

/** Counts files and +/- lines in a unified diff. Headers ("+++", "---") are not changes. */
export function diffStats(diff: string): { files: number; added: number; removed: number } {
  let files = 0;
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) files += 1;
    else if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { files, added, removed };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function summarizeRun(events: readonly FactSource[]): RunFacts {
  const facts: RunFacts = {
    events: events.length,
    steps: 0,
    testRuns: 0,
    testsBefore: null,
    testsAfter: null,
    filesChanged: 0,
    added: 0,
    removed: 0,
    followUps: 0,
    durationMs: 0,
  };
  const toolNames = new Map<string, string>();
  let latestDiff: string | null = null;
  for (const e of events) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    if (e.type === "tool_call") {
      toolNames.set(str(d.id), str(d.name));
      if (str(d.name) !== "finish") facts.steps += 1;
    } else if (e.type === "tool_result" && (str(d.name) || toolNames.get(str(d.id))) === "bash") {
      const totals = testSummary(str(d.output));
      if (!totals) continue;
      facts.testRuns += 1;
      facts.testsBefore ??= totals;
      facts.testsAfter = totals;
    } else if (e.type === "diff") {
      latestDiff = str(d.diff);
    } else if (e.type === "user_message") {
      facts.followUps += 1;
    }
  }
  if (latestDiff) {
    const stats = diffStats(latestDiff);
    facts.filesChanged = stats.files;
    facts.added = stats.added;
    facts.removed = stats.removed;
  }
  if (events.length > 1) {
    facts.durationMs = Math.max(0, Date.parse(events[events.length - 1]!.createdAt) - Date.parse(events[0]!.createdAt));
  }
  return facts;
}
