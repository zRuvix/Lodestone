import { readFile } from "node:fs/promises";
import { createBotManager } from "./bot/manager.js";
import { loadConfig } from "./config/loader.js";
import { redactSecrets } from "./config/redact.js";
import { createAgent } from "./agent/loop.js";
import { createLlmClient } from "./llm/client.js";
import { applyMovements } from "./tools/movements.js";

function parseArgs(argv: string[]): { configPath: string; goalParts: string[] } {
  let configPath = process.env["LODESTONE_CONFIG"] ?? "./config.yaml";
  const goalParts: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--config" && argv[i + 1]) {
      configPath = argv[++i]!;
    } else {
      goalParts.push(argv[i]!);
    }
  }
  return { configPath, goalParts };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const { configPath, goalParts } = parseArgs(process.argv);
  let goal = goalParts.join(" ").trim();
  if (!goal) goal = await readStdin();
  if (!goal) {
    console.error('Usage: lodestone [--config <path>] "<goal>" (or pipe goal via stdin)');
    process.exitCode = 2;
    return;
  }

  const loaded = await loadConfig(configPath).catch((err: Error) => {
    console.error(`Config error: ${err.message}`);
    process.exit(1);
  });
  if (!loaded) return;
  const { config, apiKey, baseUrlWarnings } = loaded;
  const secrets = [apiKey];
  const safe = (s: string) => redactSecrets(s, secrets);

  for (const w of baseUrlWarnings) console.log(`WARN: ${safe(w)}`);

  let systemPrompt: string;
  try {
    systemPrompt = await readFile(config.agent.system_prompt_file, "utf8");
  } catch {
    console.error(`Could not read system prompt file: ${config.agent.system_prompt_file}`);
    process.exitCode = 1;
    return;
  }

  const llm = createLlmClient(config, apiKey);
  const manager = createBotManager(config);
  console.log(`Connecting to ${config.minecraft.host}:${config.minecraft.port} as ${config.minecraft.username} ...`);
  const bot = await manager.connect().catch((err: Error) => {
    console.error(`Connect failed: ${safe(err.message)}`);
    process.exit(1);
  });
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
  manager.events.on("damage", () => console.log("[event] damage"));

  const agent = createAgent({
    goal,
    systemPrompt,
    allowedTools: config.agent.allowed_tools,
    maxTurns: config.agent.max_turns,
    keepLastObservations: config.agent.keep_last_observations,
    parallelReadOnlyTools: config.agent.parallel_read_only_tools,
    temperature: config.llm.temperature,
    promptCaching: config.llm.prompt_caching,
    llm,
    ctx: { bot, config },
    hooks: {
      beforeTool: (name, input) => console.log(`[tool] ${name} ${safe(JSON.stringify(input))}`),
      afterTool: (name, result) =>
        console.log(`[result] ${name} ${result.isError ? "ERROR" : "ok"}: ${safe(result.text).slice(0, 500)}`),
      onTurn: (turn, inT, outT) => console.log(`--- turn ${turn} (in=${inT}, out=${outT}) ---`),
      onText: (text) => {
        if (config.logging.show_reasoning) console.log(`[model] ${safe(text).slice(0, 1000)}`);
      },
    },
  });

  const onSigint = () => {
    console.log("\nCancelling ...");
    agent.cancel();
  };
  process.once("SIGINT", onSigint);

  const result = await agent.run();
  process.off("SIGINT", onSigint);
  console.log(
    `Finished: status=${result.status} turns=${result.turns} tokens(in=${result.inputTokens}, out=${result.outputTokens})${result.note ? ` note=${safe(result.note)}` : ""}`,
  );
  manager.disconnect("done");
  process.exitCode = result.status === "done" ? 0 : 1;
}

main().catch((err) => {
  console.error(`Unexpected error: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
