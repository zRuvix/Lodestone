import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface MemoryPaths { soul: string; memory: string; tasks: string; }

async function exists(path: string): Promise<boolean> {
  try { await readFile(path, "utf8"); return true; } catch { return false; }
}

export async function ensureMemoryFiles(paths: MemoryPaths, templates: MemoryPaths): Promise<{ created: string[] }> {
  const created: string[] = [];
  const pairs: [string, string][] = [
    [paths.soul, templates.soul],
    [paths.memory, templates.memory],
    [paths.tasks, templates.tasks],
  ];
  for (const [live, template] of pairs) {
    if (await exists(live)) continue;
    const seed = await readFile(template, "utf8").catch(() => "");
    await mkdir(dirname(live) === "." ? "." : dirname(live), { recursive: true });
    await writeFile(live, seed, "utf8");
    created.push(live);
  }
  return { created };
}
