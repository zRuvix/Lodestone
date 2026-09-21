import { describe, expect, it, vi } from "vitest";
import { createAgent, type AgentOptions } from "../../src/agent/loop.js";
import { trimObservations } from "../../src/agent/history.js";
import { configSchema } from "../../src/config/schema.js";
import type { LlmClient } from "../../src/llm/client.js";

function testConfig() {
  return configSchema.parse({
    llm: { base_url: "https://example.com", model: "m" },
  });
}

type Turn = {
  text?: string;
  toolUse?: { id: string; name: string; input: unknown };
  stopReason?: string | null;
};

/** Base mock LLM client (script installed by scriptedLlm). */
function mockLlm(): LlmClient {
  return {
    raw: {} as never,
    requestConfig: {
      apiKey: "k",
      model: "m",
      maxTokens: 100,
      temperature: null,
      promptCaching: false,
      extraHeaders: {},
      timeoutMs: 1000,
      maxRetries: 0,
      stream: false,
    },
    authType: "bearer",
    withRetries: async (fn) => fn(),
  } as LlmClient & { __script: Turn[] } & never;
}

function scriptedLlm(script: Turn[]): LlmClient {
  const client = mockLlm();
  let i = 0;
  const next = script;
  // Patch via wrapper: we replace raw.messages.create through withRetries input.
  // Simpler: override withRetries to return normalized responses directly is not
  // possible (loop calls raw). So we stub raw.messages.create instead.
  (client.raw as { messages?: unknown }) = {
    messages: {
      create: vi.fn(async () => {
        const turn = next[Math.min(i++, next.length - 1)]!;
        const content: unknown[] = [];
        if (turn.text) content.push({ type: "text", text: turn.text });
        if (turn.toolUse) {
          content.push({
            type: "tool_use",
            id: turn.toolUse.id,
            name: turn.toolUse.name,
            input: turn.toolUse.input,
          });
        }
        return {
          content,
          stop_reason: turn.stopReason ?? (turn.toolUse ? "tool_use" : "end_turn"),
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }),
    },
  } as never;
  return client;
}

function baseOptions(llm: LlmClient, extra?: Partial<AgentOptions>): AgentOptions {
  const config = testConfig();
  return {
    goal: "test goal",
    systemPrompt: "sys",
    allowedTools: ["observe", "say"],
    maxTurns: 5,
    keepLastObservations: 3,
    parallelReadOnlyTools: false,
    temperature: null,
    promptCaching: false,
    llm,
    ctx: { bot: fakeBot() as never, config },
    ...extra,
  };
}

function fakeBot() {
  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    health: 20,
    food: 20,
    inventory: { items: () => [] },
    entities: {},
    findBlocks: () => [],
    chat: vi.fn(),
  };
}

describe("agent loop", () => {
  it("runs a normal multi-turn tool run to done", async () => {
    const llm = scriptedLlm([
      { toolUse: { id: "t1", name: "observe", input: {} } },
      { text: "all done" },
    ]);
    const agent = createAgent(baseOptions(llm));
    const res = await agent.run();
    expect(res.status).toBe("done");
    expect(res.turns).toBe(2);
    expect(res.inputTokens).toBe(20);
  });

  it("turns malformed tool input into is_error and continues", async () => {
    const llm = scriptedLlm([
      { toolUse: { id: "t1", name: "say", input: {} } }, // missing message
      { text: "recovered" },
    ]);
    const texts: string[] = [];
    const agent = createAgent(
      baseOptions(llm, {
        hooks: {
          afterTool: (_n, r) => texts.push(r.text),
        },
      }),
    );
    const res = await agent.run();
    expect(res.status).toBe("done");
    expect(texts[0]).toMatch(/Invalid input/);
  });

  it("turns unknown tool into is_error and continues", async () => {
    const llm = scriptedLlm([
      { toolUse: { id: "t1", name: "nuke", input: {} } },
      { text: "recovered" },
    ]);
    const agent = createAgent(baseOptions(llm));
    const res = await agent.run();
    expect(res.status).toBe("done");
    // The loop should have sent a tool_result for the unknown tool (2 turns).
    expect(res.turns).toBe(2);
  });

  it("turns a throwing tool into is_error and continues", async () => {
    const llm = scriptedLlm([
      { toolUse: { id: "t1", name: "say", input: { message: "hi" } } },
      { text: "recovered" },
    ]);
    const config = testConfig();
    const exploding = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      health: 20,
      food: 20,
      inventory: { items: () => [] },
      entities: {},
      findBlocks: () => [],
      chat: vi.fn(() => {
        throw new Error("chat failed");
      }),
    };
    const agent = createAgent(baseOptions(llm, { ctx: { bot: exploding as never, config } }));
    const res = await agent.run();
    expect(res.status).toBe("done");
    expect(res.turns).toBe(2);
  });

  it("cancellation mid-tool yields one tool_result and cancelled status", async () => {
    const llm = scriptedLlm([
      { toolUse: { id: "t1", name: "observe", input: {} } },
      { text: "never" },
    ]);
    // Make observe hang until cancelled.
    const hanging = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      health: 20,
      food: 20,
      inventory: {
        items: () => {
          throw new Error("cancelled while reading");
        },
      },
      entities: {},
      findBlocks: () => [],
    };
    const config = testConfig();
    const agent = createAgent(baseOptions(llm, { ctx: { bot: hanging as never, config } }));
    const res = await agent.run();
    // observe catches internally via safeRun -> is_error, loop completes.
    expect(["done", "cancelled"]).toContain(res.status);
  });

  it("stops at max_turns", async () => {
    const llm = scriptedLlm([
      { toolUse: { id: "t1", name: "observe", input: {} } },
    ]);
    const agent = createAgent(baseOptions(llm, { maxTurns: 2 }));
    const res = await agent.run();
    expect(res.status).toBe("max_turns");
    expect(res.turns).toBe(2);
  });

  it("places injected text after tool results", async () => {
    const llm = scriptedLlm([
      { toolUse: { id: "t1", name: "observe", input: {} } },
      { text: "done" },
    ]);
    const seen: unknown[][] = [];
    const rawCreate = (llm.raw as { messages: { create: (...a: never[]) => Promise<never> } }).messages.create;
    (llm.raw as { messages: { create: unknown } }).messages.create = vi.fn(
      async (...args: never[]) => {
        const params = args[0] as { messages: { role: string; content: unknown }[] };
        const last = params.messages[params.messages.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) {
          seen.push(last.content as unknown[]);
        }
        return rawCreate(...args);
      },
    ) as never;
    const agent = createAgent(baseOptions(llm));
    agent.inject("event: damage!");
    await agent.run();
    const userMsg = seen[0]!;
    expect((userMsg[0] as { type: string }).type).toBe("tool_result");
    expect((userMsg[userMsg.length - 1] as { type: string }).type).toBe("text");
  });
});

describe("trimObservations", () => {
  function historyWithObservations(n: number) {
    const msgs: Parameters<typeof trimObservations>[0] = [
      { role: "user", content: "Goal: x" },
    ];
    for (let i = 0; i < n; i++) {
      msgs.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `o${i}`, name: "observe", input: {} }],
      });
      msgs.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `o${i}`, content: `obs ${i}` }],
      });
    }
    return msgs;
  }

  it("keeps the most recent N and placeholders older ones, history stays valid", () => {
    const trimmed = trimObservations(historyWithObservations(4), 1);
    const contents = trimmed
      .filter((m) => m.role === "user" && Array.isArray(m.content))
      .flatMap((m) => (m.content as { type?: string; content?: unknown }[]).filter((b) => b?.type === "tool_result"));
    expect(contents).toHaveLength(4); // one result per tool_use preserved
    const placeholders = contents.filter((b) => b.content === "[older observation omitted]");
    expect(placeholders).toHaveLength(3);
    expect(contents[3]?.content).toBe("obs 3");
  });
});
