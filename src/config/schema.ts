import { z } from "zod";

const llmSchema = z.object({
  base_url: z.string().min(1, "llm.base_url is required"),
  api_key_env: z.string().min(1).default("LODESTONE_API_KEY"),
  auth_type: z.enum(["api_key", "bearer"]).default("bearer"),
  model: z.string().min(1, "llm.model is required"),
  max_tokens: z.number().int().positive().default(2048),
  temperature: z.number().min(0).max(1).nullable().default(null),
  stream: z.boolean().default(true),
  prompt_caching: z.boolean().default(false),
  extra_headers: z.record(z.string(), z.string()).default({}),
  request_timeout_seconds: z.number().positive().default(120),
  max_retries: z.number().int().min(0).default(2),
});

const minecraftSchema = z.object({
  host: z.string().min(1).default("localhost"),
  port: z.number().int().min(1).max(65535).default(25565),
  version: z.string().min(1).default("1.21.1"),
  username: z.string().min(1).default("Agent"),
  auth: z.enum(["offline", "microsoft"]).default("offline"),
  connect_timeout_seconds: z.number().positive().default(30),
  auto_reconnect: z.boolean().default(false),
});

const agentSchema = z.object({
  max_turns: z.number().int().positive().default(40),
  system_prompt_file: z.string().min(1).default("prompts/system.md"),
  allowed_tools: z
    .array(z.string())
    .default(["observe", "goto", "collect_block", "say", "read_file", "write_file"]),
  parallel_read_only_tools: z.boolean().default(false),
  keep_last_observations: z.number().int().min(0).default(3),
  heartbeat_seconds: z.number().positive().default(30),
  heartbeat_max_turns: z.number().int().positive().default(8),
  reconnect_attempts: z.number().int().min(0).default(5),
});

const observationSchema = z.object({
  radius: z.number().positive().default(16),
  max_entities: z.number().int().min(0).default(10),
  max_block_types: z.number().int().min(0).default(12),
  include_inventory: z.boolean().default(true),
});

const toolsSchema = z.object({
  default_timeout_seconds: z.number().positive().default(60),
  goto: z
    .object({
      arrive_distance: z.number().positive().default(1),
      timeout_seconds: z.number().positive().default(90),
    })
    .prefault({}),
  collect_block: z
    .object({
      search_radius: z.number().positive().default(32),
      max_count: z.number().int().positive().default(64),
      timeout_seconds: z.number().positive().default(120),
    })
    .prefault({}),
  craft: z
    .object({
      timeout_seconds: z.number().positive().default(60),
    })
    .prefault({}),
  attack: z
    .object({
      timeout_seconds: z.number().positive().default(60),
    })
    .prefault({}),
});

const pathfinderSchema = z.object({
  can_dig: z.boolean().default(true),
  allow_sprinting: z.boolean().default(true),
  allow_parkour: z.boolean().default(false),
  max_drop_down: z.number().int().min(0).default(3),
  allow_1by1_towers: z.boolean().default(false),
});

const loggingSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  show_reasoning: z.boolean().default(true),
  log_file: z.string().nullable().default(null),
});

const chatSchema = z.object({
  reply_cooldown_seconds: z.number().min(0).default(3),
  max_replies_per_minute: z.number().int().min(1).default(10),
  respond_to_ambient: z.boolean().default(false),
  fast_lane: z.boolean().default(true),
  fast_max_tokens: z.number().int().positive().default(128),
});

const memorySchema = z.object({
  soul_file: z.string().min(1).default("SOUL.md"),
  memory_file: z.string().min(1).default("MEMORY.md"),
  tasks_file: z.string().min(1).default("TASKS.md"),
});

export const configSchema = z.object({
  llm: llmSchema,
  minecraft: minecraftSchema.prefault({}),
  agent: agentSchema.prefault({}),
  observation: observationSchema.prefault({}),
  tools: toolsSchema.prefault({}),
  pathfinder: pathfinderSchema.prefault({}),
  logging: loggingSchema.prefault({}),
  chat: chatSchema.prefault({}),
  memory: memorySchema.prefault({}),
});

export type LodestoneConfig = z.infer<typeof configSchema>;
