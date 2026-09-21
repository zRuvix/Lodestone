import { describe, expect, it, vi } from "vitest";
import { configSchema } from "../../src/config/schema.js";
import { getTool, toAnthropicTools } from "../../src/tools/registry.js";

function testConfig() {
  return configSchema.parse({
    llm: { base_url: "https://example.com", model: "m" },
  });
}

describe("registry", () => {
  it("converts allowlisted tools to Anthropic definitions", () => {
    const defs = toAnthropicTools(["observe", "say"]);
    expect(defs.map((d) => d.name)).toEqual(["observe", "say"]);
    expect(defs[0]?.input_schema).toMatchObject({ type: "object" });
  });

  it("rejects unknown allowlist names", () => {
    expect(() => toAnthropicTools(["nuke"])).toThrow(/nuke/);
  });
});

describe("observe", () => {
  it("returns snapshot text", async () => {
    const tool = getTool("observe")!;
    expect(tool.readOnly).toBe(true);
    const bot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      health: 20,
      food: 20,
      inventory: { items: () => [] },
      entities: {},
      findBlocks: () => [],
    };
    const res = await tool.run({}, { bot: bot as never, config: testConfig() }, new AbortController().signal);
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/pos:/);
  });
});

describe("goto", () => {
  it("paths to coordinates and reports arrival", async () => {
    const tool = getTool("goto")!;
    const goto = vi.fn(async () => {});
    const bot = { pathfinder: { goto, stop: vi.fn() } };
    const res = await tool.run(
      { x: 10, y: 64, z: 10 },
      { bot: bot as never, config: testConfig() },
      new AbortController().signal,
    );
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/Arrived/);
    expect(goto).toHaveBeenCalledOnce();
  });

  it("errors helpfully on unknown player", async () => {
    const tool = getTool("goto")!;
    const bot = { pathfinder: { goto: vi.fn(), stop: vi.fn() }, players: {} };
    const res = await tool.run(
      { player: "Nobody" },
      { bot: bot as never, config: testConfig() },
      new AbortController().signal,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found/);
  });

  it("respects cancellation", async () => {
    const tool = getTool("goto")!;
    const c = new AbortController();
    c.abort();
    const bot = { pathfinder: { goto: vi.fn(), stop: vi.fn() } };
    const res = await tool.run(
      { x: 1, y: 2, z: 3 },
      { bot: bot as never, config: testConfig() },
      c.signal,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/cancel/i);
  });
});

describe("say", () => {
  it("sends chat and echoes", async () => {
    const tool = getTool("say")!;
    const chat = vi.fn();
    const res = await tool.run(
      { message: "hello" },
      { bot: { chat } as never, config: testConfig() },
      new AbortController().signal,
    );
    expect(res.isError).toBe(false);
    expect(chat).toHaveBeenCalledWith("hello");
  });
});

describe("collect_block", () => {
  function collectBot() {
    const block = { name: "oak_log", position: { x: 1, y: 64, z: 1 } };
    const items = [{ name: "oak_log", count: 0 }];
    return {
      registry: { blocksByName: { oak_log: { id: 17 } } },
      findBlock: vi.fn(() => block),
      canDigBlock: () => true,
      dig: vi.fn(async () => {
        items[0]!.count += 1;
      }),
      pathfinder: { goto: vi.fn(async () => {}), stop: vi.fn() },
      inventory: { items: () => items },
    };
  }

  it("digs until count is reached", async () => {
    const tool = getTool("collect_block")!;
    const bot = collectBot();
    const res = await tool.run(
      { block: "oak_log", count: 2 },
      { bot: bot as never, config: testConfig() },
      new AbortController().signal,
    );
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/Collected 2 oak_log/);
    expect(bot.dig).toHaveBeenCalledTimes(2);
  });

  it("errors on unknown block names", async () => {
    const tool = getTool("collect_block")!;
    const bot = collectBot();
    const res = await tool.run(
      { block: "unobtainium" },
      { bot: bot as never, config: testConfig() },
      new AbortController().signal,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/unknown block/);
  });

  it("gives a hint when nothing is nearby", async () => {
    const tool = getTool("collect_block")!;
    const bot = { ...collectBot(), findBlock: vi.fn(() => null) };
    const res = await tool.run(
      { block: "oak_log", count: 1 },
      { bot: bot as never, config: testConfig() },
      new AbortController().signal,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No 'oak_log' within/);
  });

  it("turns handler exceptions into error results", async () => {
    const tool = getTool("collect_block")!;
    const bot = {
      ...collectBot(),
      dig: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const res = await tool.run(
      { block: "oak_log", count: 1 },
      { bot: bot as never, config: testConfig() },
      new AbortController().signal,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/boom/);
  });
});
