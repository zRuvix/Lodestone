import { describe, expect, it } from "vitest";
import { createBotManager } from "../../src/bot/manager.js";
import { loadConfig } from "../../src/config/loader.js";
import { getTool } from "../../src/tools/registry.js";
import { applyMovements } from "../../src/tools/movements.js";

const RUN = process.env["RUN_INTEGRATION"] === "1";

describe.runIf(RUN)("integration: bot (non-destructive: observe + goto only)", () => {
  it("connects, observes, and moves a short distance", async () => {
    const loaded = await loadConfig(process.env["LODESTONE_CONFIG"] ?? "./config.yaml");
    const manager = createBotManager(loaded.config);
    const bot = await manager.connect();
    try {
      const pathfinder = await import("mineflayer-pathfinder").then(
        (m) => ((m as { default?: unknown }).default ?? m) as { pathfinder: (b: unknown) => void },
      );
      pathfinder.pathfinder(bot);
      await applyMovements(bot, loaded.config.pathfinder);

      const ctx = { bot, config: loaded.config };
      const signal = new AbortController().signal;

      const obs = await getTool("observe")!.run({}, ctx, signal);
      expect(obs.isError).toBe(false);
      expect(obs.text).toMatch(/pos:/);

      // Small relative move (+2 x). No digging or placing.
      const pos = (bot as unknown as { entity: { position: { x: number; y: number; z: number } } }).entity.position;
      const go = await getTool("goto")!.run(
        { x: Math.floor(pos.x) + 2, y: Math.floor(pos.y), z: Math.floor(pos.z) },
        ctx,
        signal,
      );
      expect(go.isError).toBe(false);
      expect(go.text).toMatch(/Arrived/);
    } finally {
      manager.disconnect("integration done");
    }
  }, 180000);
});
