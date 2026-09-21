import { describe, expect, it } from "vitest";
import { HEARTBEAT_PROMPT, shouldSkipHeartbeatTick } from "../../src/daemon/tick.js";

describe("daemon tick", () => {
  it("skips heartbeat while busy", () => {
    expect(shouldSkipHeartbeatTick(true)).toBe(true);
    expect(shouldSkipHeartbeatTick(false)).toBe(false);
  });

  it("heartbeat prompt instructs quiet-by-default single action", () => {
    expect(HEARTBEAT_PROMPT).toMatch(/stay quiet/i);
    expect(HEARTBEAT_PROMPT).toMatch(/TASKS\.md/);
  });
});
