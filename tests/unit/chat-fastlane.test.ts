import { describe, expect, it } from "vitest";
import { isGreeting } from "../../src/chat/greetings.js";

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
