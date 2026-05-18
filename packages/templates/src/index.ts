import type {
  ScanResult, GeneratedConfig, GeneratedFile, SkillFile, DetectedTech,
} from "@claude-kit/core";
import { enrichProject, type ProjectEnrichment } from "./enrich.js";

export async function generateConfig(scan: ScanResult): Promise<GeneratedConfig> {
  const enrichment = await enrichProject(scan);
  return {
    claudeMd: buildClaudeMd(scan, enrichment),
    settingsJson: buildSettings(scan, enrichment),
    settingsLocalJson: buildLocalSettings(),
    commands: buildCommands(scan, enrichment),
    rules: buildRules(scan),
    skills: buildSkills(scan),
  };
}

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

function buildClaudeMd(scan: ScanResult, enr: ProjectEnrichment): string {
  const pm = scan.packageManager !== "unknown" ? scan.packageManager : "npm";
  const t = scan.technologies;
  const f = stackFlags(t);
  const sections: string[] = [];

  // ── Overview ──────────────────────────────────────────────────────────────
  sections.push(`# ${scan.projectName}\n`);

  const stack = t.map((x) => x.name).join(", ") || "an unknown stack";
  const repoKind = scan.monorepo ? "a monorepo" : "a single-package project";

  const overviewLines: string[] = [];
  // Prefer the README summary if we found one — it's the most accurate description.
  if (enr.readmeSummary) {
    overviewLines.push(enr.readmeSummary);
  } else if (enr.packageDescription) {
    overviewLines.push(enr.packageDescription);
  }
  overviewLines.push(
    `${scan.projectName} is ${repoKind} built with ${stack}.` +
    (scan.hasTypeScript ? " The codebase is TypeScript with strict mode enabled." : "") +
    (scan.hasDocker ? " Docker is used for containerisation and local services." : "") +
    (scan.hasCi ? " CI/CD is configured — see the workflow files for pipeline details." : "")
  );
  overviewLines.push(
    `See \`.claude/rules/\` for per-concern conventions and \`.claude/skills/\` for repeatable workflows.`
  );
  sections.push(`## Overview\n${overviewLines.join("\n\n")}\n`);

  // ── Architecture ──────────────────────────────────────────────────────────
  // Use the actual top-level folders we found on disk, annotated with hints.
  const archLines: string[] = [];
  if (scan.monorepo) {
    archLines.push("- **Monorepo layout** — each sub-package owns a distinct responsibility (see workspace config)");
  }
  for (const folder of enr.topFolders) {
    archLines.push(`- \`${folder.name}/\` — ${folder.hint}`);
  }
  if (archLines.length > 0) {
    sections.push(`## Architecture\n${archLines.join("\n")}\n`);
  }

  // ── Commands ──────────────────────────────────────────────────────────────
  const cmds: string[] = [];
  cmds.push(`- **Install:** \`${pm} install\``);
  // Real scripts from package.json win — they reflect the project's actual workflow.
  const scriptEntries = Object.entries(enr.scripts);
  if (scriptEntries.length > 0) {
    for (const [name] of scriptEntries) {
      cmds.push(`- **${name}:** \`${pm} run ${name}\``);
    }
  } else {
    // No package.json scripts (non-Node project) — fall back to language defaults.
    if (f.hasNextJs || has(t, "React") || has(t, "Express") || has(t, "Fastify")) {
      cmds.push(`- **Dev:** \`${f.hasGo ? "go run ./cmd/..." : f.hasPython ? "uvicorn main:app --reload" : f.hasRust ? "cargo run" : f.hasJava ? "./mvnw spring-boot:run" : f.hasDotnet ? "dotnet run" : `${pm} run dev`}\``);
    }
    cmds.push(`- **Build:** \`${f.hasGo ? "go build ./..." : f.hasPython ? "python -m build" : f.hasRust ? "cargo build --release" : f.hasJava ? "./mvnw package -DskipTests" : f.hasDotnet ? "dotnet build" : `${pm} run build`}\``);
    cmds.push(`- **Test:** \`${has(t, "pytest") ? "pytest -v" : has(t, "RSpec") ? "bundle exec rspec" : f.hasGo ? "go test ./... -v" : f.hasRust ? "cargo test" : f.hasJava ? "./mvnw test" : f.hasDotnet ? "dotnet test" : `${pm} test`}\``);
  }
  if (scan.hasDocker) cmds.push(`- **Docker:** \`docker compose up -d\``);
  sections.push(`## Commands\n${cmds.join("\n")}\n`);

  // ── Coding Conventions ────────────────────────────────────────────────────
  const convLines: string[] = [];
  if (scan.hasTypeScript) {
    convLines.push("### TypeScript");
    convLines.push("- Strict mode on — no `any`, no `@ts-ignore` without a comment explaining why");
    convLines.push("- Use `type` for pure type aliases, `interface` for extendable object shapes");
    convLines.push("- Prefer `readonly` arrays and properties for data that must not be mutated");
    convLines.push("- Use discriminated unions over boolean flags for state representation");
  }
  if (has(t, "React") || f.hasNextJs) {
    convLines.push("### React");
    convLines.push("- Functional components only — no class components");
    convLines.push("- Co-locate component, its tests, and styles in one folder");
    convLines.push("- Extract custom hooks for any stateful logic reused across two or more components");
    convLines.push("- Avoid prop drilling beyond two levels — use Context or a state library instead");
  }
  if (f.hasNextJs) {
    convLines.push("### Next.js");
    convLines.push("- Server Components by default — add `'use client'` only when you need browser APIs or interactivity");
    convLines.push("- Use Server Actions for mutations — no separate API route needed for simple CRUD");
    convLines.push("- Route files: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`");
    convLines.push("- Co-locate route-specific components inside the route folder");
  }
  if (has(t, "Express") || has(t, "Fastify") || has(t, "Hono")) {
    convLines.push("### API");
    convLines.push("- Route handlers are thin — business logic belongs in service modules");
    convLines.push("- Validate every request body/params with a schema library (Zod, Joi) before processing");
    convLines.push("- Return appropriate HTTP status codes: 200, 201, 400, 401, 403, 404, 422, 500");
  }
  if (f.hasGo) {
    convLines.push("### Go");
    convLines.push("- Return errors explicitly — no panics in library code");
    convLines.push("- Use `context.Context` for cancellation and deadline propagation");
    convLines.push("- Keep package names short and lowercase; avoid `utils` or `common`");
  }
  if (f.hasPython) {
    convLines.push("### Python");
    convLines.push("- Use type hints on all function signatures");
    convLines.push("- Prefer `pathlib.Path` over `os.path`");
    convLines.push("- Use `dataclasses` or Pydantic models for structured data");
  }
  if (convLines.length > 0) {
    sections.push(`## Coding Conventions\n${convLines.join("\n")}\n`);
  }

  // ── Database Schema ───────────────────────────────────────────────────────
  if (t.some((x) => x.category === "orm" || x.category === "database")) {
    const dbLines: string[] = [];
    if (has(t, "Prisma")) {
      dbLines.push("- Schema lives in `prisma/schema.prisma` — every model and relation is defined there.");
      dbLines.push("- Generated client at `node_modules/@prisma/client` — re-run `prisma generate` after schema edits.");
    }
    if (has(t, "Drizzle")) {
      dbLines.push("- Schema lives in `src/db/schema.ts` (or similar) — TypeScript-first table definitions.");
      dbLines.push("- Run `db:generate` to regenerate migrations, `db:push` for dev sync.");
    }
    if (has(t, "TypeORM")) {
      dbLines.push("- Entity classes live under `src/entities/` (or your project's equivalent).");
      dbLines.push("- Migrations live under `src/migrations/` — generate with `typeorm migration:generate`.");
    }
    if (has(t, "Alembic")) {
      dbLines.push("- Migrations live under `alembic/versions/` — generate with `alembic revision --autogenerate`.");
    }
    if (has(t, "Sequelize")) {
      dbLines.push("- Models live under `models/` — auto-loaded by `models/index.js`.");
      dbLines.push("- Migrations under `migrations/` — run with `sequelize-cli db:migrate`.");
    }
    if (has(t, "Mongoose")) {
      dbLines.push("- Schemas live under `src/models/` — one Mongoose model per file.");
    }
    if (dbLines.length === 0) {
      dbLines.push("- Schema and migrations live in the project's database directory — see your ORM's config.");
    }
    // Real models found in the schema files — anchored to actual table/entity names.
    if (enr.dbModels.length > 0) {
      dbLines.push(`- Models defined in this project: ${enr.dbModels.map((m) => `\`${m}\``).join(", ")}.`);
    }
    dbLines.push("- Every migration must have an up AND a rollback path.");
    dbLines.push("- Never edit a migration that has already been applied to production.");
    sections.push(`## Database Schema\n${dbLines.join("\n")}\n`);
  }

  // ── Testing ───────────────────────────────────────────────────────────────
  const testLines: string[] = [];
  const runner = t.find((x) => x.category === "testing")?.name;
  if (runner) testLines.push(`- Test runner: **${runner}**`);
  testLines.push("- Tests live next to source: `foo.ts` → `foo.test.ts`");
  testLines.push("- Follow Arrange-Act-Assert (AAA) — one blank line between each section");
  testLines.push("- One logical assertion per test — split multiple concerns into separate tests");
  testLines.push("- Mock external services at the boundary — never mock your own modules");
  sections.push(`## Testing\n${testLines.join("\n")}\n`);

  // ── Environment Variables ─────────────────────────────────────────────────
  const envLines: string[] = [];
  if (enr.envVars.length > 0) {
    // Real variables from .env.example — anchored to what this project actually needs.
    for (const v of enr.envVars) {
      envLines.push(`- \`${v.name}\`${v.comment ? ` — ${v.comment}` : ""}`);
    }
  } else {
    // No .env.example — fall back to stack-based guesses so the section isn't empty.
    if (t.some((x) => x.category === "database" || x.category === "orm")) {
      envLines.push("- `DATABASE_URL` — connection string for the primary database");
    }
    if (has(t, "Redis")) {
      envLines.push("- `REDIS_URL` — Redis connection string");
    }
    if (t.some((x) => ["Express", "Fastify", "Hono", "NestJS", "Next.js"].includes(x.name))) {
      envLines.push("- `PORT` — HTTP server port (default: 3000)");
      envLines.push("- `NODE_ENV` — `development` | `test` | `production`");
    }
  }
  envLines.push("- Never commit `.env` — copy `.env.example` and fill in values locally");
  sections.push(`## Environment Variables\n${envLines.join("\n")}\n`);

  // ── Don'ts ────────────────────────────────────────────────────────────────
  sections.push(
    `## Don'ts\n` +
    `- Never commit \`.env\` files or credentials to git\n` +
    `- Never use \`any\` type without a comment explaining why\n` +
    `- Never push directly to \`main\` / \`master\`\n` +
    `- Never skip tests for "quick fixes"\n` +
    (scan.hasDocker ? `- Never run \`docker compose down -v\` without confirming data loss is acceptable\n` : "") +
    (t.some((x) => x.category === "database") ? `- Never interpolate user input directly into SQL — always use parameterised queries\n` : "") +
    `- Never disable TypeScript strict mode or eslint rules project-wide\n`
  );

  return sections.join("\n");
}

// ─── settings.json ────────────────────────────────────────────────────────────

function buildSettings(scan: ScanResult, enr: ProjectEnrichment): object {
  const pm = scan.packageManager;
  const allow: string[] = [
    "Read", "Edit", "Write",
    "Bash(git *)", "Bash(cat *)", "Bash(ls *)", "Bash(find *)", "Bash(grep *)",
  ];
  if (pm !== "unknown") { allow.push(`Bash(${pm} *)`, `Bash(${pm}x *)`); }
  // Allow each real script the project actually defines.
  for (const name of Object.keys(enr.scripts)) {
    if (pm !== "unknown") allow.push(`Bash(${pm} run ${name}*)`);
  }
  if (scan.technologies.some((t) => t.category === "testing"))  allow.push("Bash(*test*)", "Bash(*spec*)");
  if (scan.technologies.some((t) => t.category === "linter"))   allow.push("Bash(*lint*)", "Bash(*format*)");
  if (scan.technologies.some((t) => t.category === "orm"))      allow.push("Bash(*migrat*)");
  if (scan.hasDocker) allow.push("Bash(docker *)", "Bash(docker-compose *)");

  return {
    model: "claude-sonnet-4-6",
    permissions: { allow: Array.from(new Set(allow)), deny: [] },
    hooks: {},
    env: {},
  };
}

function buildLocalSettings(): object {
  return { permissions: { allow: [], deny: [] } };
}

// ─── commands/ ────────────────────────────────────────────────────────────────

function buildCommands(scan: ScanResult, enr: ProjectEnrichment): GeneratedFile[] {
  const pm = scan.packageManager !== "unknown" ? scan.packageManager : "npm";
  const t = scan.technologies;
  const commands: GeneratedFile[] = [];

  const flags = stackFlags(t);
  const scriptNames = new Set(Object.keys(enr.scripts));

  // Helper: if the real script exists, use `<pm> run <name>`; otherwise fall back.
  const cmd = (scriptName: string, fallback: string) =>
    scriptNames.has(scriptName) ? `${pm} run ${scriptName}` : fallback;

  if (scriptNames.has("dev") || scan.technologies.some((x) => x.category === "framework") || flags.hasNextJs)
    commands.push({ path: "dev.md", content: devCmdFor(cmd("dev", devFallback(pm, flags))) });

  commands.push({ path: "build.md", content: buildCmdFor(cmd("build", buildFallback(pm, flags))) });

  if (scriptNames.has("test") || scan.technologies.some((x) => x.category === "testing") || flags.hasGo || flags.hasRust || flags.hasJava || flags.hasDotnet || flags.hasPython)
    commands.push({ path: "test.md", content: testCmdFor(cmd("test", testFallback(pm, t, flags))) });

  if (scriptNames.has("lint") || scan.technologies.some((x) => x.category === "linter") || flags.hasPython || flags.hasGo || flags.hasRust)
    commands.push({ path: "lint.md", content: lintCmdFor(cmd("lint", lintFallback(pm, t, flags))) });

  if (scan.technologies.some((x) => x.category === "orm"))
    commands.push({ path: "migrate.md", content: migrateCmdFor(migrateScript(pm, t, scriptNames)) });

  // Any other real scripts the user defined (seed, format, typecheck, etc.) get their own command file.
  const knownScripts = new Set(["dev", "build", "test", "lint", "start"]);
  for (const name of scriptNames) {
    if (knownScripts.has(name)) continue;
    commands.push({
      path: `${slugify(name)}.md`,
      content: `Run the \`${name}\` script.\n\n\`\`\`bash\n${pm} run ${name}\n\`\`\`\n\nReport output and any errors.\n\n$ARGUMENTS`,
    });
  }

  commands.push({ path: "review.md",  content: reviewCmd() });
  commands.push({ path: "explain.md", content: explainCmd() });

  return commands;
}

function slugify(name: string): string {
  return name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

function migrateScript(pm: string, t: DetectedTech[], scripts: Set<string>): string {
  if (scripts.has("migrate")) return `${pm} run migrate`;
  if (scripts.has("db:migrate")) return `${pm} run db:migrate`;
  if (scripts.has("db:push")) return `${pm} run db:push`;
  if (has(t, "Prisma"))  return `${pm} exec prisma migrate dev`;
  if (has(t, "Drizzle")) return `${pm} run db:push`;
  if (has(t, "TypeORM")) return `${pm} run typeorm migration:run`;
  if (has(t, "Alembic")) return "alembic upgrade head";
  return `${pm} run migrate`;
}

// ─── rules/ ──────────────────────────────────────────────────────────────────

function buildRules(scan: ScanResult): GeneratedFile[] {
  const rules: GeneratedFile[] = [];
  const t = scan.technologies;

  rules.push({ path: "git.md", content: gitRules() });
  rules.push({ path: "security.md", content: securityRules(scan) });

  if (scan.hasTypeScript)
    rules.push({ path: "typescript.md", content: typescriptRules() });

  if (t.some((x) => x.category === "testing"))
    rules.push({ path: "testing.md", content: testingRules(t) });

  if (t.some((x) => x.category === "database" || x.category === "orm"))
    rules.push({ path: "database.md", content: databaseRules(t) });

  if (t.some((x) => x.name === "React" || x.name === "Next.js" || x.name === "Vue.js" || x.name === "Svelte"))
    rules.push({ path: "frontend.md", content: frontendRules(t) });

  if (t.some((x) => x.category === "api"))
    rules.push({ path: "api.md", content: apiRules(t) });

  return rules;
}

// ─── skills/ ─────────────────────────────────────────────────────────────────

function buildSkills(scan: ScanResult): SkillFile[] {
  const skills: SkillFile[] = [];
  const t = scan.technologies;
  const pm = scan.packageManager !== "unknown" ? scan.packageManager : "npm";

  skills.push(addFeatureSkill(scan, pm));
  skills.push(debugSkill(scan, pm));
  skills.push(writeTestsSkill(scan, pm, t));
  skills.push(refactorSkill(scan));

  if (t.some((x) => x.category === "orm" || x.category === "database"))
    skills.push(databaseSkill(scan, pm, t));

  return skills;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE FILE CONTENT
// ═══════════════════════════════════════════════════════════════════════════════

function gitRules(): string {
  return `# Git Workflow Rules

## Commits
- Write imperative commit messages: "Add feature" not "Added feature"
- Keep the subject line under 72 characters
- Reference issue numbers when relevant: "Fix login bug (#42)"
- Never commit secrets, credentials, or .env files

## Branches
- Feature branches: \`feat/short-description\`
- Bug fixes: \`fix/short-description\`
- Never push directly to main or master

## Pull Requests
- Keep PRs focused — one logical change per PR
- Include a description of what changed and why
- All tests must pass before merging
`;
}

function securityRules(scan: ScanResult): string {
  const t = scan.technologies;
  const extras: string[] = [];

  if (t.some((x) => x.name === "Next.js" || x.name === "Express" || x.name === "Fastify"))
    extras.push("- Validate and sanitize all request inputs with a schema library (Zod, Joi, etc.)");
  if (t.some((x) => x.category === "database" || x.category === "orm"))
    extras.push("- Never interpolate user input directly into SQL — always use parameterised queries or ORM methods");
  if (t.some((x) => x.name === "React" || x.name === "Next.js" || x.name === "Vue.js"))
    extras.push("- Never use dangerouslySetInnerHTML or v-html with unsanitised data");

  return `# Security Rules

## Always
- Never log passwords, tokens, or PII
- Never commit .env files or credentials to git
- Keep dependencies up to date — run \`npm audit\` / \`pnpm audit\` regularly
- Use HTTPS for all external requests
${extras.join("\n")}

## Authentication
- Validate session tokens on every protected route
- Use short-lived JWTs with refresh token rotation
- Implement rate limiting on auth endpoints

## Dependencies
- Prefer well-maintained packages with a small dependency tree
- Check for known vulnerabilities before adding a new package
`;
}

function typescriptRules(): string {
  return `# TypeScript Rules

## Types
- No \`any\` — use \`unknown\` and narrow it, or define a proper type
- No \`@ts-ignore\` or \`@ts-expect-error\` without an explanatory comment
- Export types alongside the functions/classes that use them
- Use \`type\` for pure type aliases, \`interface\` for object shapes that may be extended

## Strictness
- Strict mode is on — do not disable it
- \`noUncheckedIndexedAccess\` is on — always handle the \`| undefined\` case
- Use optional chaining (\`?.\`) and nullish coalescing (\`??\`) instead of truthy checks

## Patterns
- Prefer \`readonly\` arrays and properties for data that should not be mutated
- Use discriminated unions instead of boolean flags for state
- Avoid function overloads — use union parameter types instead
- Use \`satisfies\` to validate object literals without widening their type
`;
}

function testingRules(t: DetectedTech[]): string {
  const runner = t.find((x) => x.category === "testing")?.name ?? "your test runner";
  return `# Testing Rules

## Structure
- Tests live next to source: \`foo.ts\` → \`foo.test.ts\`
- Use Arrange-Act-Assert (AAA) — one blank line between each section
- One logical assertion per test — split multiple concerns into separate tests
- Test names read as sentences: \`"returns empty array when no items found"\`

## What to test
- Happy path for every public function
- Edge cases: empty inputs, nulls, boundary values
- Error paths: what happens when external services fail
- Do NOT test implementation details — test observable behaviour

## Mocking
- Mock external services (HTTP, DB, filesystem) at the boundary
- Do NOT mock your own modules — if you need to, the design needs to change
- Use \`${runner}\` factories/fixtures for test data, not hard-coded literals

## Coverage
- Aim for high coverage on business logic, not on framework glue code
- A failing test is more valuable than a skipped test
`;
}

function databaseRules(t: DetectedTech[]): string {
  const hasPg = t.some((x) => x.name.includes("PostgreSQL"));
  const hasRedis = t.some((x) => x.name === "Redis");

  return `# Database Rules

## Migrations
- Every migration must have an up AND a down (rollback) path
- Never edit a migration that has already been applied to production
- Migration filenames must be timestamped and descriptive

## Queries
- Always use parameterised queries — never interpolate user input into SQL
- Add indexes for every column used in a WHERE or JOIN clause on large tables
- Run EXPLAIN ANALYZE on queries that touch more than 10 000 rows
- Avoid N+1 queries — use eager loading or batch queries
${hasPg ? `
## PostgreSQL Specifics
- Enable Row Level Security (RLS) on tables that store user data
- Use JSONB only for truly schemaless data — prefer typed columns
- Wrap multi-step operations in explicit transactions
` : ""}${hasRedis ? `
## Redis Specifics
- Always set a TTL on cached values — never store without expiry
- Use cache-aside pattern: read cache first, fall back to DB, populate on miss
- Use Redis atomic operations (MULTI/EXEC) for counters and rate limiting
` : ""}`;
}

function frontendRules(t: DetectedTech[]): string {
  const hasReact   = t.some((x) => x.name === "React" || x.name === "Next.js");
  const hasNextJs  = t.some((x) => x.name === "Next.js");
  const hasTailwind = t.some((x) => x.name === "Tailwind CSS");

  return `# Frontend Rules

${hasReact ? `## React
- Functional components only — no class components
- Co-locate component, styles, and tests in one folder
- Extract hooks for any stateful logic reused across two or more components
- Avoid prop drilling beyond two levels — use context or a state library
` : ""}${hasNextJs ? `## Next.js (App Router)
- Server Components by default — add \`"use client"\` only when you need browser APIs or interactivity
- Use Server Actions for mutations — no separate API route needed for simple cases
- Layouts in \`layout.tsx\`, loading states in \`loading.tsx\`, errors in \`error.tsx\`
- Colocate route-specific components inside the route folder, shared components in \`components/\`
` : ""}${hasTailwind ? `## Tailwind CSS
- Utility classes in the JSX — no separate CSS files for component styles
- Extract repeated class combinations into a component, not a CSS class
- Use the \`cn()\` helper (clsx + tailwind-merge) to conditionally apply classes
` : ""}## General
- No inline styles except for truly dynamic values (e.g. calculated widths)
- Accessible by default: semantic HTML, aria labels on interactive elements, keyboard navigable
`;
}

function apiRules(t: DetectedTech[]): string {
  const hasGraphQL = t.some((x) => x.name === "GraphQL");
  const hasRest    = t.some((x) => ["Express", "Fastify", "Hono", "NestJS"].includes(x.name));

  return `# API Rules

${hasRest ? `## REST
- Use correct HTTP verbs: GET (read), POST (create), PUT/PATCH (update), DELETE (remove)
- Return appropriate status codes: 200, 201, 400, 401, 403, 404, 422, 500
- Validate the request body/params with a schema library before processing
- Never expose internal error details to clients — log internally, return generic messages
` : ""}${hasGraphQL ? `## GraphQL
- Keep resolvers thin — business logic belongs in service modules, not resolvers
- Use DataLoader for all relations to prevent N+1 queries
- Apply field-level permissions — never rely solely on query-level auth
- Paginate all list fields — never return unbounded arrays
` : ""}## General
- All endpoints require authentication unless explicitly designed to be public
- Rate-limit all public-facing endpoints
- Version your API if you have external consumers (\`/v1/...\`)
`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL FILE CONTENT
// ═══════════════════════════════════════════════════════════════════════════════

function addFeatureSkill(scan: ScanResult, pm: string): SkillFile {
  return {
    name: "add-feature",
    content: `---
name: add-feature
description: >
  Full workflow for adding a new feature to ${scan.projectName}.
  Covers planning, implementation, tests, and a self-review checklist.
  Activate when asked to "add", "implement", or "build" a new capability.
version: 0.1.0
---

# Add Feature Workflow

## 1. Understand the requirement
Before writing any code, restate the feature in your own words:
- What user problem does this solve?
- What is the exact input/output or UI behaviour?
- What are the edge cases and error states?

Ask for clarification if anything is ambiguous.

## 2. Locate the right files
Read the existing code in the area you will change:
- Find the relevant module/component/route
- Understand the data flow end-to-end before touching anything
- Identify shared types or interfaces you must update

## 3. Implement
- Write the implementation first, then the tests
- Follow the patterns already used in the surrounding code
- Keep functions small and single-purpose
- Do not refactor unrelated code in the same change

## 4. Write tests
\`\`\`bash
${pm} test
\`\`\`
- Cover the happy path, edge cases, and error states
- Tests live next to source: \`foo.ts\` → \`foo.test.ts\`

## 5. Self-review checklist
Before reporting done, verify:
- [ ] All tests pass
- [ ] No TypeScript errors (\`${pm} run build\`)
- [ ] No lint errors (\`${pm} run lint\`)
- [ ] No \`any\` types or \`TODO\` comments left behind
- [ ] No secrets or debug logs committed
- [ ] The feature works end-to-end as described

$ARGUMENTS
`,
  };
}

function debugSkill(scan: ScanResult, pm: string): SkillFile {
  return {
    name: "debug",
    content: `---
name: debug
description: >
  Systematic debugging workflow for ${scan.projectName}.
  Activate when asked to "debug", "fix", "why is X broken", or "investigate" an issue.
version: 0.1.0
---

# Debug Workflow

## 1. Reproduce the bug
Before changing anything:
- Confirm you can reproduce the issue with a minimal, reliable test case
- Note the exact error message, stack trace, or unexpected behaviour
- Identify the environment where it occurs (dev / staging / prod)

## 2. Gather evidence
\`\`\`bash
# Run the failing test in isolation
${pm} test -- --testNamePattern="<failing test name>"
\`\`\`
- Read the full stack trace — start from the TOP of your own code, not the framework internals
- Check recent git log for changes in the affected area:
  \`git log --oneline -20 -- <file>\`

## 3. Form a hypothesis
State a specific, falsifiable hypothesis:
> "I believe the bug is caused by X because Y"

Do not change code until you have a hypothesis.

## 4. Verify with the smallest possible change
- Add a targeted log or debugger breakpoint to confirm your hypothesis
- Do NOT refactor while debugging — only change what is needed to confirm or refute

## 5. Fix and verify
- Fix the root cause, not the symptom
- Run the full test suite after the fix:
\`\`\`bash
${pm} test
\`\`\`
- Add a regression test that would have caught this bug

## 6. Explain the fix
After fixing, write one paragraph explaining:
- What was the root cause?
- Why did the existing code allow it?
- How does the fix prevent it from recurring?

$ARGUMENTS
`,
  };
}

function writeTestsSkill(scan: ScanResult, pm: string, t: DetectedTech[]): SkillFile {
  const runner = t.find((x) => x.category === "testing")?.name ?? "the test runner";
  return {
    name: "write-tests",
    content: `---
name: write-tests
description: >
  Write comprehensive tests for a given file or function in ${scan.projectName}.
  Uses ${runner}. Activate when asked to "write tests", "add test coverage",
  or "test this function/component/module".
version: 0.1.0
---

# Write Tests Workflow

## 1. Read the code under test
Before writing a single test:
- Read the full implementation
- List every code path (if/else, try/catch, early returns)
- Identify external dependencies that must be mocked

## 2. Plan test cases
Write a comment block listing the cases you will cover:
\`\`\`
// Cases to test:
// ✓ happy path — valid input returns expected output
// ✓ empty input — returns []
// ✓ null/undefined — throws ArgumentError
// ✓ external service failure — returns fallback
\`\`\`

## 3. Write the tests
Follow the AAA pattern:
\`\`\`ts
it("returns empty array when no items found", async () => {
  // Arrange
  const repo = mockRepo({ items: [] });

  // Act
  const result = await getItems(repo);

  // Assert
  expect(result).toEqual([]);
});
\`\`\`

Rules:
- One assertion per test (or one logical group)
- Test observable behaviour, not internal implementation
- Mock external services at the boundary — not your own code

## 4. Run and verify
\`\`\`bash
${pm} test
\`\`\`
- All new tests must pass
- No existing tests may be broken
- Check coverage for the file under test

$ARGUMENTS
`,
  };
}

function refactorSkill(scan: ScanResult): SkillFile {
  return {
    name: "refactor",
    content: `---
name: refactor
description: >
  Safe, test-backed refactoring workflow for ${scan.projectName}.
  Activate when asked to "refactor", "clean up", "simplify", or "restructure" code.
version: 0.1.0
---

# Refactor Workflow

## Rules of refactoring
1. **Tests must be green before you start** — if tests are failing, fix them first
2. **Change behaviour OR structure, never both at once**
3. **Commit working checkpoints** — small commits, each passing tests

## 1. Verify the baseline
\`\`\`bash
# All tests must pass before touching anything
<test command>
\`\`\`
If tests fail: stop and fix them first.

## 2. Identify the problem
State what is wrong with the current code:
- Is it too long? Extract methods.
- Is it duplicated? Extract a shared abstraction.
- Is it hard to understand? Rename and restructure.
- Is it coupled to something it should not be? Invert the dependency.

Do NOT refactor speculatively. Only fix a concrete problem.

## 3. Make the change
- One logical change at a time
- Keep the same external behaviour — inputs and outputs must not change
- Rename variables and functions to be clearer as you go

## 4. Verify after every step
\`\`\`bash
<test command>
\`\`\`
If tests fail after your change: revert and try a smaller step.

## 5. Final check
- [ ] All tests still pass
- [ ] No new \`any\` types or lint errors
- [ ] The code is shorter or clearer than before (if not, revert)
- [ ] No behaviour change — confirmed by test output

$ARGUMENTS
`,
  };
}

function databaseSkill(scan: ScanResult, pm: string, t: DetectedTech[]): SkillFile {
  const hasPrisma   = t.some((x) => x.name === "Prisma");
  const hasDrizzle  = t.some((x) => x.name === "Drizzle");
  const hasAlembic  = t.some((x) => x.name === "Alembic");

  let migrateCmd = `${pm} run migrate`;
  if (hasPrisma)  migrateCmd = `${pm} exec prisma migrate dev --name <description>`;
  if (hasDrizzle) migrateCmd = `${pm} run db:generate && ${pm} run db:migrate`;
  if (hasAlembic) migrateCmd = `alembic revision --autogenerate -m "<description>" && alembic upgrade head`;

  return {
    name: "database-change",
    content: `---
name: database-change
description: >
  Safe workflow for making schema changes in ${scan.projectName}.
  Activate when asked to "add a column", "create a table", "change the schema",
  or "write a migration".
version: 0.1.0
---

# Database Change Workflow

## Before you start
- Never edit a migration that has already run in staging or production
- Every migration needs a rollback path
- Test the migration on a copy of production data if the table is large

## 1. Plan the schema change
State exactly what is changing:
- Table name(s) affected
- Columns added / removed / renamed / retyped
- Indexes added / removed
- Constraints added / removed

Consider: will existing data need to be backfilled?

## 2. Create the migration
\`\`\`bash
${migrateCmd}
\`\`\`

Review the generated migration file before running it.
Confirm it does exactly what you planned — no more, no less.

## 3. Write the down migration
If the tool does not auto-generate a rollback, write one manually.
The rollback must restore the schema to its exact prior state.

## 4. Update application code
- Update types / models / schema definitions to match the new schema
- Update any queries that read from or write to the affected columns
- Update tests that use the affected tables

## 5. Verify end-to-end
\`\`\`bash
# Run the migration
${migrateCmd}

# Run the full test suite
<test command>
\`\`\`
- All tests must pass after the migration
- Manually verify the affected feature works

$ARGUMENTS
`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND CONTENT (same as before, extracted for clarity)
// ═══════════════════════════════════════════════════════════════════════════════

interface StackFlags {
  hasNextJs: boolean; hasPython: boolean; hasGo: boolean;
  hasRust: boolean; hasJava: boolean; hasDotnet: boolean;
}

function stackFlags(t: DetectedTech[]): StackFlags {
  return {
    hasNextJs:  has(t, "Next.js"),
    hasPython:  has(t, "Python"),
    hasGo:      has(t, "Go"),
    hasRust:    has(t, "Rust"),
    hasJava:    has(t, "Java") || has(t, "Spring Boot"),
    hasDotnet:  has(t, "C#") || has(t, "F#"),
  };
}

function has(t: DetectedTech[], name: string): boolean {
  return t.some((x) => x.name === name);
}

function devFallback(pm: string, f: StackFlags): string {
  if (f.hasPython) return "uvicorn main:app --reload";
  if (f.hasGo)     return "go run ./cmd/...";
  if (f.hasRust)   return "cargo run";
  if (f.hasJava)   return "./mvnw spring-boot:run";
  if (f.hasDotnet) return "dotnet run";
  return `${pm} run dev`;
}

function buildFallback(pm: string, f: StackFlags): string {
  if (f.hasPython) return "python -m build";
  if (f.hasGo)     return "go build ./...";
  if (f.hasRust)   return "cargo build --release";
  if (f.hasJava)   return "./mvnw package -DskipTests";
  if (f.hasDotnet) return "dotnet build";
  return `${pm} run build`;
}

function testFallback(pm: string, t: DetectedTech[], f: StackFlags): string {
  if (has(t, "Vitest") || has(t, "Jest")) return `${pm} run test`;
  if (has(t, "pytest")) return "pytest -v";
  if (has(t, "RSpec"))  return "bundle exec rspec";
  if (f.hasGo)    return "go test ./... -v";
  if (f.hasRust)  return "cargo test";
  if (f.hasJava)  return "./mvnw test";
  if (f.hasDotnet)return "dotnet test";
  return `${pm} test`;
}

function lintFallback(pm: string, t: DetectedTech[], f: StackFlags): string {
  const cmds: string[] = [];
  if (has(t, "ESLint"))   cmds.push(`${pm} run lint`);
  if (has(t, "Prettier")) cmds.push(`${pm} run format`);
  if (has(t, "Biome"))    cmds.push(`${pm} exec biome check .`);
  if (f.hasPython)        cmds.push("ruff check . && ruff format .");
  if (f.hasGo)            cmds.push("go vet ./...");
  if (f.hasRust)          cmds.push("cargo clippy && cargo fmt --check");
  if (f.hasDotnet)        cmds.push("dotnet format");
  return cmds.length ? cmds.join("\n") : `${pm} run lint`;
}

function devCmdFor(cmd: string): string {
  return `Start the development server.\n\n\`\`\`bash\n${cmd}\n\`\`\`\n\nReport startup errors before proceeding.\n\n$ARGUMENTS`;
}
function buildCmdFor(cmd: string): string {
  return `Build the project and report errors.\n\n\`\`\`bash\n${cmd}\n\`\`\`\n\nReport all TypeScript/compiler errors and warnings.\n\n$ARGUMENTS`;
}
function testCmdFor(cmd: string): string {
  return `Run the full test suite.\n\n\`\`\`bash\n${cmd}\n\`\`\`\n\nReport: passed / failed / skipped counts and full output for any failures.\n\n$ARGUMENTS`;
}
function lintCmdFor(cmd: string): string {
  return `Run linter and fix all issues.\n\n\`\`\`bash\n${cmd}\n\`\`\`\n\nFix errors. For warnings: fix unless there is a clear reason not to. Never suppress rules.\n\n$ARGUMENTS`;
}
function migrateCmdFor(cmd: string): string {
  return `Run pending database migrations.\n\n\`\`\`bash\n${cmd}\n\`\`\`\n\nReport which migrations ran and any errors.\n\n$ARGUMENTS`;
}

function reviewCmd(): string {
  return `Review the current changes for correctness, security, and style.

Check for:
- Logic errors or missed edge cases
- Security issues (injection, auth bypass, data exposure)
- Missing error handling at system boundaries
- Type safety issues
- Test coverage gaps
- Violations of the patterns in CLAUDE.md and \`.claude/rules/\`

Provide: what looks good, what must be fixed, what is optional.

$ARGUMENTS`;
}

function explainCmd(): string {
  return `Explain the selected code or the file/module passed as an argument.

Cover:
1. What it does (purpose and responsibility)
2. How it works (key logic and data flow)
3. Why it is structured this way (design decisions, constraints)
4. What to watch out for (gotchas, side effects, performance)

$ARGUMENTS`;
}
