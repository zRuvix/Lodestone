import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/loader.js";
import { createLlmClient } from "../../src/llm/client.js";
import { runConnectivityCheck } from "../../src/llm/check.js";

const RUN = process.env["RUN_INTEGRATION"] === "1";

describe.runIf(RUN)("integration: llm", () => {
  it("check:llm flow passes against the real endpoint", async () => {
    const loaded = await loadConfig(process.env["LODESTONE_CONFIG"] ?? "./config.yaml");
    const client = createLlmClient(loaded.config, loaded.apiKey);
    const report = await runConnectivityCheck(client);
    for (const step of report.steps) {
      expect(
        step.pass,
        `${step.name}: ${step.error ?? step.detail ?? ""}`,
      ).toBe(true);
    }
  }, 180000);
});
