import { z } from "zod";
import { safeRun } from "./timeout.js";
import type { ToolDef } from "./types.js";

const dropSchema = z.object({
  item: z.string().min(1, "item is required, e.g. 'oak_log'"),
  count: z.number().int().positive().optional(),
});

interface DropItem {
  name: string;
  type: number;
  metadata: number;
  count: number;
}

interface DropBot {
  inventory: { items: () => DropItem[] };
  tossStack: (item: unknown) => Promise<void>;
  toss: (itemType: number, metadata: number | null, count: number) => Promise<void>;
}

export const dropTool: ToolDef = {
  name: "drop",
  description:
    "Drop (toss) an item from inventory on the ground in front of the bot — e.g. to give wood to a player. Stand near them first with goto. Drops whole matching stacks by default, or an exact {count}. Resolves instantly.",
  schema: dropSchema,
  readOnly: false,
  async run(args, ctx, _signal) {
    return safeRun(async () => {
      const bot = ctx.bot as unknown as DropBot;
      const want = (args["item"] as string).toLowerCase();
      const stacks = bot.inventory.items().filter((i) => i.name.toLowerCase() === want);
      if (stacks.length === 0) {
        const held =
          bot.inventory.items().map((i) => `${i.name} x${i.count}`).join(", ") || "empty";
        return {
          text: `Error: not holding any '${args["item"]}'. Inventory: ${held}. Hint: observe inventory, then collect or craft it first.`,
          isError: true,
        };
      }
      const first = stacks[0]!;
      const count = args["count"] as number | undefined;
      if (count === undefined) {
        let total = 0;
        for (const s of stacks) {
          await bot.tossStack(s);
          total += s.count;
        }
        return {
          text: `Dropped ${total} ${first.name} (${stacks.length} stack(s)).`,
          isError: false,
        };
      }
      const held = stacks.reduce((n, s) => n + s.count, 0);
      if (held < count) {
        return {
          text: `Error: only holding ${held} ${first.name}, can't drop ${count}. Hint: collect or craft more first.`,
          isError: true,
        };
      }
      let left = count;
      for (const s of stacks) {
        if (left <= 0) break;
        const n = Math.min(s.count, left);
        if (n >= s.count) await bot.tossStack(s);
        else await bot.toss(s.type, s.metadata, n);
        left -= n;
      }
      return { text: `Dropped ${count} ${first.name}.`, isError: false };
    });
  },
};
