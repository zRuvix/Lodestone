// tests/unit/chat-router.test.ts
import { describe, expect, it } from "vitest";
import { createSayLimiter, formatChatInject, isSelf } from "../../src/chat/router.js";

describe("chat router", () => {
  it("formats chat injects", () => {
    expect(formatChatInject("Steve", "hello")).toBe("<Steve> said: hello");
  });

  it("filters self messages", () => {
    expect(isSelf("Agent", "Agent")).toBe(true);
    expect(isSelf("Steve", "Agent")).toBe(false);
  });

  it("rate-limits say calls", () => {
    const limiter = createSayLimiter({ reply_cooldown_seconds: 60, max_replies_per_minute: 1 });
    expect(limiter.trySay()).toBe(true);
    expect(limiter.trySay()).toBe(false); // cooldown blocks second call
  });

  it("caps replies per minute", () => {
    const limiter = createSayLimiter({ reply_cooldown_seconds: 0, max_replies_per_minute: 2 });
    expect(limiter.trySay()).toBe(true);
    expect(limiter.trySay()).toBe(true);
    expect(limiter.trySay()).toBe(false);
  });
});
