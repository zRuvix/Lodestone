import type {
  MessageParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { LlmClient } from "../llm/client.js";
import {
  normalizeMessageResponse,
  normalizedText,
  toAnthropicContent,
  type NormalizedMessage,
} from "../llm/response.js";
import { getTool, toAnthropicTools } from "../tools/registry.js";
import type { ToolContext, ToolDef } from "../tools/types.js";
import { trimObservations } from "./history.js";

export type AgentStatus =
  | "done"
  | "max_turns"
  | "cancelled"
  | "error";

export interface AgentResult {
  status: AgentStatus;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  note?: string;
}

export interface AgentHooks {
  beforeTool?: (name: string, input: unknown) => void;
  afterTool?: (name: string, result: { text: string; isError: boolean }) => void;
  onTurn?: (turn: number, inputTokens: number, outputTokens: number) => void;
  onText?: (text: string) => void;
}

export interface AgentOptions {
  goal: string;
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  keepLastObservations: number;
  parallelReadOnlyTools: boolean;
  temperature: number | null;
  promptCaching: boolean;
  llm: LlmClient;
  ctx: ToolContext;
  hooks?: AgentHooks;
}

interface PendingToolCall {
  block: ToolUseBlock;
  def: ToolDef | undefined;
}

/** Parse + validate a tool_use block against its Zod schema. */
function validateInput(
  def: ToolDef,
  input: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const parsed = def.schema.safeParse(input ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return {
    ok: false,
    error: `Invalid input for tool '${def.name}': ${issues}. Hint: check required fields and types.`,
  };
}

async function runOneCall(
  call: PendingToolCall,
  options: AgentOptions,
  signal: AbortSignal,
): Promise<{ id: string; text: string; isError: boolean }> {
  const { block, def } = call;
  if (!def) {
    return {
      id: block.id,
      text: `Error: unknown tool '${block.name}'. Hint: use one of: ${options.allowedTools.join(", ")}.`,
      isError: true,
    };
  }
  const validated = validateInput(def, block.input);
  if (!validated.ok) {
    const result = { text: `Error: ${validated.error}`, isError: true };
    options.hooks?.afterTool?.(def.name, result);
    return { id: block.id, ...result };
  }
  try {
    options.hooks?.beforeTool?.(def.name, validated.value);
  } catch (err) {
    // Hook veto (e.g. daemon say rate-limit): surface as an isError result
    // so the model sees it instead of crashing the loop.
    const result = {
      text: `Error: tool '${def.name}' pre-check failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
    options.hooks?.afterTool?.(def.name, result);
    return { id: block.id, ...result };
  }
  let result: { text: string; isError: boolean };
  try {
    result = await def.run(validated.value, options.ctx, signal);
  } catch (err) {
    result = {
      text: `Error: tool '${def.name}' threw: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
  options.hooks?.afterTool?.(def.name, result);
  return { id: block.id, text: result.text, isError: result.isError };
}

export function createAgent(options: AgentOptions) {
  const llmController = new AbortController();
  const toolController = new AbortController();
  const injectQueue: string[] = [];
  let cancelled = false;

  function cancel() {
    cancelled = true;
    llmController.abort();
    toolController.abort();
  }

  function inject(text: string) {
    injectQueue.push(text);
  }

  async function requestTurn(
    messages: MessageParam[],
    tools: { name: string; description: string; input_schema: Record<string, unknown> }[],
  ): Promise<NormalizedMessage> {
    const { llm } = options;
    const { requestConfig } = llm;
    const params = {
      model: requestConfig.model,
      max_tokens: requestConfig.maxTokens,
      ...(options.temperature !== null ? { temperature: options.temperature } : {}),
      ...(options.promptCaching
        ? { system: [{ type: "text" as const, text: options.systemPrompt, cache_control: { type: "ephemeral" as const } }] }
        : { system: options.systemPrompt }),
      messages,
      tools: tools as never,
    };
    if (requestConfig.stream) {
      const stream = await llm.withRetries(
        () => llm.raw.messages.create({ ...params, stream: true }, { signal: llmController.signal }),
        llmController.signal,
      );
      let text = "";
      const toolInputs = new Map<number, string>();
      const toolBlocks = new Map<number, { id: string; name: string }>();
      let stopReason: string | null | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      for await (const event of stream) {
        if (llmController.signal.aborted) throw new Error("Aborted");
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
        } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          toolInputs.set(event.index, (toolInputs.get(event.index) ?? "") + event.delta.partial_json);
        } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          toolBlocks.set(event.index, { id: event.content_block.id, name: event.content_block.name });
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
    const raw = await llm.withRetries(
      () => llm.raw.messages.create(params, { signal: llmController.signal }),
      llmController.signal,
    );
    return normalizeMessageResponse(raw);
  }

  async function run(): Promise<AgentResult> {
    const tools = toAnthropicTools(options.allowedTools);
    let messages: MessageParam[] = [
      { role: "user", content: `Goal: ${options.goal}` },
    ];
    let totalIn = 0;
    let totalOut = 0;
    let turns = 0;

    for (turns = 0; turns < options.maxTurns; turns++) {
      if (cancelled) {
        return { status: "cancelled", turns, inputTokens: totalIn, outputTokens: totalOut };
      }
      let response: NormalizedMessage;
      try {
        response = await requestTurn(messages, tools);
      } catch (err) {
        if (cancelled || llmController.signal.aborted) {
          return { status: "cancelled", turns, inputTokens: totalIn, outputTokens: totalOut };
        }
        return {
          status: "error",
          turns,
          inputTokens: totalIn,
          outputTokens: totalOut,
          note: err instanceof Error ? err.message : String(err),
        };
      }
      // Some gateways omit usage on streaming/non-streaming responses;
      // fall back to -1 so logs don't silently claim zero.
      const inT = response.inputTokens;
      const outT = response.outputTokens;
      totalIn += inT ?? 0;
      totalOut += outT ?? 0;
      const haveUsage = inT !== undefined || outT !== undefined;
      options.hooks?.onTurn?.(turns + 1, inT ?? -1, outT ?? -1);
      if (!haveUsage) {
        options.hooks?.onText?.("(usage not reported by endpoint for this turn)");
      }

      const text = normalizedText(response);
      if (text && text.trim().length > 0) options.hooks?.onText?.(text);

      const toolUses = response.blocks.filter((b) => b.type === "tool_use");
      messages.push({ role: "assistant", content: toAnthropicContent(response) as never });

      if (toolUses.length === 0) {
        const stop = response.stopReason;
        if (stop === "end_turn" || stop === null) {
          return { status: "done", turns: turns + 1, inputTokens: totalIn, outputTokens: totalOut };
        }
        return {
          status: "done",
          turns: turns + 1,
          inputTokens: totalIn,
          outputTokens: totalOut,
          note: `Stopped with stop_reason '${stop}' and no tool calls.`,
        };
      }

      // Execute tool calls: sequential by default; parallel only for read-only.
      const calls: PendingToolCall[] = toolUses.map((b) => ({
        block: b as unknown as ToolUseBlock,
        def: getTool((b as { name: string }).name),
      }));
      const allReadOnly = calls.every((c) => c.def?.readOnly === true);
      let results: { id: string; text: string; isError: boolean }[];
      if (options.parallelReadOnlyTools && allReadOnly && calls.length > 1) {
        results = await Promise.all(calls.map((c) => runOneCall(c, options, toolController.signal)));
      } else {
        results = [];
        for (const c of calls) {
          if (cancelled) {
            // Still produce a result for every tool_use (API requires it).
            results.push({ id: c.block.id, text: "Error: tool cancelled before it started.", isError: true });
            continue;
          }
          results.push(await runOneCall(c, options, toolController.signal));
        }
        // Calls after cancellation point never ran; fill remaining.
        for (let i = results.length; i < calls.length; i++) {
          results.push({ id: calls[i]!.block.id, text: "Error: tool cancelled before it started.", isError: true });
        }
      }

      // Tool results first, then injected event text (API requires this order).
      const userContent: MessageParam["content"] = results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.id,
        content: r.text,
        ...(r.isError ? { is_error: true } : {}),
      }));
      while (injectQueue.length > 0) {
        userContent.push({ type: "text" as const, text: injectQueue.shift()! });
      }
      messages.push({ role: "user", content: userContent });

      // Trim older observations to control context.
      messages = trimObservations(messages, options.keepLastObservations);
    }

    return { status: "max_turns", turns, inputTokens: totalIn, outputTokens: totalOut };
  }

  return { run, cancel, inject };
}

export type Agent = ReturnType<typeof createAgent>;
