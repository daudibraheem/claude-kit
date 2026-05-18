import { readFile, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";
import { glob } from "glob";
import type { ScanResult, ProjectContext } from "@claude-kit/core";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", "out",
  ".turbo", "coverage", "__pycache__", ".venv", "venv", "target",
  "vendor", ".gradle", "bin", "obj", "__generated__",
]);

const MAX_FILE_CHARS = 5_000;

export async function buildProjectContext(
  projectPath: string,
  scan: ScanResult,
): Promise<ProjectContext> {
  const [
    packageJson,
    tsConfig,
    dockerCompose,
    envExample,
    existingClaudeMd,
  ] = await Promise.all([
    tryRead(join(projectPath, "package.json")),
    tryRead(join(projectPath, "tsconfig.json")),
    tryRead(join(projectPath, "docker-compose.yml"))
      .then((v) => v ?? tryRead(join(projectPath, "docker-compose.yaml"))),
    tryRead(join(projectPath, ".env.example"))
      .then((v) => v ?? tryRead(join(projectPath, ".env.sample"))),
    tryRead(join(projectPath, "CLAUDE.md")),
  ]);

  // Schema files — Prisma, GraphQL, SQL migrations
  const schemaFiles = await findAndRead(projectPath, [
    "**/*.prisma",
    "**/*.graphql",
    "**/*.gql",
    "**/schema.sql",
    "**/migrations/*.sql",
    "**/drizzle/**/*.ts",
  ], { limit: 3, maxChars: MAX_FILE_CHARS, label: "schema" });

  // Representative source files — prefer entry points, services, API routes
  const sampleSourceFiles = await findAndRead(projectPath, [
    "src/index.{ts,js}",
    "src/app.{ts,js}",
    "src/server.{ts,js}",
    "app/page.{tsx,jsx}",
    "app/layout.{tsx,jsx}",
    "src/app/page.{tsx,jsx}",
    "src/app/layout.{tsx,jsx}",
    "src/**/(route|handler|controller|service).{ts,js}",
    "src/**/*.(service|controller|handler).{ts,js}",
    "pages/api/**/*.{ts,js}",
    "app/api/**/*.{ts,js}",
    "src/**/*.{ts,tsx,js,jsx}",
  ], { limit: 5, maxChars: MAX_FILE_CHARS, label: "source" });

  // Test samples — show the team's testing patterns
  const testSamples = await findAndRead(projectPath, [
    "**/*.test.{ts,tsx,js}",
    "**/*.spec.{ts,tsx,js}",
  ], { limit: 2, maxChars: MAX_FILE_CHARS, label: "test" });

  // CI config — first GitHub Actions workflow found
  const ciFiles = await glob(".github/workflows/*.{yml,yaml}", {
    cwd: projectPath,
    ignore: ["node_modules/**"],
  });
  const ciConfig = ciFiles[0] ? await tryRead(join(projectPath, ciFiles[0])) : undefined;

  const folderStructure = await buildFolderTree(projectPath, 2);

  return {
    scan,
    packageJson,
    tsConfig,
    dockerCompose,
    envExample,
    sampleSourceFiles,
    schemaFiles,
    testSamples,
    ciConfig,
    existingClaudeMd,
    folderStructure,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function tryRead(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

async function findAndRead(
  projectPath: string,
  patterns: string[],
  opts: { limit: number; maxChars: number; label: string },
): Promise<string[]> {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const pattern of patterns) {
    if (results.length >= opts.limit) break;

    const matches = await glob(pattern, {
      cwd: projectPath,
      ignore: ["node_modules/**", "dist/**", ".git/**", "**/__generated__/**", "coverage/**"],
      absolute: false,
    });

    for (const rel of matches) {
      if (results.length >= opts.limit) break;
      if (seen.has(rel)) continue;
      seen.add(rel);

      try {
        const full = join(projectPath, rel);
        const s = await stat(full);
        if (s.size > 200_000) continue; // skip huge generated files

        let content = await readFile(full, "utf-8");
        if (content.length > opts.maxChars) {
          content = content.slice(0, opts.maxChars) + `\n// ... [truncated]`;
        }
        results.push(`### ${rel}\n\`\`\`\n${content}\n\`\`\``);
      } catch {
        // unreadable — skip
      }
    }
  }

  return results;
}

async function buildFolderTree(dir: string, depth: number): Promise<string> {
  const lines: string[] = [];
  await walk(dir, dir, depth, 0, lines);
  return lines.join("\n");
}

async function walk(
  root: string,
  dir: string,
  maxDepth: number,
  currentDepth: number,
  lines: string[],
): Promise<void> {
  if (currentDepth > maxDepth) return;

  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return;
  }

  const sorted = entries
    .filter((e) => !e.name.startsWith(".") || e.name === ".github")
    .filter((e) => !IGNORE_DIRS.has(e.name))
    .sort((a, b) => {
      // directories first, then files
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of sorted) {
    const indent = "  ".repeat(currentDepth);
    const rel = relative(root, join(dir, entry.name));
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      await walk(root, join(dir, entry.name), maxDepth, currentDepth + 1, lines);
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }
}
