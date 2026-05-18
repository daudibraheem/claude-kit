import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lockFileDetector } from "../lock-file.js";

describe("lockFileDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-lock-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const result = await lockFileDetector.detect(dir);
    expect(result[0]!.name).toBe("pnpm");
    expect(result[0]!.confidence).toBe(1.0);
  });

  it("detects npm from package-lock.json", async () => {
    await writeFile(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
    const result = await lockFileDetector.detect(dir);
    expect(result[0]!.name).toBe("npm");
  });

  it("detects yarn from yarn.lock", async () => {
    await writeFile(join(dir, "yarn.lock"), "# yarn lockfile v1\n");
    const result = await lockFileDetector.detect(dir);
    expect(result[0]!.name).toBe("Yarn");
  });

  it("detects bun from bun.lockb (highest priority)", async () => {
    await writeFile(join(dir, "bun.lockb"), "");
    await writeFile(join(dir, "package-lock.json"), "{}");
    const result = await lockFileDetector.detect(dir);
    expect(result[0]!.name).toBe("Bun");
    expect(result).toHaveLength(1);
  });

  it("returns empty when no lock file exists", async () => {
    expect(await lockFileDetector.detect(dir)).toEqual([]);
  });
});
