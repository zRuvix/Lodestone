import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { LlmClient } from "./client.js";
import {
  normalizeMessageResponse,
  normalizedText,
  toAnthropicContent,
} from "./response.js";

export interface CheckStepResult {
  name: string;
  pass: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  detail?: string;
  error?: string;
}

export interface CheckReport {
  steps: CheckStepResult[];
  overallPass: boolean;
}

function baseParams(client: LlmClient) {
  const { requestConfig } = client;
  return {
    model: requestConfig.model,
    max_tokens: Math.min(requestConfig.maxTokens, 256),
    ...(requestConfig.temperature !== null
      ? { temperature: requestConfig.temperature }
      : {}),
  };
}

async function nonStreamingText(
  client: LlmClient,
  messages: MessageParam[],
  signal?: AbortSignal,
) {
  const raw = await client.withRetries(
    () => client.raw.messages.create({ ...baseParams(client), messages }, { signal }),
    signal,
  );
  return normalizeMessageResponse(raw);
}

async function streamingText(
  client: LlmClient,
  messages: MessageParam[],
  signal?: AbortSignal,
) {
  const stream = await client.withRetries(
    () =>
      client.raw.messages.create(
        { ...baseParams(client), messages, stream: true },
        { signal },
      ),
    signal,
  );

  let text = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let stopReason: string | null | undefined;
  const toolInputs = new Map<number, string>();
  const toolBlocks = new Map<number, { id: string; name: string }>();
  for await (const event of stream) {
    if (signal?.aborted) throw new Error("Aborted");
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
    } else if (
      event.type === "content_block_delta" &&
      event.delta.type === "input_json_delta"
    ) {
      toolInputs.set(
        event.index,
        (toolInputs.get(event.index) ?? "") + event.delta.partial_json,
      );
    } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      toolBlocks.set(event.index, {
        id: event.content_block.id,
        name: event.content_block.name,
      });
    } else if (event.type === "message_start") {
      inputTokens = event.message.usage.input_tokens;
    } else if (event.type === "message_delta") {
      outputTokens = event.usage.output_tokens;
      stopReason = event.delta.stop_reason ?? stopReason;
    }
  }
  const blocks: { type: string; [k: string]: unknown }[] =
    text.length > 0 ? [{ type: "text", text }] : [];
  for (const [index, meta] of toolBlocks) {
    let input: unknown = {};
    try {
      input = JSON.parse(toolInputs.get(index) ?? "{}");
    } catch {
      input = { _raw: toolInputs.get(index) ?? "" };
    }
    blocks.push({ type: "tool_use", id: meta.id, name: meta.name, input });
  }
  return normalizeMessageResponse({
    content: blocks,
    stop_reason: stopReason ?? null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
}

// NOTE: short tool/arg names work around a gateway quirk where some tokens
// ("ping_check", "pong", "banana", ...) yield empty in_progress responses.
const DUMMY_TOOL = {
  name: "echo",
  description: "Echo back the given word.",
  input_schema: {
    type: "object" as const,
    properties: { word: { type: "string" } },
    required: ["word"],
  },
};

async function toolRoundTrip(
  client: LlmClient,
  signal?: AbortSignal,
): Promise<CheckStepResult> {
  const started = Date.now();
  const makeResult = (
    partial: Partial<CheckStepResult> & { pass: boolean },
  ): CheckStepResult => ({
    name: "tool_use round trip",
    latencyMs: Date.now() - started,
    ...partial,
  });

  try {
    const prompt =
      "Call the echo tool with word set to 'hello'. Reply with only the tool call.";
    const rawFirst = await client.withRetries(
      () =>
        client.raw.messages.create(
          {
            ...baseParams(client),
            messages: [{ role: "user", content: prompt }],
            tools: [DUMMY_TOOL],
          },
          { signal },
        ),
      signal,
    );
    const first = normalizeMessageResponse(rawFirst);
    const toolUse = first.blocks.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return makeResult({
        pass: false,
        error: `Expected a tool_use block but stop_reason was '${first.stopReason}'. The model/endpoint may not support tool use. (text: '${normalizedText(first).slice(0, 200)}')`,
        inputTokens: first.inputTokens,
        outputTokens: first.outputTokens,
      });
    }
    if (toolUse.name !== DUMMY_TOOL.name) {
      return makeResult({
        pass: false,
        error: `Model called unknown tool '${toolUse.name}' (expected '${DUMMY_TOOL.name}').`,
        inputTokens: first.inputTokens,
        outputTokens: first.outputTokens,
      });
    }

    // Continuation: assistant tool_use, then user tool_result.
    // NOTE: this gateway requires `tools` re-sent on the follow-up turn,
    // otherwise it returns an empty `in_progress` response.
    const rawFollowUp = await client.withRetries(
      () =>
        client.raw.messages.create(
          {
            ...baseParams(client),
            tools: [DUMMY_TOOL],
            messages: [
              { role: "user", content: prompt },
              { role: "assistant", content: toAnthropicContent(first) as never },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: "got hello",
                  },
                ],
              },
            ],
          },
          { signal },
        ),
      signal,
    );
    const followUp = normalizeMessageResponse(rawFollowUp);
    const text = normalizedText(followUp);
    if (!text.trim()) {
      return makeResult({
        pass: false,
        error: "Model returned no text after the tool_result.",
        inputTokens: (first.inputTokens ?? 0) + (followUp.inputTokens ?? 0),
        outputTokens: (first.outputTokens ?? 0) + (followUp.outputTokens ?? 0),
      });
    }
    return makeResult({
      pass: true,
      detail: `tool_use '${toolUse.name}' OK, continuation text received (${text.length} chars).`,
      inputTokens: (first.inputTokens ?? 0) + (followUp.inputTokens ?? 0),
      outputTokens: (first.outputTokens ?? 0) + (followUp.outputTokens ?? 0),
    });
  } catch (err) {
    return makeResult({
      pass: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runConnectivityCheck(
  client: LlmClient,
  signal?: AbortSignal,
): Promise<CheckReport> {
  const steps: CheckStepResult[] = [];
  const prompt: MessageParam[] = [
    { role: "user", content: "Reply with exactly: lodestone-ok" },
  ];

  // Step 1: minimal non-streaming request.
  {
    const started = Date.now();
    try {
      const res = await nonStreamingText(client, prompt, signal);
      const text = normalizedText(res);
      steps.push({
        name: "non-streaming text",
        pass: text.trim().length > 0,
        latencyMs: Date.now() - started,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        detail: text.trim().slice(0, 200),
        ...(text.trim().length > 0 ? {} : { error: "Empty text response." }),
      });
    } catch (err) {
      steps.push({
        name: "non-streaming text",
        pass: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Step 2: streaming (only if enabled).
  if (client.requestConfig.stream) {
    const started = Date.now();
    try {
      const res = await streamingText(client, prompt, signal);
      const text = normalizedText(res);
      steps.push({
        name: "streaming text",
        pass: text.trim().length > 0,
        latencyMs: Date.now() - started,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        detail: text.trim().slice(0, 200),
        ...(text.trim().length > 0
          ? {}
          : { error: "No streamed text assembled." }),
      });
    } catch (err) {
      steps.push({
        name: "streaming text",
        pass: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    steps.push({
      name: "streaming text",
      pass: true,
      latencyMs: 0,
      detail: "Skipped (llm.stream is false).",
    });
  }

  // Step 3: tool_use round trip.
  steps.push(await toolRoundTrip(client, signal));

  return { steps, overallPass: steps.every((s) => s.pass) };
}
