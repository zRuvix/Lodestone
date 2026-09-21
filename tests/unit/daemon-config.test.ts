import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("daemon config", () => {
  it("parses daemon defaults", () => {
    const cfg = configSchema.parse({
      llm: { base_url: "https://example.com", model: "m" },
    });
    expect(cfg.agent.heartbeat_seconds).toBe(30);
    expect(cfg.agent.heartbeat_max_turns).toBe(8);
    expect(cfg.agent.reconnect_attempts).toBe(5);
    expect(cfg.chat.reply_cooldown_seconds).toBe(3);
    expect(cfg.chat.max_replies_per_minute).toBe(10);
    expect(cfg.chat.respond_to_ambient).toBe(false);
    expect(cfg.memory.soul_file).toBe("SOUL.md");
    expect(cfg.memory.memory_file).toBe("MEMORY.md");
    expect(cfg.memory.tasks_file).toBe("TASKS.md");
  });

  it("rejects unknown allowed tools (read_file/write_file must be known)", () => {
    // registry known names after Task 2: observe, goto, collect_block, say, read_file, write_file
    const cfg = configSchema.parse({
      llm: { base_url: "https://example.com", model: "m" },
      agent: { allowed_tools: ["observe", "say", "read_file", "write_file"] },
    });
    expect(cfg.agent.allowed_tools).toContain("read_file");
  });
});
