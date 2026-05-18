import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { monorepoDetector } from "../monorepo.js";

describe("monorepoDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-mono-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects Turborepo", async () => {
    await writeFile(join(dir, "turbo.json"), JSON.stringify({ $schema: "https://turbo.build/schema.json" }));
    const names = (await monorepoDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Turborepo");
  });

  it("detects Nx", async () => {
    await writeFile(join(dir, "nx.json"), JSON.stringify({ version: 3 }));
    const names = (await monorepoDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Nx");
  });

  it("detects Lerna with version", async () => {
    await writeFile(join(dir, "lerna.json"), JSON.stringify({ version: "independent" }));
    const result = await monorepoDetector.detect(dir);
    const lerna = result.find((r) => r.name === "Lerna");
    expect(lerna).toBeDefined();
    expect(lerna?.version).toBe("independent");
  });

  it("detects pnpm workspaces", async () => {
    await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    const names = (await monorepoDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("pnpm Workspaces");
  });

  it("detects Changesets", async () => {
    await mkdir(join(dir, ".changeset"), { recursive: true });
    await writeFile(join(dir, ".changeset", "config.json"), "{}");
    const names = (await monorepoDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Changesets");
  });

  it("detects yarn workspaces from package.json", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] })
    );
    const names = (await monorepoDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Yarn Workspaces");
  });

  it("returns empty for plain project", async () => {
    expect(await monorepoDetector.detect(dir)).toEqual([]);
  });
});
