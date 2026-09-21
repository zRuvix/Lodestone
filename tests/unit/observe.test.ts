import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../../src/observe/snapshot.js";
import type { LodestoneConfig } from "../../src/config/schema.js";

function fakeConfig(): LodestoneConfig["observation"] {
  return { radius: 16, max_entities: 10, max_block_types: 12, include_inventory: true };
}

// Minimal mock of the bot surface snapshot.ts needs.
function fakeBot() {
  const blocks: Record<string, string> = {};
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  blocks[key(2, 64, 0)] = "oak_log";
  blocks[key(3, 64, 0)] = "oak_log";
  blocks[key(4, 64, 0)] = "dirt";
  return {
    entity: { position: { x: 1.5, y: 64, z: -3.25 } },
    health: 20,
    food: 20,
    time: { timeOfDay: 6000 },
    game: { dimension: "overworld" },
    inventory: {
      items: () => [
        { name: "oak_log", count: 5 },
        { name: "dirt", count: 64 },
      ],
    },
    entities: {
      e1: {
        name: "Zombie",
        kind: "Hostile mobs",
        position: { x: 5, y: 64, z: 0, distanceTo: () => 4 },
      },
      e2: {
        name: "Pig",
        kind: "Passive mobs",
        position: { x: 50, y: 64, z: 0, distanceTo: () => 49 },
      },
    },
    blockAt: (p: { x: number; y: number; z: number }) => {
      const name = blocks[key(Math.round(p.x), Math.round(p.y), Math.round(p.z))];
      return name ? { name } : { name: "air" };
    },
    findBlocks: (opts: { count: number }) => {
      const out = [];
      for (const [k] of Object.entries(blocks)) {
        if (out.length >= opts.count) break;
        const [x, y, z] = k.split(",").map(Number);
        out.push({ x, y, z });
      }
      return out;
    },
  };
}

describe("buildSnapshot", () => {
  it("includes position, health, inventory and nearby entities/blocks", () => {
    const text = buildSnapshot(fakeBot(), fakeConfig());
    expect(text).toMatch(/pos.*1\.5.*64.*-3\.3/);
    expect(text).toMatch(/health.*20/);
    expect(text).toMatch(/oak_log x5/);
    expect(text).toMatch(/Zombie/);
    expect(text).not.toMatch(/Pig/); // beyond radius
    expect(text).toMatch(/oak_log x2/);
    expect(text).toMatch(/dim: overworld/);
  });

  it("truncates entities and block types to configured maxima", () => {
    const entities: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      entities[`e${i}`] = {
        name: `Mob${i}`,
        position: { x: 1, y: 64, z: 1, distanceTo: () => 2 },
      };
    }
    const bot = { ...fakeBot(), entities };
    const text = buildSnapshot(
      bot,
      { ...fakeConfig(), max_entities: 5, max_block_types: 2 },
    );
    expect(text).toMatch(/Mob0/);
    expect(text).toMatch(/and \d+ more/);
  });

  it("omits inventory when disabled", () => {
    const text = buildSnapshot(fakeBot(), {
      ...fakeConfig(),
      include_inventory: false,
    });
    expect(text).not.toMatch(/oak_log x5/);
  });
});
