import type { z } from "zod";
import type { Bot } from "mineflayer";
import type { LodestoneConfig } from "../config/schema.js";

export interface ToolContext {
  bot: Bot;
  config: LodestoneConfig;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  /** True if the tool only reads state (eligible for parallel execution). */
  readOnly: boolean;
  run(
    args: Record<string, unknown>,
    ctx: ToolContext,
    signal: AbortSignal,
  ): Promise<ToolResult>;
}
