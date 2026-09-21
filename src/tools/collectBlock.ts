import { z } from "zod";
import { safeRun, withToolTimeout } from "./timeout.js";
import type { ToolDef } from "./types.js";

const collectBlockSchema = z.object({
  block: z.string().min(1, "block is required, e.g. 'oak_log'"),
  count: z.number().int().positive().default(1),
});

interface CollectBot {
  registry: { blocksByName?: Record<string, { id: number }> };
  findBlock: (opts: {
    matching: number;
    maxDistance: number;
  }) => { name: string; position: { x: number; y: number; z: number } } | null;
  canDigBlock: (block: unknown) => boolean;
  dig: (block: unknown) => Promise<void>;
  pathfinder: { goto: (goal: unknown) => Promise<void>; stop: () => void };
  inventory: { items: () => { name: string; count: number }[] };
}

function countInInventory(bot: CollectBot, name: string): number {
  return bot.inventory
    .items()
    .filter((i) => i.name === name)
    .reduce((sum, i) => sum + i.count, 0);
}

export const collectBlockTool: ToolDef = {
  name: "collect_block",
  description:
    "Find the nearest block of a given type (e.g. 'oak_log'), path to it, dig it, and pick up the drops. Repeats until count is collected. Blocks until done, failed, timed out, or cancelled.",
  schema: collectBlockSchema,
  readOnly: false,
  async run(args, ctx, signal) {
    return safeRun(async () => {
      const bot = ctx.bot as unknown as CollectBot;
      const cfg = ctx.config.tools.collect_block;
      const blockName = args["block"] as string;
      const want = Math.min(args["count"] as number, cfg.max_count);
      const timeoutMs = cfg.timeout_seconds * 1000;
      const blockId = bot.registry.blocksByName?.[blockName]?.id;
      if (blockId === undefined) {
        return {
          text: `Error: unknown block '${blockName}'. Hint: use a valid Minecraft block name like 'oak_log'.`,
          isError: true,
        };
      }

      const mod = await import("mineflayer-pathfinder");
      const goals = (
        ((mod as unknown as { default?: unknown }).default ?? mod) as {
          goals: typeof import("mineflayer-pathfinder").goals;
        }
      ).goals;
      const startCount = countInInventory(bot, blockName);

      const collected = await withToolTimeout(
        async (inner) => {
          let dug = 0;
          while (dug < want) {
            if (inner.aborted || signal.aborted) throw new Error("Tool cancelled");
            const found = bot.findBlock({
              matching: blockId,
              maxDistance: cfg.search_radius,
            });
            if (!found) {
              if (dug === 0) {
                throw new Error(
                  `No '${blockName}' within ${cfg.search_radius} blocks. Hint: move elsewhere (goto) or try observe first.`,
                );
              }
              break;
            }
            const p = found.position;
            await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2));
            if (inner.aborted || signal.aborted) {
              bot.pathfinder.stop();
              throw new Error("Tool cancelled");
            }
            // Re-resolve the block at the found position for digging.
            const target = bot.findBlock({ matching: blockId, maxDistance: 6 });
            if (!target) continue;
            if (!bot.canDigBlock(target)) {
              throw new Error(
                `Block '${blockName}' out of reach or undiggable. Hint: get closer or pick another target.`,
              );
            }
            await bot.dig(target);
            dug += 1;
          }
          return dug;
        },
        timeoutMs,
        signal,
        `collect_block timed out after ${cfg.timeout_seconds}s. Hint: target may be unreachable or drops scattered.`,
      ).catch((err) => {
        bot.pathfinder.stop();
        throw err;
      });

      const now = countInInventory(bot, blockName);
      return {
        text: `Collected ${collected} ${blockName} (inventory: ${startCount} -> ${now}).`,
        isError: false,
      };
    });
  },
};
