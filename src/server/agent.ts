import { FinishInput, runSandboxTool, TOOL_SPECS, type Outcome } from "./tools";
import type { Sandbox } from "./sandbox";
import type { ContentBlock, Message, ModelClient } from "./model/types";
import { textOf } from "./model/types";

export interface AgentEmitter {
  (type: "model_text" | "tool_call" | "tool_result", data: Record<string, unknown>): void;
}

export interface AgentOptions {
  model: ModelClient;
  sandbox: Sandbox;
  emit: AgentEmitter;
  signal: AbortSignal;
  maxSteps: number;
  system: string;
}

export interface AgentResult {
  messages: Message[];
  outcome: Outcome;
}

export const SYSTEM_PROMPT = `You are a coding agent working in a git repository checked out at /work on a dedicated branch.
Use the tools to inspect, change and verify the code. Run the project's tests before finishing.
When the task is complete and verified, call finish with status "succeeded".
If a human decision is required, call finish with status "needs_input" and ask the question in the summary.
If you cannot complete the task, call finish with status "failed" and explain why.
Keep the summary to one short line.`;

const ABORT_ERROR = "AbortError";

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("run cancelled", ABORT_ERROR);
}

/** Records the model's visible text and returns the tool-use blocks to execute. */
function narrate(content: ContentBlock[], emit: AgentEmitter): ContentBlock[] {
  for (const block of content) {
    if (block.type === "text" && block.text.trim()) emit("model_text", { text: block.text });
  }
  return content.filter((b) => b.type === "tool_use");
}

async function executeCalls(
  calls: ContentBlock[],
  opts: AgentOptions,
): Promise<{ results: ContentBlock[]; outcome: Outcome | null }> {
  const results: ContentBlock[] = [];
  let outcome: Outcome | null = null;
  for (const call of calls) {
    if (call.type !== "tool_use") continue;
    throwIfAborted(opts.signal);
    opts.emit("tool_call", { id: call.id, name: call.name, input: call.input });
    if (call.name === "finish") {
      const parsed = FinishInput.safeParse(call.input);
      if (parsed.success && outcome === null) outcome = parsed.data;
      const content = parsed.success ? "finished" : `invalid finish input: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
      opts.emit("tool_result", { id: call.id, name: call.name, output: content, isError: !parsed.success });
      results.push({ type: "tool_result", tool_use_id: call.id, content, is_error: !parsed.success });
      continue;
    }
    const res = await runSandboxTool(opts.sandbox, call.name, call.input, opts.signal);
    opts.emit("tool_result", { id: call.id, name: call.name, output: res.content, isError: res.isError });
    results.push({ type: "tool_result", tool_use_id: call.id, content: res.content, is_error: res.isError });
  }
  return { results, outcome };
}

/**
 * The agent loop: ask the model, run its tool calls in the sandbox, feed results back,
 * until it calls finish (or stops calling tools, or runs out of steps).
 * Returns the full transcript so a follow-up message can continue the conversation.
 */
export async function runAgent(history: Message[], opts: AgentOptions): Promise<AgentResult> {
  let messages = history;
  for (let step = 1; step <= opts.maxSteps; step += 1) {
    throwIfAborted(opts.signal);
    const response = await opts.model.complete({ system: opts.system, messages, tools: TOOL_SPECS }, opts.signal);
    const calls = narrate(response.content, opts.emit);
    messages = [...messages, { role: "assistant", content: response.content }];

    if (response.stopReason === "refusal") {
      return { messages, outcome: { status: "needs_input", summary: "The model declined this request; a human should review it." } };
    }
    if (response.stopReason === "max_tokens") {
      return { messages, outcome: { status: "failed", summary: "The model hit its output limit before finishing." } };
    }
    if (calls.length === 0) {
      const text = textOf(response.content).split("\n")[0] ?? "";
      return {
        messages,
        outcome: { status: "needs_input", summary: (text || "The agent stopped without calling finish.").slice(0, 200) },
      };
    }

    const { results, outcome } = await executeCalls(calls, opts);
    messages = [...messages, { role: "user", content: results }];
    if (outcome) return { messages, outcome };
  }
  return { messages, outcome: { status: "failed", summary: `Step budget of ${opts.maxSteps} exhausted before finishing.` } };
}
