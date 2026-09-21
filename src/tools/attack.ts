import { z } from "zod";
import { safeRun, withToolTimeout } from "./timeout.js";
import type { ToolDef } from "./types.js";

const attackSchema = z.object({
  target: z.string().min(1, "target is required, e.g. 'sheep'"),
  max_distance: z.number().positive().default(8),
});

interface AttackEntity {
  name?: string;
  displayName?: string;
  position?: {
    x: number;
    y: number;
    z: number;
    distanceTo: (p: unknown) => number;
  };
}

interface AttackBot {
  entity: { position: { x: number; y: number; z: number } };
  entities: Record<string, AttackEntity>;
  lookAt: (pos: unknown) => Promise<void>;
  attack: (entity: unknown) => Promise<void> | void;
}

function matches(entity: AttackEntity, target: string): boolean {
  const t = target.toLowerCase();
  return (
    entity.name?.toLowerCase() === t || entity.displayName?.toLowerCase() === t
  );
}

export const attackTool: ToolDef = {
  name: "attack",
  description:
    "Attack the nearest entity matching a name (e.g. 'sheep', 'zombie') until it dies. Never attacks players. Blocks until the kill, failure, timeout, or cancellation.",
  schema: attackSchema,
  readOnly: false,
  async run(args, ctx, signal) {
    return safeRun(async () => {
      const bot = ctx.bot as unknown as AttackBot;
      const cfg = ctx.config.tools.attack;
      const target = args["target"] as string;
      const maxDistance = (args["max_distance"] as number | undefined) ?? 8;
      const timeoutMs = cfg.timeout_seconds * 1000;

      if (target.toLowerCase() === "player") {
        return {
          text: "Error: I don't attack players. Hint: use this tool for mobs like 'sheep' or 'zombie'.",
          isError: true,
        };
      }

      await withToolTimeout(
        async (inner) => {
          for (;;) {
            if (inner.aborted || signal.aborted) throw new Error("Tool cancelled");
            // Re-resolve each swing: entities move, flee, and despawn on death.
            let best: AttackEntity | null = null;
            let bestDist = Infinity;
            for (const e of Object.values(bot.entities ?? {})) {
              if (!matches(e, target) || !e.position) continue;
              const d = e.position.distanceTo(bot.entity.position);
              if (d <= maxDistance && d < bestDist) {
                best = e;
                bestDist = d;
              }
            }
            if (!best) {
              // Either it died (despawned) or it fled out of range.
              return;
            }
            if (bestDist > 4) {
              throw new Error(
                `Target '${target}' is ${bestDist.toFixed(1)} blocks away — too far to hit. Hint: move closer with goto first, then attack again.`,
              );
            }
            await bot.lookAt(best.position);
            await bot.attack(best);
            await new Promise((r) => setTimeout(r, 600));
          }
        },
        timeoutMs,
        signal,
        `attack timed out after ${cfg.timeout_seconds}s. Hint: the target may be fleeing — chase it with goto and retry.`,
      );

      // If a matching target is still around, it escaped rather than died.
      const remaining = Object.values(bot.entities ?? {}).some((e) => matches(e, target));
      if (remaining) {
        return {
          text: `Attacked '${target}' but it is still alive (fled or out of reach). Hint: chase it with goto and attack again.`,
          isError: true,
        };
      }
      return { text: `Killed '${target}'.`, isError: false };
    });
  },
};
