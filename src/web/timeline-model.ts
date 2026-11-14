import type { StreamEvent } from "./api";

export type TimelineItem =
  | { kind: "status"; seq: number; text: string; at: string }
  | { kind: "user"; seq: number; text: string; at: string }
  | { kind: "agent"; seq: number; text: string; at: string }
  | {
      kind: "tool";
      seq: number;
      id: string;
      name: string;
      input: Record<string, unknown>;
      output: string | null;
      isError: boolean;
      at: string;
    }
  | { kind: "delivery"; seq: number; url: string; branch: string; provider: string; at: string }
  | { kind: "outcome"; seq: number; status: string; summary: string; at: string }
  | { kind: "error"; seq: number; message: string; at: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Folds the raw event stream into timeline rows. A tool_result is attached to its tool_call
 * (matched by id), so each tool call renders as one card with its output. Diff events feed the
 * side panel, not the timeline. Pure: returns a new array.
 */
export function buildTimeline(events: readonly StreamEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const toolIndex = new Map<string, number>();
  for (const e of events) {
    const at = e.createdAt;
    const d = e.data;
    switch (e.type) {
      case "status": {
        const text = str(d.message) || str(d.status).replace(/_/g, " ");
        if (text) items.push({ kind: "status", seq: e.seq, text, at });
        break;
      }
      case "user_message":
        items.push({ kind: "user", seq: e.seq, text: str(d.text), at });
        break;
      case "model_text":
        items.push({ kind: "agent", seq: e.seq, text: str(d.text), at });
        break;
      case "tool_call": {
        // finish is the agent's closing call; the outcome row shows its status and summary instead.
        if (str(d.name) === "finish") break;
        const id = str(d.id);
        toolIndex.set(id, items.length);
        items.push({
          kind: "tool",
          seq: e.seq,
          id,
          name: str(d.name),
          input: (d.input ?? {}) as Record<string, unknown>,
          output: null,
          isError: false,
          at,
        });
        break;
      }
      case "tool_result": {
        const idx = toolIndex.get(str(d.id));
        const target = idx === undefined ? undefined : items[idx];
        if (idx !== undefined && target?.kind === "tool") {
          items[idx] = { ...target, output: str(d.output), isError: d.isError === true };
        }
        break;
      }
      case "delivery":
        items.push({ kind: "delivery", seq: e.seq, url: str(d.url), branch: str(d.branch), provider: str(d.provider), at });
        break;
      case "outcome":
        items.push({ kind: "outcome", seq: e.seq, status: str(d.status), summary: str(d.summary), at });
        break;
      case "error":
        items.push({ kind: "error", seq: e.seq, message: str(d.message), at });
        break;
      case "diff":
        break;
    }
  }
  return items;
}

/** Short one-line description of a tool call's input, shown in the card header. */
export function toolHeadline(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "bash":
      return str(input.command);
    case "read_file":
    case "write_file":
    case "edit_file":
      return str(input.path);
    case "finish":
      return `${str(input.status)}: ${str(input.summary)}`;
    default:
      return JSON.stringify(input);
  }
}

/** Totals from node --test's TAP summary lines ("# pass 2", "# fail 3"). Null when the output has none. */
export function testSummary(output: string): { pass: number; fail: number } | null {
  const pass = /^# pass (\d+)$/m.exec(output);
  const fail = /^# fail (\d+)$/m.exec(output);
  if (!pass && !fail) return null;
  return { pass: Number(pass?.[1] ?? 0), fail: Number(fail?.[1] ?? 0) };
}
