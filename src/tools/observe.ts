import { z } from "zod";
import { buildSnapshot } from "../observe/snapshot.js";
import { safeRun } from "./timeout.js";
import type { ToolDef } from "./types.js";

export const observeTool: ToolDef = {
  name: "observe",
  description:
    "Look at the bot's current state and surroundings: position, health, food, time, dimension, inventory, nearby entities and block types.",
  schema: z.object({}),
  readOnly: true,
  async run(_args, ctx, _signal) {
    return safeRun(async () => ({
      text: buildSnapshot(
        ctx.bot as unknown as Parameters<typeof buildSnapshot>[0],
        ctx.config.observation,
      ),
      isError: false,
    }));
  },
};
