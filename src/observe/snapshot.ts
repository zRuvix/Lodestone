import type { LodestoneConfig } from "../config/schema.js";

/** Minimal bot surface the snapshot needs (structural, mockable). */
export interface SnapshotBot {
  entity?: { position?: { x: number; y: number; z: number; floored?: () => unknown } };
  health?: number;
  food?: number;
  time?: { timeOfDay?: number };
  game?: { dimension?: string };
  inventory?: { items: () => { name: string; count: number }[] };
  entities?: Record<
    string,
    {
      name?: string;
      displayName?: string;
      position?: { x: number; y: number; z: number; distanceTo: (p: unknown) => number };
    }
  >;
  blockAt?: (pos: unknown) => { name: string; position?: unknown } | null;
  findBlocks?: (opts: {
    point?: unknown;
    matching: (block: { name: string } | null) => boolean;
    maxDistance: number;
    count: number;
  }) => unknown[];
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Build a compact, token-efficient text snapshot of bot state and surroundings.
 * Pure function of (bot, observation config) — no Mineflayer import needed.
 */
export function buildSnapshot(
  bot: SnapshotBot,
  cfg: LodestoneConfig["observation"],
): string {
  const lines: string[] = [];
  const pos = bot.entity?.position;
  lines.push(
    `pos: ${pos ? `${fmt(pos.x)}, ${fmt(pos.y)}, ${fmt(pos.z)}` : "unknown"}`,
  );
  lines.push(`health: ${bot.health ?? "?"} food: ${bot.food ?? "?"}`);
  lines.push(
    `time: ${bot.time?.timeOfDay ?? "?"} dim: ${bot.game?.dimension ?? "?"}`,
  );

  if (cfg.include_inventory) {
    const items = bot.inventory?.items() ?? [];
    lines.push(
      items.length > 0
        ? `inv: ${items.map((i) => `${i.name} x${i.count}`).join(", ")}`
        : "inv: empty",
    );
  }

  // Nearby entities within radius, capped.
  const seen: string[] = [];
  let extraEntities = 0;
  const entities = Object.values(bot.entities ?? {});
  for (const e of entities) {
    const d = e.position ? e.position.distanceTo(pos ?? { x: 0, y: 0, z: 0 }) : Infinity;
    if (d > cfg.radius) continue;
    const label = e.name ?? e.displayName ?? "unknown";
    seen.push(
      `${label}@${e.position ? `${fmt(e.position.x)},${fmt(e.position.y)},${fmt(e.position.z)}` : "?"}`,
    );
  }
  const shown = seen.slice(0, cfg.max_entities);
  extraEntities = seen.length - shown.length;
  lines.push(
    `entities(${seen.length}): ${shown.length > 0 ? shown.join("; ") : "none"}` +
      (extraEntities > 0 ? ` and ${extraEntities} more` : ""),
  );

  // Notable block types nearby: scan loaded blocks within radius
  // (excluding air), then count by name. findBlocks returns positions,
  // so resolve names via blockAt.
  let blockNames: string[] = [];
  try {
    const positions = bot.findBlocks?.({
      point: pos,
      matching: (b) => !!b && b.name !== "air" && b.name !== "cave_air",
      maxDistance: cfg.radius,
      count: 256,
    }) ?? [];
    const at = bot.blockAt;
    if (at) {
      for (const p of positions) {
        const b = at(p);
        if (b && b.name !== "air" && b.name !== "cave_air") blockNames.push(b.name);
      }
    }
  } catch {
    blockNames = [];
  }
  const counts = new Map<string, number>();
  for (const n of blockNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  const types = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cfg.max_block_types)
    .map(([n, c]) => `${n} x${c}`);
  const extraTypes = counts.size - types.length;
  lines.push(
    `blocks: ${types.length > 0 ? types.join(", ") : "none"}` +
      (extraTypes > 0 ? ` and ${extraTypes} more` : ""),
  );

  return lines.join("\n");
}
