import type { ContentBlock, ModelClient, ModelResponse } from "./types";

export type ScriptStep = { content: ContentBlock[]; stopReason?: ModelResponse["stopReason"] };

/** Replays a fixed list of responses. Deterministic and keyless: used by tests and the demo. */
export function scriptedModel(steps: readonly ScriptStep[]): ModelClient {
  let cursor = 0;
  return {
    async complete(_request, signal) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const step = steps[cursor];
      cursor += 1;
      if (!step) return { content: [{ type: "text", text: "Script exhausted." }], stopReason: "end_turn" };
      return { content: step.content, stopReason: step.stopReason ?? (step.content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") };
    },
  };
}

const call = (n: number, name: string, input: unknown): ContentBlock => ({ type: "tool_use", id: `toolu_script_${n}`, name, input });

/** The demo scenario: a seeded project whose add() subtracts, with a failing test. */
export const SCRIPTS: Record<string, readonly ScriptStep[]> = {
  "fix-failing-test": [
    { content: [{ type: "text", text: "I'll run the test suite to see the failure first." }, call(1, "bash", { command: "node --test" })] },
    { content: [{ type: "text", text: "add() is subtracting. Reading the source before editing." }, call(2, "read_file", { path: "src/math.js" })] },
    {
      content: [
        { type: "text", text: "The operator is wrong in add(). Fixing it." },
        call(3, "edit_file", { path: "src/math.js", old_string: "return a - b;", new_string: "return a + b;" }),
      ],
    },
    { content: [{ type: "text", text: "Re-running the suite." }, call(4, "bash", { command: "node --test" })] },
    {
      content: [
        call(5, "finish", { status: "succeeded", summary: "Fixed add() to return a + b; the test suite passes." }),
      ],
    },
  ],
  "needs-input": [
    {
      content: [
        call(1, "finish", {
          status: "needs_input",
          summary: "Two valid fixes exist for the failing test; which API should win?",
        }),
      ],
    },
  ],
};

export function scriptNames(): string[] {
  return Object.keys(SCRIPTS);
}
