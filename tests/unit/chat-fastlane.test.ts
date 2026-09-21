import { describe, expect, it, vi } from "vitest";
import { isGreeting } from "../../src/chat/greetings.js";
import { createChatLane } from "../../src/chat/fastlane.js";

function fakeLlm(replyText: string) {
  return {
    requestConfig: { model: "m", maxTokens: 128 },
    withRetries: async (fn: () => Promise<unknown>) => fn(),
    raw: { messages: { create: vi.fn(async () => ({
      content: [{ type: "text", text: replyText }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    })) } },
  } as never;
}

describe("isGreeting", () => {
  it("matches plain greetings", () => {
    for (const g of ["hi", "hello", "hey", "namaste", "yo", "hiii"]) {
      expect(isGreeting(g)).toBe(true);
    }
  });
  it("matches with agent prefix", () => {
    expect(isGreeting("agent hi")).toBe(true);
    expect(isGreeting("Agent, hello")).toBe(true);
  });
  it("rejects non-greetings", () => {
    for (const t of ["hi, pickaxe banao", "pickaxe", "agent follow me", "do ladki", ""]) {
      expect(isGreeting(t)).toBe(false);
    }
  });
});

describe("chat lane", () => {
  it("answers greetings instantly without LLM", async () => {
    const llm = fakeLlm("SAY:should never reach");
    const said: string[] = [];
    const forwarded: string[] = [];
    const lane = createChatLane({ llm, say: (m) => { said.push(m); }, forward: (t) => { forwarded.push(t); }, limiter: { trySay: () => true }, fastMaxTokens: 128, botName: "Agent" });
    await lane.handleChat("Steve", "hi");
    expect(said).toHaveLength(1);
    expect(forwarded).toHaveLength(0);
    expect(llm.raw.messages.create).not.toHaveBeenCalled();
  });

  it("SAY replies go to chat only, never forwarded", async () => {
    const said: string[] = [];
    const forwarded: string[] = [];
    const lane = createChatLane({ llm: fakeLlm("SAY: namaste Bhaskar!"), say: (m) => { said.push(m); }, forward: (t) => { forwarded.push(t); }, limiter: { trySay: () => true }, fastMaxTokens: 128, botName: "Agent" });
    await lane.handleChat("BhaskarOP", "namaste, kaise ho?");
    expect(said[0]).toContain("Bhaskar");
    expect(forwarded).toHaveLength(0);
  });

  it("DO acks in chat and forwards to main loop", async () => {
    const said: string[] = [];
    const forwarded: string[] = [];
    const lane = createChatLane({ llm: fakeLlm("DO: samajh gaya, ja raha hoon"), say: (m) => { said.push(m); }, forward: (t) => { forwarded.push(t); }, limiter: { trySay: () => true }, fastMaxTokens: 128, botName: "Agent" });
    await lane.handleChat("BhaskarOP", "agent follow me");
    expect(said[0]).toMatch(/samajh|jaa|ok/i);
    expect(forwarded[0]).toContain("follow me");
  });

  it("newest message wins while busy", async () => {
    const said: string[] = [];
    const forwarded: string[] = [];
    let resolveGate!: (v: unknown) => void;
    const gate = new Promise((r) => { resolveGate = r; });
    const create = vi.fn(() => gate);
    const llm = {
      requestConfig: { model: "m", maxTokens: 128 },
      withRetries: async (fn: () => Promise<unknown>) => fn(),
      raw: { messages: { create } },
    } as never;
    const lane = createChatLane({ llm, say: (m) => { said.push(m); }, forward: (t) => { forwarded.push(t); }, limiter: { trySay: () => true }, fastMaxTokens: 128, botName: "Agent" });
    const p1 = lane.handleChat("Steve", "what blocks do you need for crafting today?");
    const p2 = lane.handleChat("Steve", "which biome has the most diamonds today?");
    resolveGate({
      content: [{ type: "text", text: "SAY: b-reply diamonds here" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    await Promise.all([p1, p2]);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("b-reply");
    expect(forwarded).toHaveLength(0);
  });

  it("rate limiter veto drops the reply but still forwards DO work", async () => {
    const said: string[] = [];
    const forwarded: string[] = [];
    const lane = createChatLane({ llm: fakeLlm("DO: samajh gaya, ja raha hoon"), say: (m) => { said.push(m); }, forward: (t) => { forwarded.push(t); }, limiter: { trySay: () => false }, fastMaxTokens: 128, botName: "Agent" });
    await lane.handleChat("BhaskarOP", "agent follow me");
    expect(said).toHaveLength(0);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toContain("follow me");
  });
});
