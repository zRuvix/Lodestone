import { describe, expect, it } from "vitest";
import {
  normalizeMessageResponse,
  normalizedText,
  toAnthropicContent,
} from "../../src/llm/response.js";

describe("normalizeMessageResponse", () => {
  it("handles OpenAI chat.completion text", () => {
    const msg = normalizeMessageResponse({
      object: "chat.completion",
      choices: [
        {
          message: { role: "assistant", content: "lodestone-ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });
    expect(normalizedText(msg)).toBe("lodestone-ok");
    expect(msg.stopReason).toBe("end_turn");
    expect(msg.inputTokens).toBe(10);
    expect(msg.outputTokens).toBe(3);
  });

  it("handles OpenAI tool_calls with string arguments", () => {
    const msg = normalizeMessageResponse({
      object: "chat.completion",
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "ping_check",
                  arguments: '{"message":"hello"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    });
    expect(msg.stopReason).toBe("tool_use");
    const use = msg.blocks.find((b) => b.type === "tool_use");
    expect(use).toMatchObject({
      id: "call_1",
      name: "ping_check",
      input: { message: "hello" },
    });
    // continuation history rebuilds Anthropic-format content
    expect(toAnthropicContent(msg)).toContainEqual({
      type: "tool_use",
      id: "call_1",
      name: "ping_check",
      input: { message: "hello" },
    });
  });

  it("handles Anthropic-native messages", () => {
    const msg = normalizeMessageResponse({
      type: "message",
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 1 },
    });
    expect(normalizedText(msg)).toBe("hi");
    expect(msg.stopReason).toBe("end_turn");
  });
});
