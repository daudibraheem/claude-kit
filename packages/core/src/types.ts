/**
 * Every technology we can detect.
 * Add new ones as you build more detectors.
 */
export type TechCategory =
  | "language"
  | "framework"
  | "database"
  | "cache"
  | "testing"
  | "ci"
  | "bundler"
  | "linter"
  | "orm"
  | "container"
  | "cloud"
  | "api"
  | "ui";

export interface DetectedTech {
  name: string; // e.g. "Next.js"
  category: TechCategory;
  version?: string; // e.g. "14.1.0"
  confidence: number; // 0-1, how sure we are
  detectedFrom: string; // which file told us this
  metadata?: Record<string, unknown>; // extra info
}

/**
 * Result from scanning an entire project
 */
export interface ScanResult {
  projectName: string;
  projectPath: string;
  technologies: DetectedTech[];
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  hasTypeScript: boolean;
  hasDocker: boolean;
  hasCi: boolean;
  monorepo: boolean;
  detectedAt: Date;
}

/**
 * What gets generated for the .claude/ folder
 */
export interface GeneratedConfig {
  claudeMd: string;              // CLAUDE.md at project root
  settingsJson: object;          // .claude/settings.json
  settingsLocalJson: object;     // .claude/settings.local.json (gitignored)
  commands: GeneratedFile[];     // .claude/commands/<path>       — custom slash commands
  rules: GeneratedFile[];        // .claude/rules/<path>          — tech-specific coding rules
  skills: SkillFile[];           // .claude/skills/<name>/SKILL.md — reusable agent workflows
}

export interface GeneratedFile {
  path: string;    // relative filename, e.g. "typescript.md"
  content: string;
}

export interface SkillFile {
  name: string;    // skill folder name, e.g. "add-feature"
  content: string; // full SKILL.md content including frontmatter
}

/**
 * Rich project context collected from actual source files,
 * sent to Claude for deep, project-specific config generation.
 */
export interface ProjectContext {
  scan: ScanResult;
  packageJson?: string;         // raw package.json content
  tsConfig?: string;            // raw tsconfig.json content
  dockerCompose?: string;       // raw docker-compose.yml content
  envExample?: string;          // .env.example content (safe — no real secrets)
  sampleSourceFiles: string[];  // up to 5 representative source files (path + content)
  schemaFiles: string[];        // prisma schema, GraphQL schema, SQL migrations
  testSamples: string[];        // up to 2 test files showing test patterns
  ciConfig?: string;            // first .github/workflows/*.yml found
  existingClaudeMd?: string;    // existing CLAUDE.md to improve upon
  folderStructure: string;      // 2-level directory tree (no node_modules)
}
