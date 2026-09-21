/** Normalize Anthropic-native and OpenAI-shaped gateway responses. */

export interface NormalizedTextBlock {
  type: "text";
  text: string;
}

export interface NormalizedToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export type NormalizedBlock = NormalizedTextBlock | NormalizedToolUseBlock;

export interface NormalizedMessage {
  blocks: NormalizedBlock[];
  stopReason: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

function mapOpenAiFinishReason(reason: unknown): string | null {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  return typeof reason === "string" ? reason : null;
}

function parseToolArguments(args: unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  try {
    return JSON.parse(args);
  } catch {
    return { _raw: args };
  }
}

/** Convert a raw `messages.create` result (either API shape) to blocks. */
export function normalizeMessageResponse(raw: unknown): NormalizedMessage {
  if (typeof raw !== "object" || raw === null) {
    return { blocks: [], stopReason: null };
  }
  const r = raw as Record<string, unknown>;

  // OpenAI chat.completion shape (this gateway returns it for non-streaming).
  if (Array.isArray(r["choices"])) {
    const choice = (r["choices"] as Record<string, unknown>[])[0] as
      | Record<string, unknown>
      | undefined;
    const message = choice?.["message"] as Record<string, unknown> | undefined;
    const blocks: NormalizedBlock[] = [];
    const content = message?.["content"];
    if (typeof content === "string" && content.length > 0) {
      blocks.push({ type: "text", text: content });
    } else if (Array.isArray(content)) {
      for (const part of content as Record<string, unknown>[]) {
        if (part?.["type"] === "text" && typeof part["text"] === "string") {
          blocks.push({ type: "text", text: part["text"] as string });
        }
      }
    }
    const toolCalls = message?.["tool_calls"];
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls as Record<string, unknown>[]) {
        const fn = call?.["function"] as Record<string, unknown> | undefined;
        const id = call?.["id"];
        const name = fn?.["name"];
        if (typeof id === "string" && typeof name === "string") {
          blocks.push({
            type: "tool_use",
            id,
            name,
            input: parseToolArguments(fn?.["arguments"]),
          });
        }
      }
    }
    const usage = r["usage"] as Record<string, unknown> | undefined;
    return {
      blocks,
      stopReason: mapOpenAiFinishReason(choice?.["finish_reason"]),
      inputTokens:
        typeof usage?.["prompt_tokens"] === "number"
          ? (usage["prompt_tokens"] as number)
          : undefined,
      outputTokens:
        typeof usage?.["completion_tokens"] === "number"
          ? (usage["completion_tokens"] as number)
          : undefined,
    };
  }

  // Anthropic-native Message shape.
  if (Array.isArray(r["content"])) {
    const blocks: NormalizedBlock[] = [];
    for (const b of r["content"] as Record<string, unknown>[]) {
      if (b?.["type"] === "text" && typeof b["text"] === "string") {
        blocks.push({ type: "text", text: b["text"] as string });
      } else if (b?.["type"] === "tool_use") {
        blocks.push({
          type: "tool_use",
          id: String(b["id"] ?? ""),
          name: String(b["name"] ?? ""),
          input: (b["input"] ?? {}) as unknown,
        });
      }
    }
    const usage = r["usage"] as Record<string, unknown> | undefined;
    return {
      blocks,
      stopReason:
        typeof r["stop_reason"] === "string"
          ? (r["stop_reason"] as string)
          : (r["stop_reason"] as null) ?? null,
      inputTokens:
        typeof usage?.["input_tokens"] === "number"
          ? (usage["input_tokens"] as number)
          : undefined,
      outputTokens:
        typeof usage?.["output_tokens"] === "number"
          ? (usage["output_tokens"] as number)
          : undefined,
    };
  }

  return { blocks: [], stopReason: null };
}

export function normalizedText(msg: NormalizedMessage): string {
  return msg.blocks
    .filter((b) => b.type === "text")
    .map((b) => (b as NormalizedTextBlock).text)
    .join("");
}

/** Rebuild an Anthropic-format assistant content array for continuation history. */
export function toAnthropicContent(
  msg: NormalizedMessage,
): { type: string; [key: string]: unknown }[] {
  return msg.blocks.map((b) =>
    b.type === "text"
      ? { type: "text", text: b.text }
      : { type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} },
  );
}
