import type { Bot } from "mineflayer";
import type { LodestoneConfig } from "../config/schema.js";

/** Apply the pathfinder config block to a Movements instance. */
export async function applyMovements(
  bot: Bot,
  cfg: LodestoneConfig["pathfinder"],
): Promise<void> {
  const mod = await import("mineflayer-pathfinder");
  const pkg = ((mod as unknown as { default?: unknown }).default ?? mod) as {
    Movements: new (bot: unknown) => {
      canDig: boolean;
      allowSprinting: boolean;
      allowParkour: boolean;
      maxDropDown: number;
      allow1by1towers: boolean;
    };
  };
  const move = new pkg.Movements(bot as never);
  move.canDig = cfg.can_dig;
  move.allowSprinting = cfg.allow_sprinting;
  move.allowParkour = cfg.allow_parkour;
  move.maxDropDown = cfg.max_drop_down;
  move.allow1by1towers = cfg.allow_1by1_towers;
  (bot as unknown as { pathfinder: { setMovements: (m: unknown) => void } }).pathfinder.setMovements(move);
}
