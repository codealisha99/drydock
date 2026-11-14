import type { RunFacts } from "./api";
import { formatDuration } from "./format";

/** "3 failing → 0 failing" for the test runs of a run, or null when it never ran tests. Pure. */
export function testsLine(facts: RunFacts): string | null {
  if (!facts.testsBefore || !facts.testsAfter) return null;
  return `${facts.testsBefore.fail} failing → ${facts.testsAfter.fail} failing`;
}

/** "+5 −4 in 3 files", or "No file changes". */
export function changesLine(facts: RunFacts): string {
  if (facts.filesChanged === 0) return "No file changes";
  const files = `${facts.filesChanged} ${facts.filesChanged === 1 ? "file" : "files"}`;
  return `${files}, +${facts.added} −${facts.removed}`;
}

export function durationLine(facts: RunFacts): string {
  return facts.durationMs > 0 ? formatDuration(facts.durationMs) : "Under a second";
}
