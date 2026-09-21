import { toJSONSchema } from "zod";
import { collectBlockTool } from "./collectBlock.js";
import { gotoTool } from "./goto.js";
import { observeTool } from "./observe.js";
import { readFileTool } from "./readFile.js";
import { sayTool } from "./say.js";
import { writeFileTool } from "./writeFile.js";
import type { ToolDef } from "./types.js";

export const TOOL_REGISTRY: ToolDef[] = [
  observeTool,
  gotoTool,
  collectBlockTool,
  sayTool,
  readFileTool,
  writeFileTool,
];

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Convert the allowlisted tools to Messages API tool definitions,
 * using Zod v4's built-in JSON Schema converter.
 */
export function toAnthropicTools(allowlist: string[]): AnthropicToolDef[] {
  const byName = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));
  return allowlist.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Unknown tool in allowlist: ${name}`);
    return {
      name: tool.name,
      description: tool.description,
      input_schema: toJSONSchema(tool.schema) as Record<string, unknown>,
    };
  });
}

export function getTool(name: string): ToolDef | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
