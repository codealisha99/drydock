import type { ContentBlock, Message, ModelClient, ModelRequest, ModelResponse, StopReason } from "./types";

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OpenAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Converts our Anthropic-shaped history into OpenAI chat messages. Exported for tests. */
export function toOpenAIMessages(system: string, messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      const calls = msg.content.flatMap((b): OpenAIToolCall[] =>
        b.type === "tool_use" ? [{ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }] : [],
      );
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const b of msg.content) {
      if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
      else if (b.type === "text") out.push({ role: "user", content: b.text });
    }
  }
  return out;
}

function mapFinish(reason: string | null): StopReason {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop") return "end_turn";
  if (reason === "content_filter") return "refusal";
  return "other";
}

/** Any OpenAI-compatible /chat/completions endpoint (Ollama, OpenRouter, Groq, ...). */
export function openAICompatibleModel(opts: { baseUrl: string; apiKey?: string; model: string; fetchImpl?: typeof fetch }): ModelClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
      const body = {
        model: opts.model,
        max_tokens: 8192,
        messages: toOpenAIMessages(request.system, request.messages),
        tools: request.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
      };
      const res = await fetchImpl(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(`model endpoint returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as {
        choices: { finish_reason: string | null; message: { content: string | null; tool_calls?: OpenAIToolCall[] } }[];
      };
      const choice = json.choices[0];
      if (!choice) throw new Error("model endpoint returned no choices");
      const content: ContentBlock[] = [];
      if (choice.message.content) content.push({ type: "text", text: choice.message.content });
      for (const call of choice.message.tool_calls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.function.name, input: parseArgs(call.function.arguments) });
      }
      return { content, stopReason: mapFinish(choice.finish_reason) };
    },
  };
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Left as a string on purpose: tool input validation rejects it and reports the error to the model.
    return raw;
  }
}
