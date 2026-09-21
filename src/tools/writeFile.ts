import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { safeRun } from "./timeout.js";
import type { ToolDef } from "./types.js";

const schema = z.object({ file: z.string().min(1), content: z.string().max(20000) });

export const writeFileTool: ToolDef = {
  name: "write_file",
  description: "Replace one of the agent memory files (SOUL.md, MEMORY.md, TASKS.md) with new content. Read the file first, then write the full updated version. Rejects any other path.",
  schema,
  readOnly: false,
  async run(args, ctx, _signal) {
    return safeRun(async () => {
      const file = args["file"] as string;
      const allowed = [ctx.config.memory.soul_file, ctx.config.memory.memory_file, ctx.config.memory.tasks_file];
      if (!allowed.includes(file)) {
        return { text: `Error: '${file}' is not allowlisted. Allowed: ${allowed.join(", ")}.`, isError: true };
      }
      await writeFile(file, args["content"] as string, "utf8");
      return { text: `Wrote ${(args["content"] as string).length} chars to '${file}'. Takes effect as noted (TASKS/MEMORY immediate on next read, SOUL on restart).`, isError: false };
    });
  },
};
