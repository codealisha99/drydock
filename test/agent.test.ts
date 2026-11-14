import { describe, expect, it } from "vitest";
import { runAgent, type AgentEmitter } from "../src/server/agent";
import type { Sandbox } from "../src/server/sandbox";
import { scriptedModel, type ScriptStep } from "../src/server/model/scripted";
import type { Message, ModelClient } from "../src/server/model/types";

const fakeSandbox: Sandbox = {
  name: "fake",
  workspace: "/work",
  exec: async (script) => ({ code: 0, stdout: `ran: ${script}`, stderr: "", timedOut: false, aborted: false }),
};

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const call = (id: string, name: string, input: unknown) => ({ type: "tool_use" as const, id, name, input });

function run(model: ModelClient, opts: { maxSteps?: number; emit?: AgentEmitter; signal?: AbortSignal } = {}) {
  return runAgent([user("fix it")], {
    model,
    sandbox: fakeSandbox,
    emit: opts.emit ?? (() => undefined),
    signal: opts.signal ?? new AbortController().signal,
    maxSteps: opts.maxSteps ?? 5,
    system: "test",
  });
}

describe("runAgent", () => {
  it("runs tool calls and stops on a valid finish", async () => {
    const steps: ScriptStep[] = [
      { content: [call("1", "bash", { command: "node --test" })] },
      { content: [call("2", "finish", { status: "succeeded", summary: "All green." })] },
    ];
    const events: string[] = [];
    const result = await run(scriptedModel(steps), { emit: (t) => events.push(t) });
    expect(result.outcome).toEqual({ status: "succeeded", summary: "All green." });
    expect(events).toEqual(["tool_call", "tool_result", "tool_call", "tool_result"]);
    // user, assistant(bash), user(tool_result), assistant(finish), user(tool_result)
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    const last = result.messages.at(-1)!.content[0];
    expect(last).toMatchObject({ type: "tool_result", tool_use_id: "2" });
  });

  it("feeds an invalid finish back to the model instead of ending the run", async () => {
    const steps: ScriptStep[] = [
      { content: [call("1", "finish", { status: "maybe", summary: "x" })] },
      { content: [call("2", "finish", { status: "failed", summary: "Could not fix." })] },
    ];
    const result = await run(scriptedModel(steps));
    expect(result.outcome.status).toBe("failed");
    const firstResult = result.messages[2]!.content[0];
    expect(firstResult).toMatchObject({ type: "tool_result", is_error: true });
  });

  it("treats a turn with no tool calls as needs_input", async () => {
    const steps: ScriptStep[] = [{ content: [{ type: "text", text: "Which API should win?" }] }];
    const result = await run(scriptedModel(steps));
    expect(result.outcome).toEqual({ status: "needs_input", summary: "Which API should win?" });
  });

  it("fails when the step budget runs out", async () => {
    const steps: ScriptStep[] = Array.from({ length: 3 }, (_, i) => ({ content: [call(String(i), "bash", { command: "true" })] }));
    const result = await run(scriptedModel(steps), { maxSteps: 2 });
    expect(result.outcome).toEqual({ status: "failed", summary: "Step budget of 2 exhausted before finishing." });
  });

  it("maps refusals to needs_input", async () => {
    const result = await run(scriptedModel([{ content: [], stopReason: "refusal" }]));
    expect(result.outcome.status).toBe("needs_input");
  });

  it("stops promptly when the run is cancelled", async () => {
    const ctrl = new AbortController();
    const hanging: ModelClient = {
      complete: (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    };
    const pending = run(hanging, { signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toThrow();
  });
});
