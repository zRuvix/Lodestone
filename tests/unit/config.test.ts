import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config/loader.js";
import { normalizeBaseUrl } from "../../src/config/base-url.js";

const VALID_YAML = `
llm:
  base_url: "https://example.com"
  model: "test-model"
minecraft:
  host: "localhost"
`;

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lodestone-"));
  configPath = join(dir, "config.yaml");
  vi.stubEnv("LODESTONE_API_KEY", "secret-key-123");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadConfig", () => {
  it("loads a valid file with defaults filled", async () => {
    writeFileSync(configPath, VALID_YAML);
    const { config, apiKey } = await loadConfig(configPath);
    expect(apiKey).toBe("secret-key-123");
    expect(config.minecraft.port).toBe(25565);
    expect(config.minecraft.version).toBe("1.21.1");
    expect(config.agent.max_turns).toBe(40);
    expect(config.llm.auth_type).toBe("bearer");
  });

  it("fails on missing required fields", async () => {
    writeFileSync(configPath, `minecraft:\n  host: "x"\n`);
    await expect(loadConfig(configPath)).rejects.toThrow(/llm/);
  });

  it("fails on bad values naming the field", async () => {
    writeFileSync(
      configPath,
      `llm:\n  base_url: "https://example.com"\n  model: "m"\nminecraft:\n  port: "abc"\n`,
    );
    await expect(loadConfig(configPath)).rejects.toThrow(/minecraft\.port/);
  });

  it("fails on unknown allowed_tools names", async () => {
    writeFileSync(
      configPath,
      `llm:\n  base_url: "https://example.com"\n  model: "m"\nagent:\n  allowed_tools: [observe, nuke]\n`,
    );
    await expect(loadConfig(configPath)).rejects.toThrow(/nuke/);
  });

  it("fails when the key env var is missing, naming the variable", async () => {
    vi.stubEnv("LODESTONE_API_KEY", "");
    writeFileSync(configPath, VALID_YAML);
    await expect(loadConfig(configPath)).rejects.toThrow(/LODESTONE_API_KEY/);
  });
});

describe("normalizeBaseUrl", () => {
  it("strips a full /v1/messages URL with a warning", () => {
    const { url, warnings } = normalizeBaseUrl(
      "https://example.com/v1/messages",
    );
    expect(url).toBe("https://example.com");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("leaves a plain base URL alone", () => {
    const { url, warnings } = normalizeBaseUrl("https://example.com/");
    expect(url).toBe("https://example.com");
    expect(warnings).toEqual([]);
  });
});
