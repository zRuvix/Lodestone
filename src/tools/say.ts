import { z } from "zod";
import { safeRun } from "./timeout.js";
import type { ToolDef } from "./types.js";

export const sayTool: ToolDef = {
  name: "say",
  description: "Send a chat message to the server.",
  schema: z.object({
    message: z.string().min(1).max(256),
  }),
  readOnly: false,
  async run(args, ctx, _signal) {
    return safeRun(async () => {
      const bot = ctx.bot as unknown as { chat: (msg: string) => void };
      const message = args["message"] as string;
      bot.chat(message);
      return { text: `Said: ${message}`, isError: false };
    });
  },
};
