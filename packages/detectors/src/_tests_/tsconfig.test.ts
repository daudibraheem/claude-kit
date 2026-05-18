import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tsconfigDetector } from "../tsconfig.js";

describe("tsconfigDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-ts-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects TypeScript with full compilerOptions", async () => {
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          strict: true,
          outDir: "dist",
          baseUrl: ".",
        },
      })
    );
    const result = await tsconfigDetector.detect(dir);
    expect(result).toHaveLength(1);
    expect(result[0]!).toMatchObject({
      name: "TypeScript",
      category: "language",
      confidence: 1.0,
    });
    expect(result[0]!.metadata!).toMatchObject({ target: "ES2022", strict: true });
  });

  it("detects TypeScript with minimal config (lower confidence)", async () => {
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    const result = await tsconfigDetector.detect(dir);
    expect(result[0]!.name).toBe("TypeScript");
    expect(result[0]!.confidence).toBe(0.85);
  });

  it("handles tsconfig with comments", async () => {
    await writeFile(
      join(dir, "tsconfig.json"),
      `{
        // compiler config
        "compilerOptions": {
          "target": "ESNext", /* modern */
          "strict": true
        }
      }`
    );
    const result = await tsconfigDetector.detect(dir);
    expect(result[0]!.name).toBe("TypeScript");
  });

  it("returns empty when no tsconfig.json", async () => {
    expect(await tsconfigDetector.detect(dir)).toEqual([]);
  });

  it("returns empty for invalid JSON", async () => {
    await writeFile(join(dir, "tsconfig.json"), "{ invalid }");
    expect(await tsconfigDetector.detect(dir)).toEqual([]);
  });
});
