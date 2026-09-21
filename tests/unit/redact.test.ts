import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/config/redact.js";
import { formatApiError } from "../../src/llm/client.js";

describe("redactSecrets", () => {
  it("replaces secret occurrences and leaves other text", () => {
    const out = redactSecrets("key=abc123 ok abc123", ["abc123"]);
    expect(out).toBe("key=[REDACTED] ok [REDACTED]");
  });

  it("ignores empty secrets", () => {
    expect(redactSecrets("hello", [""])).toBe("hello");
  });
});

describe("formatApiError", () => {
  it("never leaks the key and gives a hint", () => {
    const err = Object.assign(new Error("bad key abc123"), { status: 401 });
    const formatted = formatApiError(err, "abc123");
    expect(formatted.message).not.toContain("abc123");
    expect(formatted.message).toMatch(/401/);
    expect(formatted.message).toMatch(/Hint:/);
  });
});
