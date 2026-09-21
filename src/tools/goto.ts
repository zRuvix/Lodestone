import { z } from "zod";
import { safeRun, withToolTimeout } from "./timeout.js";
import type { ToolDef } from "./types.js";

async function loadGoals() {
  const mod = await import("mineflayer-pathfinder");
  // mineflayer-pathfinder is CJS; handle both interop shapes.
  const pkg = (mod as unknown as { default?: unknown }).default ?? mod;
  return (pkg as { goals: typeof import("mineflayer-pathfinder").goals }).goals;
}

const gotoSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    z: z.number().optional(),
    player: z.string().optional(),
  })
  .refine(
    (v) =>
      v.player !== undefined ||
      (v.x !== undefined && v.y !== undefined && v.z !== undefined),
    { message: "Provide either {x, y, z} or {player}." },
  );

interface PathfinderBot {
  pathfinder: { goto: (goal: unknown) => Promise<void>; stop: () => void };
  players?: Record<string, { entity?: { position: unknown } }>;
}

export const gotoTool: ToolDef = {
  name: "goto",
  description:
    "Pathfind to coordinates {x, y, z} or to a named player {player}. Blocks until arrival, failure, timeout, or cancellation.",
  schema: gotoSchema,
  readOnly: false,
  async run(args, ctx, signal) {
    return safeRun(async () => {
      const bot = ctx.bot as unknown as PathfinderBot;
      const goals = await loadGoals();
      const cfg = ctx.config.tools.goto;
      const timeoutMs = cfg.timeout_seconds * 1000;

      let goal: unknown;
      if (typeof args["player"] === "string") {
        const target = bot.players?.[args["player"] as string]?.entity;
        if (!target) {
          return {
            text: `Error: player '${args["player"]}' not found or not visible. Hint: use observe to see nearby players.`,
            isError: true,
          };
        }
        goal = new goals.GoalFollow(
          target as never,
          cfg.arrive_distance,
        );
      } else {
        goal = new goals.GoalNear(
          args["x"] as number,
          args["y"] as number,
          args["z"] as number,
          cfg.arrive_distance,
        );
      }

      try {
        await withToolTimeout(
          (inner) =>
            Promise.race([
              bot.pathfinder.goto(goal),
              new Promise<never>((_, reject) => {
                inner.addEventListener("abort", () =>
                  reject(new Error("Tool cancelled")),
                );
              }),
            ]),
          timeoutMs,
          signal,
          `goto timed out after ${cfg.timeout_seconds}s. Hint: the destination may be unreachable (no path found) or too far.`,
        );
      } catch (err) {
        if (signal.aborted) bot.pathfinder.stop();
        throw err;
      }
      const dest =
        typeof args["player"] === "string"
          ? `player ${args["player"]}`
          : `(${args["x"]}, ${args["y"]}, ${args["z"]})`;
      return { text: `Arrived at ${dest}.`, isError: false };
    });
  },
};
