import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export const OBSERVATION_PLACEHOLDER = "[older observation omitted]";

/** Names of tools whose results are observations (eligible for trimming). */
export function isObserveTool(name: string): boolean {
  return name === "observe";
}

/**
 * Trim older observe tool_results beyond the most recent `keepLast`,
 * replacing their content with a placeholder. Keeps history valid:
 * every tool_use still has exactly one tool_result in the same message.
 */
export function trimObservations(
  messages: MessageParam[],
  keepLast: number,
): MessageParam[] {
  if (keepLast < 0) keepLast = 0;
  // Collect indices of tool_result blocks from observe calls, newest last.
  const observeResults: { msgIdx: number; blockIdx: number }[] = [];
  messages.forEach((msg, msgIdx) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return;
    msg.content.forEach((block, blockIdx) => {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "tool_result"
      ) {
        const prevAssistant = findToolUseName(messages, msgIdx, (block as { tool_use_id?: string }).tool_use_id);
        if (prevAssistant === "observe") observeResults.push({ msgIdx, blockIdx });
      }
    });
  });

  const toTrim = Math.max(0, observeResults.length - keepLast);
  if (toTrim === 0) return messages;

  const trimSet = new Set(observeResults.slice(0, toTrim).map((r) => `${r.msgIdx}:${r.blockIdx}`));
  return messages.map((msg, msgIdx) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;
    const content = msg.content.map((block, blockIdx) => {
      if (!trimSet.has(`${msgIdx}:${blockIdx}`)) return block;
      if (typeof block !== "object" || block === null) return block;
      const b = block as { type?: string; tool_use_id?: string };
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") return block;
      return {
        type: "tool_result" as const,
        tool_use_id: b.tool_use_id,
        content: OBSERVATION_PLACEHOLDER,
      };
    });
    return { ...msg, content };
  });
}

function findToolUseName(
  messages: MessageParam[],
  userMsgIdx: number,
  toolUseId: string | undefined,
): string | null {
  if (!toolUseId) return null;
  for (let i = userMsgIdx - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant" || typeof msg.content === "string") continue;
    for (const block of msg.content as { type?: string; id?: string; name?: string }[]) {
      if (block?.type === "tool_use" && block.id === toolUseId) {
        return block.name ?? null;
      }
    }
  }
  return null;
}
