import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packageJsonDetector } from "../package-json.js";

describe("packageJsonDetector", () => {
  let tempDir: string;

  // Create a fresh temp directory before each test
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ccc-test-"));
  });

  // Clean up after each test
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("detects React and TypeScript from dependencies", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.2.0" },
        devDependencies: { typescript: "^5.4.0" },
      }),
    );

    const result = await packageJsonDetector.detect(tempDir);

    expect(result).toContainEqual(
      expect.objectContaining({
        name: "React",
        category: "framework",
        version: "18.2.0",
        confidence: 1.0,
      }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({
        name: "TypeScript",
        category: "language",
      }),
    );
  });

  it("detects full Next.js + PostGraphile + Relay stack", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: {
          next: "^14.1.0",
          "react-relay": "^16.0.0",
          postgraphile: "^4.14.0",
          pg: "^8.11.0",
          ioredis: "^5.3.0",
          bullmq: "^5.0.0",
        },
        devDependencies: {
          typescript: "^5.4.0",
          vitest: "^3.0.0",
          tailwindcss: "^3.4.0",
        },
      }),
    );

    const result = await packageJsonDetector.detect(tempDir);
    const names = result.map((r) => r.name);

    expect(names).toContain("Next.js");
    expect(names).toContain("Relay");
    expect(names).toContain("PostGraphile");
    expect(names).toContain("PostgreSQL (pg)");
    expect(names).toContain("Redis");
    expect(names).toContain("BullMQ");
    expect(names).toContain("Vitest");
    expect(names).toContain("Tailwind CSS");
  });

  it("returns empty array when no package.json exists", async () => {
    const result = await packageJsonDetector.detect(tempDir);
    expect(result).toEqual([]);
  });

  it("returns empty array for invalid JSON", async () => {
    await writeFile(join(tempDir, "package.json"), "not valid json {{{}");
    const result = await packageJsonDetector.detect(tempDir);
    expect(result).toEqual([]);
  });

  it("deduplicates technologies (prisma + @prisma/client)", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { "@prisma/client": "^5.0.0" },
        devDependencies: { prisma: "^5.0.0" },
      }),
    );

    const result = await packageJsonDetector.detect(tempDir);
    const prismaResults = result.filter((r) => r.name === "Prisma");
    expect(prismaResults).toHaveLength(1);
  });
});
