// tests/unit/memory-tools.test.ts
import { describe, expect, it } from "vitest";
import { readFileTool } from "../../src/tools/readFile.js";
import { writeFileTool } from "../../src/tools/writeFile.js";
import { configSchema } from "../../src/config/schema.js";

describe("memory tools", () => {
  it("read_file reads an allowlisted file", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "lodestone-"));
    writeFileSync(join(dir, "MEMORY.md"), "# hi", "utf8");
    const config = configSchema.parse({
      llm: { base_url: "https://example.com", model: "m" },
      memory: { soul_file: join(dir, "SOUL.md"), memory_file: join(dir, "MEMORY.md"), tasks_file: join(dir, "TASKS.md") },
    });
    const res = await readFileTool.run({ file: join(dir, "MEMORY.md") }, { bot: {}, config }, new AbortController().signal);
    expect(res.isError).toBe(false);
    expect(res.text).toContain("# hi");
  });

  it("write_file rejects paths outside the allowlist", async () => {
    const config = configSchema.parse({ llm: { base_url: "https://example.com", model: "m" } });
    const res = await writeFileTool.run(
      { file: "/etc/passwd", content: "x" },
      { bot: {}, config },
      new AbortController().signal,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not allowlisted|not allowed/i);
  });
});
