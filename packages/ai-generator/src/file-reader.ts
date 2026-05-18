import { readFile, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, extname, relative } from "node:path";
import type { ScanResult } from "@claude-kit/core";

export interface ProjectFile {
  path: string;   // relative to project root
  content: string;
}

/** Max total characters sent to the API (~80k ≈ ~20k tokens, well within Opus context) */
const MAX_TOTAL_CHARS = 80_000;
/** Max characters for a single file — skip the rest with a truncation note */
const MAX_FILE_CHARS  = 8_000;

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv",
  "target", "vendor", ".gradle", "bin", "obj",
]);

const IGNORE_EXTS = new Set([
  ".lock", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff",
  ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".zip", ".tar", ".gz",
  ".pdf", ".bin", ".exe", ".dll", ".so", ".dylib",
]);

/**
 * Priority order for file collection.
 * Files matched earlier get collected first; we stop once MAX_TOTAL_CHARS is reached.
 */
const PRIORITY_GLOBS: Array<{ label: string; match: (p: string) => boolean }> = [
  // 1. Always-informative root files
  { label: "readme",    match: (p) => /^README(\.\w+)?$/i.test(p) },
  { label: "env-example", match: (p) => p === ".env.example" || p === ".env.sample" },
  { label: "pkg-json",  match: (p) => p === "package.json" },
  { label: "pyproject", match: (p) => p === "pyproject.toml" },
  { label: "go-mod",    match: (p) => p === "go.mod" },
  { label: "cargo",     match: (p) => p === "Cargo.toml" },
  { label: "gemfile",   match: (p) => p === "Gemfile" },
  { label: "pom",       match: (p) => p === "pom.xml" },

  // 2. Schema / data model files  ← gold mine for Claude
  { label: "prisma",    match: (p) => p.endsWith(".prisma") },
  { label: "graphql",   match: (p) => p.endsWith(".graphql") || p.endsWith(".gql") },
  { label: "sql-schema",match: (p) => /schema.*\.sql$/i.test(p) || /migrations?\/.*\.sql$/i.test(p) },
  { label: "drizzle",   match: (p) => /drizzle\.config/.test(p) || /schema\.(ts|js)$/.test(p) },

  // 3. Entry points
  { label: "entry",     match: (p) =>
      /^(src\/)?(index|main|app|server|cmd\/main)\.(ts|js|go|rs|py|rb)$/.test(p) ||
      /^app\/(page|layout|route)\.(tsx?|jsx?)$/.test(p)
  },

  // 4. App router / pages  (Next.js, Remix, etc.)
  { label: "app-shell", match: (p) =>
      /^(app|pages)\/(layout|_app|_document|page)\.(tsx?|jsx?)$/.test(p) ||
      /^src\/(app|pages)\/(layout|_app|page)\.(tsx?|jsx?)$/.test(p)
  },

  // 5. API routes / handlers  ← shows real endpoint patterns
  { label: "api-route", match: (p) =>
      /\/(api|routes?|handlers?|controllers?)\//.test(p) &&
      /\.(ts|js|go|py|rb)$/.test(p)
  },

  // 6. Core business logic / services
  { label: "service",   match: (p) =>
      /\/(services?|usecases?|domain|lib)\//.test(p) &&
      /\.(ts|js|go|py|rb)$/.test(p)
  },

  // 7. Types / interfaces
  { label: "types",     match: (p) =>
      /(types?|interfaces?|models?)(\.\w+)?$/.test(p.replace(/\.[^.]+$/, "")) &&
      /\.(ts|go|py)$/.test(p)
  },

  // 8. Config files
  { label: "config",    match: (p) =>
      /\.(config|rc)\.(ts|js|cjs|mjs|json)$/.test(p) &&
      !p.includes("node_modules")
  },

  // 9. CI workflows  ← shows real automation
  { label: "ci",        match: (p) => p.startsWith(".github/workflows/") },

  // 10. Any remaining source files as filler
  { label: "source",    match: (p) => /\.(ts|tsx|js|jsx|go|py|rb|rs|java|cs|fs)$/.test(p) },
];

export async function collectProjectFiles(scan: ScanResult): Promise<ProjectFile[]> {
  const root = scan.projectPath;

  // Walk the whole tree once, collecting relative paths
  const allPaths = await walk(root, root);

  // Sort paths into priority buckets
  const buckets: Map<string, string[]> = new Map(PRIORITY_GLOBS.map((g) => [g.label, []]));

  for (const p of allPaths) {
    for (const { label, match } of PRIORITY_GLOBS) {
      if (match(p)) {
        buckets.get(label)!.push(p);
        break; // first match wins
      }
    }
  }

  // Read files in priority order, stopping when budget is exhausted
  const collected: ProjectFile[] = [];
  let totalChars = 0;

  for (const { label } of PRIORITY_GLOBS) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    const paths = buckets.get(label) ?? [];

    // Limit number of files per bucket to avoid flooding with e.g. 200 API routes
    const limit = label === "source" ? 6 : label === "api-route" ? 8 : label === "service" ? 6 : 20;

    for (const relPath of paths.slice(0, limit)) {
      if (totalChars >= MAX_TOTAL_CHARS) break;
      try {
        const raw = await readFile(join(root, relPath), "utf-8");
        const content = raw.length > MAX_FILE_CHARS
          ? raw.slice(0, MAX_FILE_CHARS) + `\n\n... [truncated — ${raw.length - MAX_FILE_CHARS} more chars]`
          : raw;
        collected.push({ path: relPath, content });
        totalChars += content.length;
      } catch {
        // binary or unreadable — skip
      }
    }
  }

  return collected;
}

async function walk(root: string, dir: string): Promise<string[]> {
  const paths: string[] = [];
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return paths;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".github") continue;
    if (IGNORE_DIRS.has(entry.name)) continue;

    const full = join(dir, entry.name);
    const rel  = relative(root, full);

    if (entry.isDirectory()) {
      paths.push(...await walk(root, full));
    } else if (entry.isFile()) {
      if (IGNORE_EXTS.has(extname(entry.name))) continue;
      try {
        const s = await stat(full);
        if (s.size > 500_000) continue; // skip huge files outright
      } catch { continue; }
      paths.push(rel);
    }
  }

  return paths;
}
