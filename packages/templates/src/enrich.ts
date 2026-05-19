import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ScanResult } from "@claude-scout/core";

export interface ProjectEnrichment {
  /** First non-heading paragraph from README, if any */
  readmeSummary?: string;
  /** Actual scripts from package.json, in declared order */
  scripts: Record<string, string>;
  /** Project description from package.json */
  packageDescription?: string;
  /** Real environment variables from .env.example (with optional inline comment) */
  envVars: Array<{ name: string; comment?: string }>;
  /** Real model/table names found in schema files */
  dbModels: string[];
  /** Top-level directories and a hint at what each contains */
  topFolders: Array<{ name: string; hint: string }>;
  /** Whether a CLAUDE.md already exists at the root (we won't overwrite content suggestions) */
  hasExistingClaudeMd: boolean;
  /** A migrations/ or db/migrations/ directory exists — DB has migrations even if no ORM was detected */
  hasMigrations: boolean;
  /** A .nvmrc file exists — surface `nvm use` in onboarding */
  hasNvmrc: boolean;
}

const FOLDER_HINTS: Record<string, string> = {
  src: "main source code",
  app: "application code (Next.js / Nuxt App Router)",
  pages: "page-based routes",
  components: "shared UI components",
  lib: "shared utilities and helpers",
  utils: "shared utilities",
  hooks: "custom React hooks",
  styles: "global styles and themes",
  public: "static assets served as-is",
  api: "API route handlers",
  routes: "HTTP route handlers",
  controllers: "request controllers",
  services: "business-logic services",
  models: "data models / entities",
  entities: "ORM entities",
  schemas: "schema definitions",
  prisma: "Prisma schema and migrations",
  migrations: "database migration files",
  db: "database client and schema",
  middleware: "HTTP middleware",
  middlewares: "HTTP middleware",
  tests: "test suite",
  __tests__: "test files",
  test: "test files",
  spec: "test specs",
  e2e: "end-to-end tests",
  scripts: "build / deploy / utility scripts",
  config: "configuration files",
  configs: "configuration files",
  docs: "documentation",
  examples: "example projects",
  packages: "monorepo packages",
  apps: "monorepo applications",
  cmd: "Go application entry points",
  internal: "Go private packages",
  pkg: "Go public packages",
  cli: "CLI entry point",
  server: "server-side code",
  client: "client-side code",
  shared: "code shared between client and server",
  types: "shared TypeScript types",
  store: "state management",
  stores: "state management",
  features: "feature-sliced modules",
  modules: "feature modules",
  domain: "domain layer",
  infrastructure: "infrastructure layer",
  core: "core domain logic",
  ".github": "GitHub Actions workflows and templates",
};

export async function enrichProject(scan: ScanResult): Promise<ProjectEnrichment> {
  const root = scan.projectPath;
  const [
    readmeSummary, pkg, envVars, dbModels, topFolders,
    hasExistingClaudeMd, hasMigrations, hasNvmrc,
  ] = await Promise.all([
    readReadmeSummary(root),
    readPackageJson(root),
    readEnvExample(root),
    findSchemaModels(root, scan),
    listTopFolders(root),
    fileExists(join(root, "CLAUDE.md")),
    detectMigrationsDir(root),
    fileExists(join(root, ".nvmrc")),
  ]);

  return {
    readmeSummary,
    scripts: pkg?.scripts ?? {},
    packageDescription: pkg?.description,
    envVars,
    dbModels,
    topFolders,
    hasExistingClaudeMd,
    hasMigrations,
    hasNvmrc,
  };
}

async function detectMigrationsDir(root: string): Promise<boolean> {
  const candidates = ["migrations", "migration", "db/migrations", "src/migrations", "alembic/versions"];
  for (const path of candidates) {
    try {
      const s = await stat(join(root, path));
      if (s.isDirectory()) return true;
    } catch { /* not present */ }
  }
  return false;
}

// ─── README ───────────────────────────────────────────────────────────────────

async function readReadmeSummary(root: string): Promise<string | undefined> {
  const candidates = ["README.md", "README", "Readme.md", "readme.md"];
  for (const name of candidates) {
    const raw = await tryRead(join(root, name));
    if (!raw) continue;

    // Skip badges, heading, blank lines — find the first real content block
    const lines = raw.split(/\r?\n/);
    const block: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (block.length > 0) break;
        continue;
      }
      if (trimmed.startsWith("#")) continue;          // headings
      if (trimmed.startsWith("![")) continue;         // images / badges
      if (trimmed.startsWith("[![")) continue;        // badge with link
      if (/^[-_=*]{3,}$/.test(trimmed)) continue;     // hrules
      if (trimmed.startsWith("```")) continue;        // code fences
      block.push(trimmed);
      if (block.join(" ").length > 500) break;
    }

    if (block.length === 0) continue;

    // If the block is a bullet list (every line starts with -, *, or a digit.),
    // keep it as a list so it stays readable in onboarding/CLAUDE.md.
    // Otherwise collapse into a single paragraph (legacy behavior).
    const isBulletList = block.every((l) => /^([-*]\s+|\d+\.\s+)/.test(l));
    if (isBulletList) {
      const normalized = block.map((l) => l.replace(/^\d+\.\s+/, "- ").replace(/^\*\s+/, "- "));
      return normalized.join("\n");
    }

    let summary = block.join(" ").replace(/\s+/g, " ").trim();
    if (summary.length > 350) summary = summary.slice(0, 347).trimEnd() + "…";
    return summary;
  }
  return undefined;
}

// ─── package.json ─────────────────────────────────────────────────────────────

async function readPackageJson(root: string): Promise<{ scripts?: Record<string, string>; description?: string } | undefined> {
  const raw = await tryRead(join(root, "package.json"));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string>; description?: string };
    return { scripts: parsed.scripts, description: parsed.description };
  } catch {
    return undefined;
  }
}

// ─── .env.example ─────────────────────────────────────────────────────────────

async function readEnvExample(root: string): Promise<Array<{ name: string; comment?: string }>> {
  const candidates = [".env.example", ".env.sample", ".env.template"];
  for (const name of candidates) {
    const raw = await tryRead(join(root, name));
    if (!raw) continue;
    return parseEnvFile(raw);
  }
  return [];
}

function parseEnvFile(raw: string): Array<{ name: string; comment?: string }> {
  const vars: Array<{ name: string; comment?: string }> = [];
  let pendingComment: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { pendingComment = undefined; continue; }

    if (trimmed.startsWith("#")) {
      const text = trimmed.replace(/^#+\s*/, "").trim();
      if (text) pendingComment = text;
      continue;
    }

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
    if (match) {
      const inline = trimmed.split("#").slice(1).join("#").trim();
      vars.push({
        name: match[1]!,
        comment: inline || pendingComment,
      });
      pendingComment = undefined;
    }
  }
  return vars;
}

// ─── Schema models ────────────────────────────────────────────────────────────

async function findSchemaModels(root: string, scan: ScanResult): Promise<string[]> {
  const found = new Set<string>();

  // Prisma
  const prisma = await tryRead(join(root, "prisma", "schema.prisma"))
    ?? await tryRead(join(root, "schema.prisma"));
  if (prisma) {
    for (const m of prisma.matchAll(/^\s*model\s+(\w+)\s*\{/gm)) found.add(m[1]!);
  }

  // Drizzle / TypeORM / Sequelize TypeScript schemas
  if (scan.technologies.some((t) => ["Drizzle", "TypeORM", "Sequelize"].includes(t.name))) {
    const candidates = [
      "src/db/schema.ts", "src/schema.ts", "db/schema.ts",
      "src/entities", "src/models", "models",
    ];
    for (const path of candidates) {
      const full = join(root, path);
      try {
        const s = await stat(full);
        if (s.isFile()) {
          const raw = await readFile(full, "utf-8");
          extractTsModels(raw).forEach((m) => found.add(m));
        } else if (s.isDirectory()) {
          const entries = await readdir(full);
          for (const e of entries.slice(0, 15)) {
            if (!/\.(ts|js)$/.test(e)) continue;
            const raw = await tryRead(join(full, e));
            if (raw) extractTsModels(raw).forEach((m) => found.add(m));
          }
        }
      } catch { /* ignore */ }
    }
  }

  return Array.from(found).slice(0, 20);
}

function extractTsModels(src: string): string[] {
  const models = new Set<string>();
  // Drizzle: export const users = pgTable("users", ...)
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=\s*\w*[Tt]able\(/g)) models.add(m[1]!);
  // TypeORM: @Entity() ... class Foo
  for (const m of src.matchAll(/@Entity\([^)]*\)[\s\S]*?class\s+(\w+)/g)) models.add(m[1]!);
  // Mongoose / Sequelize: export class Foo extends Model
  for (const m of src.matchAll(/export\s+class\s+(\w+)\s+extends\s+\w*Model/g)) models.add(m[1]!);
  // Mongoose model factory: mongoose.model("Foo", ...)
  for (const m of src.matchAll(/mongoose\.model\(\s*["'](\w+)["']/g)) models.add(m[1]!);
  return Array.from(models);
}

// ─── Top-level folders ────────────────────────────────────────────────────────

const SKIP_FOLDERS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv",
  "target", "vendor", ".gradle", "bin", "obj", ".idea", ".vscode",
]);

async function listTopFolders(root: string): Promise<Array<{ name: string; hint: string }>> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const folders: Array<{ name: string; hint: string }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP_FOLDERS.has(e.name)) continue;
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    folders.push({
      name: e.name,
      hint: FOLDER_HINTS[e.name] ?? "project-specific code",
    });
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function tryRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return undefined;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}
