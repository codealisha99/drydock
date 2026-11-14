import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, ModelClient, ModelRequest, ModelResponse, StopReason } from "./types";

const MAX_OUTPUT_TOKENS = 16_000;

type SdkBlock = Anthropic.Messages.ContentBlock;

function fromSdkBlock(block: SdkBlock): ContentBlock | null {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return { type: "thinking", thinking: block.thinking, signature: block.signature };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    default:
      return null;
  }
}

function mapStop(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

/** Claude via the official SDK. Reads ANTHROPIC_API_KEY from the environment; the key never reaches the sandbox. */
export function anthropicModel(opts: { model: string; client?: Anthropic }): ModelClient {
  const client = opts.client ?? new Anthropic();
  return {
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
      const response = await client.messages.create(
        {
          model: opts.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: request.system,
          // Our blocks are structurally Anthropic's; the cast only narrows `input` to the SDK's object type.
          messages: request.messages as unknown as Anthropic.MessageParam[],
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          })),
        },
        { signal },
      );
      const content = response.content.map(fromSdkBlock).filter((b): b is ContentBlock => b !== null);
      return { content, stopReason: mapStop(response.stop_reason) };
    },
  };
}
