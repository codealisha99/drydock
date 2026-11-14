/** Provider-neutral message shape. It mirrors Anthropic's content blocks, the richest format. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface ModelRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
}

export interface ModelResponse {
  content: ContentBlock[];
  stopReason: StopReason;
}

export interface ModelClient {
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

export function textOf(blocks: ContentBlock[]): string {
  return blocks
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}
