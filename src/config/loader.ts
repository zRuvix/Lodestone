import { readFile } from "node:fs/promises";
import { config as loadDotenv } from "dotenv";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { normalizeBaseUrl } from "./base-url.js";
import { configSchema, type LodestoneConfig } from "./schema.js";

export interface LoadedConfig {
  config: LodestoneConfig;
  /** API key read from the env var named by llm.api_key_env. Never log this. */
  apiKey: string;
  baseUrlWarnings: string[];
}

/** Names of tools the agent loop may expose. Unknown names in config are an error. */
export const KNOWN_TOOL_NAMES = ["observe", "goto", "collect_block", "craft", "attack", "drop", "say", "read_file", "write_file"];

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".") || "(root)";
      return `  - ${path}: ${issue.message}`;
    })
    .join("\n");
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  loadDotenv();

  let rawText: string;
  try {
    rawText = await readFile(configPath, "utf8");
  } catch {
    throw new Error(
      `Could not read config file at ${configPath}. Copy config.example.yaml to ${configPath} first.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(rawText);
  } catch (err) {
    throw new Error(
      `Invalid YAML in ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid config in ${configPath}:\n${formatZodError(result.error)}`,
    );
  }
  const config = result.data;

  const unknownTools = config.agent.allowed_tools.filter(
    (name) => !KNOWN_TOOL_NAMES.includes(name),
  );
  if (unknownTools.length > 0) {
    throw new Error(
      `Invalid config in ${configPath}:\n` +
        `  - agent.allowed_tools: unknown tool(s): ${unknownTools.join(", ")}. ` +
        `Known tools: ${KNOWN_TOOL_NAMES.join(", ")}`,
    );
  }

  const apiKey = process.env[config.llm.api_key_env];
  if (!apiKey) {
    throw new Error(
      `Missing API key: environment variable ${config.llm.api_key_env} is not set. ` +
        `Set it or add it to .env (see .env.example).`,
    );
  }

  const { url, warnings } = normalizeBaseUrl(config.llm.base_url);

  return {
    config: { ...config, llm: { ...config.llm, base_url: url } },
    apiKey,
    baseUrlWarnings: warnings,
  };
}
