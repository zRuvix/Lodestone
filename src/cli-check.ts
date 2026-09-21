import { loadConfig } from "./config/loader.js";
import { redactSecrets } from "./config/redact.js";
import { createLlmClient } from "./llm/client.js";
import { runConnectivityCheck } from "./llm/check.js";

const configPath =
  process.argv.find((arg, i) => process.argv[i - 1] === "--config" && arg) ??
  process.env["LODESTONE_CONFIG"] ??
  "./config.yaml";

function redactLine(line: string, secrets: string[]): string {
  return redactSecrets(line, secrets);
}

async function main(): Promise<void> {
  let loaded;
  try {
    loaded = await loadConfig(configPath);
  } catch (err) {
    console.error(`Config error: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }
  const { config, apiKey, baseUrlWarnings } = loaded;
  const secrets = [apiKey];

  for (const warning of baseUrlWarnings) {
    console.log(`WARN: ${redactLine(warning, secrets)}`);
  }
  console.log(`Endpoint : ${redactLine(config.llm.base_url, secrets)}/v1/messages`);
  console.log(`Model    : ${redactLine(config.llm.model, secrets)}`);
  console.log(`Auth     : ${config.llm.auth_type}`);
  console.log("");

  const client = createLlmClient(config, apiKey);
  const report = await runConnectivityCheck(client);

  let totalIn = 0;
  let totalOut = 0;
  for (const step of report.steps) {
    const status = step.pass ? "PASS" : "FAIL";
    const usage =
      step.inputTokens !== undefined
        ? ` tokens(in=${step.inputTokens}, out=${step.outputTokens ?? 0})`
        : "";
    console.log(`[${status}] ${step.name} (${step.latencyMs}ms)${usage}`);
    if (step.detail) console.log(`       ${redactLine(step.detail, secrets)}`);
    if (step.error) console.log(`       ERROR: ${redactLine(step.error, secrets)}`);
    totalIn += step.inputTokens ?? 0;
    totalOut += step.outputTokens ?? 0;
  }
  console.log("");
  console.log(
    report.overallPass
      ? `All checks passed. Total tokens: in=${totalIn}, out=${totalOut}.`
      : "Connectivity check FAILED. Fix the errors above before continuing.",
  );
  process.exitCode = report.overallPass ? 0 : 1;
}

main().catch((err) => {
  console.error(`Unexpected error: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
