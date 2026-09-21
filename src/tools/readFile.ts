import { z } from "zod";
import { readFile } from "node:fs/promises";
import { safeRun } from "./timeout.js";
import type { ToolDef } from "./types.js";

const schema = z.object({ file: z.string().min(1) });

function allowlist(ctx: { config: { memory: { soul_file: string; memory_file: string; tasks_file: string } } }): string[] {
  return [ctx.config.memory.soul_file, ctx.config.memory.memory_file, ctx.config.memory.tasks_file];
}

export const readFileTool: ToolDef = {
  name: "read_file",
  description: "Read one of the agent memory files (SOUL.md, MEMORY.md, TASKS.md). Rejects any other path.",
  schema,
  readOnly: true,
  async run(args, ctx, _signal) {
    return safeRun(async () => {
      const file = args["file"] as string;
      if (!allowlist(ctx as never).includes(file)) {
        return { text: `Error: '${file}' is not allowlisted. Allowed: ${allowlist(ctx as never).join(", ")}.`, isError: true };
      }
      const content = await readFile(file, "utf8").catch(() => null);
      if (content === null) return { text: `Error: could not read '${file}'.`, isError: true };
      return { text: content.slice(0, 8000), isError: false };
    });
  },
};
