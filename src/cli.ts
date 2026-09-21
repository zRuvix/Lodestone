import { readFile } from "node:fs/promises";
import { createBotManager } from "./bot/manager.js";
import { loadConfig } from "./config/loader.js";
import { redactSecrets } from "./config/redact.js";
import { createAgent } from "./agent/loop.js";
import { createLlmClient } from "./llm/client.js";
import { applyMovements } from "./tools/movements.js";
import { ensureMemoryFiles } from "./memory/files.js";
import { HEARTBEAT_PROMPT, shouldSkipHeartbeatTick } from "./daemon/tick.js";
import { createSayLimiter, formatChatInject, isSelf } from "./chat/router.js";

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = process.env["LODESTONE_CONFIG"] ?? "./config.yaml";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--config" && argv[i + 1]) {
      configPath = argv[++i]!;
    }
  }
  return { configPath };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const { configPath } = parseArgs(process.argv);

  const loaded = await loadConfig(configPath).catch((err: Error) => {
    console.error(`Config error: ${err.message}`);
    process.exit(1);
  });
  if (!loaded) return;
  const { config, apiKey, baseUrlWarnings } = loaded;
  const secrets = [apiKey];
  const safe = (s: string) => redactSecrets(s, secrets);

  for (const w of baseUrlWarnings) console.log(`WARN: ${safe(w)}`);

  const { created } = await ensureMemoryFiles(
    {
      soul: config.memory.soul_file,
      memory: config.memory.memory_file,
      tasks: config.memory.tasks_file,
    },
    {
      soul: "SOUL.example.md",
      memory: "MEMORY.example.md",
      tasks: "TASKS.example.md",
    },
  );
  for (const f of created) console.log(`Created memory file: ${f}`);

  let basePrompt: string;
  try {
    basePrompt = await readFile(config.agent.system_prompt_file, "utf8");
  } catch {
    console.error(`Could not read system prompt file: ${config.agent.system_prompt_file}`);
    process.exitCode = 1;
    return;
  }
  const soul = await readFile(config.memory.soul_file, "utf8").catch(() => "");
  const systemPrompt =
    `${basePrompt}\n\n# SOUL (agent identity)\n${soul}\n\n` +
    `Your memory files: ${config.memory.soul_file} (identity, applies on restart), ` +
    `${config.memory.memory_file} (facts — update it), ` +
    `${config.memory.tasks_file} (work top unchecked item when idle, mark done). Files are your memory across restarts.`;

  const manager = createBotManager(config);
  console.log(`Connecting to ${config.minecraft.host}:${config.minecraft.port} as ${config.minecraft.username} ...`);
  let bot: Awaited<ReturnType<typeof manager.connect>> | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      bot = await manager.connect();
      break;
    } catch (err) {
      if (attempt >= config.agent.reconnect_attempts) {
        console.error(`Connect failed: ${safe(err instanceof Error ? err.message : String(err))}`);
        process.exitCode = 1;
        return;
      }
      const delayMs = 2 ** attempt * 1000;
      console.log(`Connect attempt ${attempt + 1} failed, retrying in ${delayMs / 1000}s ...`);
      await sleep(delayMs);
    }
  }
  if (!bot) return;
  console.log("Spawned. Applying pathfinder settings ...");
  const pathfinder = await import("mineflayer-pathfinder").then(
    (m) => ((m as { default?: unknown }).default ?? m) as { pathfinder: (b: unknown) => void },
  );
  pathfinder.pathfinder(bot);
  await applyMovements(bot, config.pathfinder);

  manager.events.on("chat", (username: string, message: string) => {
    console.log(`[chat] <${username}> ${message}`);
  });
  manager.events.on("death", () => console.log("[event] died"));
  // Damage is log-only, never injected: it fires many times per second in a
  // fight and would wedge the model's context behind noise (plus the rate
  // limiter would burn turns on it instead of replying to chat).
  manager.events.on("damage", () => console.log("[event] damage"));

  const limiter = createSayLimiter(config.chat);
  let busy = false;

  const agent = createAgent({
    goal: "You are now online. Read SOUL.md, MEMORY.md, TASKS.md, then observe.",
    systemPrompt,
    allowedTools: config.agent.allowed_tools,
    maxTurns: config.agent.max_turns,
    keepLastObservations: config.agent.keep_last_observations,
    parallelReadOnlyTools: config.agent.parallel_read_only_tools,
    temperature: config.llm.temperature,
    promptCaching: config.llm.prompt_caching,
    llm: createLlmClient(config, apiKey),
    ctx: { bot, config },
    hooks: {
      beforeTool: (name, input) => {
        busy = true;
        // v1 say rate-limit enforcement: throwing here is caught by runOneCall's
        // hook-veto guard and surfaced as an isError tool_result,
        // telling the model to slow down.
        if (name === "say" && !limiter.trySay()) {
          console.log("[say] rate-limited, skipped");
          throw new Error("say rate-limited, skipped");
        }
        console.log(`[tool] ${name} ${safe(JSON.stringify(input))}`);
      },
      afterTool: (name, result) => {
        busy = false;
        console.log(`[result] ${name} ${result.isError ? "ERROR" : "ok"}: ${safe(result.text).slice(0, 500)}`);
      },
      onTurn: (turn, inT, outT) => console.log(`--- turn ${turn} (in=${inT < 0 ? "n/a" : inT}, out=${outT < 0 ? "n/a" : outT}) ---`),
      onText: (text) => {
        if (config.logging.show_reasoning) console.log(`[model] ${safe(text).slice(0, 1000)}`);
      },
    },
  });

  manager.events.on("chat", (username: string, message: string) => {
    if (isSelf(username, config.minecraft.username)) return;
    agent.inject(formatChatInject(username, message));
  });

  let shuttingDown = false;
  const heartbeatMs = config.agent.heartbeat_seconds * 1000;
  const heartbeat = setInterval(() => {
    if (shouldSkipHeartbeatTick(busy)) return;
    agent.inject(HEARTBEAT_PROMPT);
  }, heartbeatMs);

  const onSigint = () => {
    console.log("\nShutting down ...");
    shuttingDown = true;
    clearInterval(heartbeat);
    agent.cancel();
    manager.disconnect("shutdown");
  };
  process.once("SIGINT", onSigint);

  // Daemon outer loop: each run() returns at done/max_turns; history resets
  // per outer iteration by design — MEMORY.md/TASKS.md carry state.
  while (!shuttingDown) {
    const result = await agent.run();
    console.log(
      `Iteration finished: status=${result.status} turns=${result.turns} tokens(in=${result.inputTokens}, out=${result.outputTokens})${result.note ? ` note=${safe(result.note)}` : ""}`,
    );
    if (shuttingDown) break;
    agent.inject("[continue] Keep watching chat and heartbeat. Check TASKS.md for pending work.");
    await sleep(1000);
  }

  process.off("SIGINT", onSigint);
  clearInterval(heartbeat);
  manager.disconnect("shutdown");
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`Unexpected error: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
