import { z } from "zod";
import { safeRun, withToolTimeout } from "./timeout.js";
import type { ToolDef } from "./types.js";

const craftSchema = z.object({
  item: z.string().min(1, "item is required, e.g. 'wooden_pickaxe'"),
  count: z.number().int().positive().default(1),
});

interface CraftBot {
  registry: {
    itemsByName?: Record<string, { id: number }>;
    blocksByName?: Record<string, { id: number }>;
  };
  findBlock: (opts: {
    matching: number;
    maxDistance: number;
  }) => { name: string } | null;
  recipesFor: (
    itemType: number,
    metadata: null,
    minResultCount: number,
    craftingTable: unknown,
  ) => { requiresTable: boolean }[];
  craft: (recipe: unknown, count: number, craftingTable: unknown) => Promise<void>;
  inventory: { items: () => { name: string; count: number }[] };
}

function countInInventory(bot: CraftBot, name: string): number {
  return bot.inventory
    .items()
    .filter((i) => i.name === name)
    .reduce((sum, i) => sum + i.count, 0);
}

export const craftTool: ToolDef = {
  name: "craft",
  description:
    "Craft an item (e.g. 'wooden_pickaxe', 'sticks') from inventory materials using a nearby crafting table when the recipe needs one. Blocks until done, failed, timed out, or cancelled.",
  schema: craftSchema,
  readOnly: false,
  async run(args, ctx, signal) {
    return safeRun(async () => {
      const bot = ctx.bot as unknown as CraftBot;
      const cfg = ctx.config.tools.craft;
      const itemName = args["item"] as string;
      const want = Math.min((args["count"] as number | undefined) ?? 1, 64);
      const timeoutMs = cfg.timeout_seconds * 1000;

      const itemId = bot.registry.itemsByName?.[itemName]?.id;
      if (itemId === undefined) {
        return {
          text: `Error: unknown item '${itemName}'. Hint: use a valid Minecraft item name like 'wooden_pickaxe' or 'sticks'.`,
          isError: true,
        };
      }

      const tableId = bot.registry.blocksByName?.["crafting_table"]?.id;
      const table =
        tableId !== undefined
          ? bot.findBlock({ matching: tableId, maxDistance: 8 })
          : null;
      const recipes = bot.recipesFor(itemId, null, 1, table);
      if (recipes.length === 0) {
        if (!table) {
          return {
            text: `Error: no recipe available for '${itemName}' — you may need a crafting table within 8 blocks, or you're missing materials. Hint: observe your inventory, collect what's missing, or stand near a crafting table and retry.`,
            isError: true,
          };
        }
        return {
          text: `Error: no recipe available for '${itemName}' with your current materials. Hint: observe your inventory and collect the missing ingredients first.`,
          isError: true,
        };
      }

      const startCount = countInInventory(bot, itemName);
      await withToolTimeout(
        async (inner) => {
          if (inner.aborted || signal.aborted) throw new Error("Tool cancelled");
          await bot.craft(recipes[0], want, table);
        },
        timeoutMs,
        signal,
        `craft timed out after ${cfg.timeout_seconds}s. Hint: the crafting table may have been broken or moved.`,
      );

      const now = countInInventory(bot, itemName);
      const gained = now - startCount;
      if (gained <= 0) {
        return {
          text: `Error: crafting '${itemName}' produced nothing (inventory: ${startCount} -> ${now}). Hint: materials may have run out mid-craft.`,
          isError: true,
        };
      }
      return {
        text: `Crafted ${gained} ${itemName} (inventory: ${startCount} -> ${now}).`,
        isError: false,
      };
    });
  },
};
