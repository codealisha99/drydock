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
  // Three bugs across three modules, with five test runs: fail 3, then 2, 1, and 0. Each run is real.
  "multi-file-fix": [
    { content: [{ type: "text", text: "Running the suite before I touch anything." }, call(1, "bash", { command: "node --test" })] },
    { content: [{ type: "text", text: "Three failures across cart, format and split. Starting with the cart total, since the others depend on it." }, call(2, "read_file", { path: "src/cart.js" })] },
    {
      content: [
        { type: "text", text: "The discount is applied after tax. Moving it ahead of the tax calculation." },
        call(3, "edit_file", {
          path: "src/cart.js",
          old_string: "  const tax = Math.round(subtotal * TAX_RATE);\n  const discount = Math.round(subtotal * (discountPct / 100));\n  return subtotal - discount + tax;",
          new_string: "  const discount = Math.round(subtotal * (discountPct / 100));\n  const taxable = subtotal - discount;\n  const tax = Math.round(taxable * TAX_RATE);\n  return taxable + tax;",
        }),
      ],
    },
    { content: [{ type: "text", text: "Re-running. The cart test should pass now; two failures remain." }, call(4, "bash", { command: "node --test" })] },
    { content: [{ type: "text", text: "formatMoney drops the pence. Reading it before I change it." }, call(5, "read_file", { path: "src/format.js" })] },
    { content: [{ type: "text", text: "toFixed(0) rounds to whole dollars. Showing two decimals." }, call(6, "edit_file", { path: "src/format.js", old_string: "(pence / 100).toFixed(0)", new_string: "(pence / 100).toFixed(2)" })] },
    { content: [{ type: "text", text: "One failure left, in splitEvenly. Reading it." }, call(7, "read_file", { path: "src/split.js" })] },
    {
      content: [
        { type: "text", text: "The remainder is dropped, so splitEvenly(10, 3) returns [3, 3, 3]. The first shares should take the extra pence." },
        call(8, "edit_file", {
          path: "src/split.js",
          old_string: "  return Array.from({ length: n }, () => Math.floor(total / n));",
          new_string: "  return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));",
        }),
      ],
    },
    { content: [{ type: "text", text: "Running the full suite." }, call(9, "bash", { command: "node --test" })] },
    {
      content: [
        call(10, "finish", {
          status: "succeeded",
          summary: "Fixed cartTotal (discount before tax), formatMoney (two decimals) and splitEvenly (remainder to the first shares). All 5 tests pass.",
        }),
      ],
    },
  ],
  // Runs the real suite in the sandbox, reads the code, then gives up with an honest failure and no edits.
  "cannot-fix": [
    { content: [{ type: "text", text: "Running the suite before changing anything." }, call(1, "bash", { command: "node --test" })] },
    { content: [{ type: "text", text: "Reading add() to see what the test expects." }, call(2, "read_file", { path: "src/math.js" })] },
    {
      content: [
        call(3, "finish", {
          status: "failed",
          summary: "The test still fails and I could not find a change to src/math.js that is consistent with it. No files changed.",
        }),
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

/**
 * Scenarios with follow-ups. Turn n of a run uses turns[n]; a turn starts at each user text message
 * (the instruction, then each follow-up). Tool results are not user text, so they do not start a turn.
 */
export const TURN_SCRIPTS: Record<string, readonly (readonly ScriptStep[])[]> = {
  // Asks which convention wins, stops with needs_input, then makes all three fixes after the follow-up.
  "clarify-then-fix": [
    [
      { content: [{ type: "text", text: "Running the suite to see what fails." }, call(1, "bash", { command: "node --test" })] },
      {
        content: [
          { type: "text", text: "Three failures. One is a real conflict: the test expects the remainder on the first shares, the README says the last share. I will ask rather than guess." },
          call(2, "read_file", { path: "README.md" }),
        ],
      },
      {
        content: [
          call(3, "finish", {
            status: "needs_input",
            summary: "The split test expects the remainder pence on the first shares, but README.md says the last share takes them. Which should win?",
          }),
        ],
      },
    ],
    [
      { content: [{ type: "text", text: "Following the test: the first shares take the remainder. Fixing the other two bugs as well." }, call(4, "read_file", { path: "src/cart.js" })] },
      {
        content: [
          { type: "text", text: "The discount is applied after tax. Moving it ahead of the tax calculation." },
          call(5, "edit_file", {
            path: "src/cart.js",
            old_string: "  const tax = Math.round(subtotal * TAX_RATE);\n  const discount = Math.round(subtotal * (discountPct / 100));\n  return subtotal - discount + tax;",
            new_string: "  const discount = Math.round(subtotal * (discountPct / 100));\n  const taxable = subtotal - discount;\n  const tax = Math.round(taxable * TAX_RATE);\n  return taxable + tax;",
          }),
        ],
      },
      {
        content: [
          { type: "text", text: "formatMoney rounds to whole dollars. Showing two decimals." },
          call(6, "edit_file", { path: "src/format.js", old_string: "(pence / 100).toFixed(0)", new_string: "(pence / 100).toFixed(2)" }),
        ],
      },
      {
        content: [
          { type: "text", text: "splitEvenly drops the remainder. The first shares take one extra pence each." },
          call(7, "edit_file", {
            path: "src/split.js",
            old_string: "  return Array.from({ length: n }, () => Math.floor(total / n));",
            new_string: "  return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));",
          }),
        ],
      },
      { content: [{ type: "text", text: "Running the full suite." }, call(8, "bash", { command: "node --test" })] },
      {
        content: [
          { type: "text", text: "All five pass. Updating the README so it matches the test." },
          call(9, "edit_file", {
            path: "README.md",
            old_string: "the remainder pence go to the last share.",
            new_string: "the remainder pence go to the first shares, one pence each.",
          }),
        ],
      },
      {
        content: [
          call(10, "finish", {
            status: "succeeded",
            summary: "Fixed cartTotal (discount before tax), formatMoney (two decimals) and splitEvenly (remainder to the first shares). README matches. All 5 tests pass.",
          }),
        ],
      },
    ],
  ],
};

/** Every scripted scenario as turns. A single-turn script is one turn. */
export function scriptTurns(name: string): readonly (readonly ScriptStep[])[] | undefined {
  if (TURN_SCRIPTS[name]) return TURN_SCRIPTS[name];
  const steps = SCRIPTS[name];
  return steps ? [steps] : undefined;
}

/** Like scriptedModel, but picks the turn's steps from the conversation (see TURN_SCRIPTS). */
export function scriptedTurnsModel(turns: readonly (readonly ScriptStep[])[]): ModelClient {
  const byTurn = new Map<number, ModelClient>();
  return {
    complete(request, signal) {
      const userTurns = request.messages.filter((m) => m.role === "user" && m.content.some((b) => b.type === "text")).length;
      const turn = Math.max(0, userTurns - 1);
      let model = byTurn.get(turn);
      if (!model) {
        model = scriptedModel(turns[turn] ?? []);
        byTurn.set(turn, model);
      }
      return model.complete(request, signal);
    },
  };
}

export function scriptNames(): string[] {
  return [...Object.keys(SCRIPTS), ...Object.keys(TURN_SCRIPTS)];
}
