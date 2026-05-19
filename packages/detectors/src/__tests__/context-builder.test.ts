import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { buildProjectContext } from "../context-builder.js";
import type { ScanResult } from "@claude-scout/core";

function makeScan(projectPath: string): ScanResult {
  return {
    projectName: "test-app",
    projectPath,
    technologies: [],
    packageManager: "pnpm",
    hasTypeScript: true,
    hasDocker: false,
    hasCi: false,
    monorepo: false,
    detectedAt: new Date(),
  };
}

let tmpDir: string;

async function setup(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), "ccc-ctx-test-"));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

// ─── Core files ────────────────────────────────────────────────────────────────

describe("buildProjectContext — core files", () => {
  it("reads package.json when present", async () => {
    const dir = await setup();
    const pkg = JSON.stringify({ name: "test-app", version: "1.0.0" });
    await writeFile(join(dir, "package.json"), pkg);

    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.packageJson).toContain("test-app");
  });

  it("returns undefined for package.json when absent", async () => {
    const dir = await setup();
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.packageJson).toBeUndefined();
  });

  it("reads tsconfig.json when present", async () => {
    const dir = await setup();
    await writeFile(join(dir, "tsconfig.json"), '{ "compilerOptions": { "strict": true } }');
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.tsConfig).toContain("strict");
  });

  it("reads .env.example when present", async () => {
    const dir = await setup();
    await writeFile(join(dir, ".env.example"), "DATABASE_URL=postgres://...\nJWT_SECRET=secret");
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.envExample).toContain("DATABASE_URL");
  });

  it("reads .env.sample as fallback for .env.example", async () => {
    const dir = await setup();
    await writeFile(join(dir, ".env.sample"), "API_KEY=test");
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.envExample).toContain("API_KEY");
  });

  it("reads existing CLAUDE.md", async () => {
    const dir = await setup();
    await writeFile(join(dir, "CLAUDE.md"), "# Old Claude Config\n\nSome content.");
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.existingClaudeMd).toContain("Old Claude Config");
  });

  it("reads docker-compose.yml", async () => {
    const dir = await setup();
    await writeFile(join(dir, "docker-compose.yml"), "version: '3'\nservices:\n  db:\n    image: postgres");
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.dockerCompose).toContain("postgres");
  });

  it("reads docker-compose.yaml as fallback", async () => {
    const dir = await setup();
    await writeFile(join(dir, "docker-compose.yaml"), "version: '3'\nservices: {}");
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.dockerCompose).toContain("version");
  });
});

// ─── Schema files ──────────────────────────────────────────────────────────────

describe("buildProjectContext — schema files", () => {
  it("finds and reads .prisma files", async () => {
    const dir = await setup();
    await mkdir(join(dir, "prisma"), { recursive: true });
    await writeFile(join(dir, "prisma", "schema.prisma"), "model User { id Int @id }");

    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.schemaFiles.length).toBeGreaterThan(0);
    expect(ctx.schemaFiles[0]).toContain("schema.prisma");
    expect(ctx.schemaFiles[0]).toContain("model User");
  });

  it("finds .graphql files", async () => {
    const dir = await setup();
    await writeFile(join(dir, "schema.graphql"), "type Query { hello: String }");

    const ctx = await buildProjectContext(dir, makeScan(dir));
    const found = ctx.schemaFiles.some((f) => f.includes("schema.graphql"));
    expect(found).toBe(true);
  });

  it("limits schema files to 3", async () => {
    const dir = await setup();
    for (let i = 0; i < 5; i++) {
      await writeFile(join(dir, `schema${i}.prisma`), `model M${i} { id Int @id }`);
    }
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.schemaFiles.length).toBeLessThanOrEqual(3);
  });
});

// ─── Test samples ──────────────────────────────────────────────────────────────

describe("buildProjectContext — test samples", () => {
  it("finds .test.ts files", async () => {
    const dir = await setup();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "app.test.ts"), "import { test } from 'vitest';\ntest('works', () => {});");

    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.testSamples.length).toBeGreaterThan(0);
    expect(ctx.testSamples[0]).toContain("app.test.ts");
  });

  it("limits test samples to 2", async () => {
    const dir = await setup();
    await mkdir(join(dir, "src"), { recursive: true });
    for (let i = 0; i < 5; i++) {
      await writeFile(join(dir, "src", `comp${i}.test.ts`), `test('t${i}', () => {})`);
    }
    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.testSamples.length).toBeLessThanOrEqual(2);
  });
});

// ─── Folder structure ──────────────────────────────────────────────────────────

describe("buildProjectContext — folderStructure", () => {
  it("returns a non-empty folder tree string", async () => {
    const dir = await setup();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "index.ts"), "export {}");
    await writeFile(join(dir, "package.json"), "{}");

    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.folderStructure).toContain("src/");
    expect(ctx.folderStructure).toContain("package.json");
  });

  it("excludes node_modules from folder tree", async () => {
    const dir = await setup();
    await mkdir(join(dir, "node_modules", "some-dep"), { recursive: true });
    await writeFile(join(dir, "node_modules", "some-dep", "index.js"), "module.exports = {}");

    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.folderStructure).not.toContain("node_modules");
  });

  it("excludes .git from folder tree", async () => {
    const dir = await setup();
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main");

    const ctx = await buildProjectContext(dir, makeScan(dir));
    expect(ctx.folderStructure).not.toContain(".git");
  });
});

// ─── Scan result is passed through ────────────────────────────────────────────

describe("buildProjectContext — scan passthrough", () => {
  it("passes the scan result through to the context", async () => {
    const dir = await setup();
    const scan = makeScan(dir);
    const ctx = await buildProjectContext(dir, scan);
    expect(ctx.scan).toBe(scan);
  });
});

// ─── Empty project ─────────────────────────────────────────────────────────────

describe("buildProjectContext — empty project", () => {
  it("returns a valid context with empty arrays for an empty directory", async () => {
    const dir = await setup();
    const ctx = await buildProjectContext(dir, makeScan(dir));

    expect(ctx.packageJson).toBeUndefined();
    expect(ctx.tsConfig).toBeUndefined();
    expect(ctx.envExample).toBeUndefined();
    expect(ctx.existingClaudeMd).toBeUndefined();
    expect(ctx.sampleSourceFiles).toEqual([]);
    expect(ctx.schemaFiles).toEqual([]);
    expect(ctx.testSamples).toEqual([]);
    expect(ctx.folderStructure).toBe("");
  });
});
