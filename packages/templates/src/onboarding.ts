import type { ScanResult, DetectedTech } from "@claude-scout/core";
import { enrichProject, type ProjectEnrichment } from "./enrich.js";

export interface GeneratedOnboarding {
  /** Full ONBOARDING.md content */
  markdown: string;
  /** Full setup.sh content (POSIX, executable) */
  script: string;
}

export async function generateOnboarding(scan: ScanResult): Promise<GeneratedOnboarding> {
  const enrichment = await enrichProject(scan);
  return {
    markdown: buildOnboardingMd(scan, enrichment),
    script: buildSetupScript(scan, enrichment),
  };
}

// ─── ONBOARDING.md ────────────────────────────────────────────────────────────

function buildOnboardingMd(scan: ScanResult, enr: ProjectEnrichment): string {
  // Track whether we actually detected a JS package manager. `pm` falls back
  // to "npm" for command examples, but `hasJsPm` gates JS-specific advice.
  const hasJsPm = scan.packageManager !== "unknown";
  const pm = hasJsPm ? scan.packageManager : "npm";
  const t = scan.technologies;
  const f = stackFlags(t);
  const sections: string[] = [];

  // Numbered headings are assigned in order so that adding/removing optional
  // sections (Docker, Database) doesn't leave a gap in the numbering.
  let stepNum = 0;
  const step = () => ++stepNum;

  // ── Header ────────────────────────────────────────────────────────────────
  sections.push(`# Onboarding — ${scan.projectName}\n`);

  const intro: string[] = [];
  if (enr.readmeSummary) intro.push(enr.readmeSummary);
  else if (enr.packageDescription) intro.push(enr.packageDescription);
  intro.push(
    `This guide walks a new developer from a fresh machine to a working ${scan.projectName} environment. ` +
    `Each step lists the exact command to run. If you prefer one-shot automation, run \`./setup.sh\` from the project root after cloning.`
  );
  sections.push(intro.join("\n\n") + "\n");

  // ── Prerequisites ─────────────────────────────────────────────────────────
  const prereqs: string[] = [];
  prereqs.push("Install these before you start:\n");

  if (scan.hasTypeScript || hasJsPm || f.hasNextJs || has(t, "React") || has(t, "Node.js")) {
    prereqs.push(`- **Node.js** 20+ — \`node --version\``);
    prereqs.push(`- **${pm}** — \`${pm} --version\`` + pmInstallHint(pm));
  }
  if (f.hasPython)  prereqs.push("- **Python** 3.10+ — `python3 --version`");
  if (f.hasGo)      prereqs.push("- **Go** 1.21+ — `go version`");
  if (f.hasRust)    prereqs.push("- **Rust** (stable) — `rustc --version` · install: https://rustup.rs");
  if (f.hasJava)    prereqs.push("- **JDK** 17+ — `java -version`");
  if (f.hasDotnet)  prereqs.push("- **.NET SDK** 8+ — `dotnet --version`");
  if (has(t, "Ruby")) prereqs.push("- **Ruby** 3.1+ — `ruby --version`");
  if (scan.hasDocker) prereqs.push("- **Docker** + **Docker Compose** — `docker --version && docker compose version`");

  // Database server — only when the project needs one but Docker won't provide it.
  const dbServer = pickDatabaseServer(t);
  if (dbServer && !scan.hasDocker) {
    prereqs.push(`- **${dbServer.label}** running locally — \`${dbServer.check}\`${dbServer.installHint}`);
  }

  // .nvmrc → suggest nvm
  if (enr.hasNvmrc) {
    prereqs.push("- **nvm** — `nvm --version` · install: https://github.com/nvm-sh/nvm  _(this project pins a Node version via `.nvmrc` — run `nvm use` after cloning)_");
  }

  prereqs.push("- **Git** — `git --version`");

  sections.push(`## ${step()}. Prerequisites\n\n${prereqs.join("\n")}\n`);

  // ── Clone ─────────────────────────────────────────────────────────────────
  sections.push(
`## ${step()}. Clone the repository

\`\`\`bash
git clone <repository-url> ${scan.projectName}
cd ${scan.projectName}
\`\`\`
`);

  // ── Install dependencies ──────────────────────────────────────────────────
  const installCmds: string[] = [];
  if (enr.hasNvmrc) installCmds.push("nvm use");
  if (hasJsPm) installCmds.push(`${pm} install`);
  if (f.hasPython) {
    installCmds.push("python3 -m venv .venv");
    installCmds.push("source .venv/bin/activate");
    installCmds.push(has(t, "Poetry") ? "poetry install" : "pip install -r requirements.txt");
  }
  if (f.hasGo)     installCmds.push("go mod download");
  if (f.hasRust)   installCmds.push("cargo fetch");
  if (f.hasJava)   installCmds.push(has(t, "Gradle") ? "./gradlew build -x test" : "./mvnw install -DskipTests");
  if (f.hasDotnet) installCmds.push("dotnet restore");
  if (has(t, "Ruby")) installCmds.push("bundle install");

  if (installCmds.length === 0) installCmds.push("# (no recognised package manager — check the project README)");

  sections.push(
`## ${step()}. Install dependencies

\`\`\`bash
${installCmds.join("\n")}
\`\`\`
`);

  // ── Environment variables ─────────────────────────────────────────────────
  const envLines: string[] = [];
  envLines.push("Copy the example file and fill in real values:\n");
  envLines.push("```bash");
  envLines.push("cp .env.example .env");
  envLines.push("```");
  envLines.push("");

  if (enr.envVars.length > 0) {
    envLines.push("Variables you'll need to set:\n");
    envLines.push("| Variable | Notes |");
    envLines.push("|---|---|");
    for (const v of enr.envVars) {
      envLines.push(`| \`${v.name}\` | ${v.comment ?? "—"} |`);
    }
  } else {
    envLines.push("_No `.env.example` was detected. If this project needs env vars, ask a teammate for the list._");
  }
  envLines.push("");
  envLines.push("> Never commit `.env`. Anything in `.env.example` is shared; anything in `.env` is yours.");
  sections.push(`## ${step()}. Environment variables\n\n${envLines.join("\n")}\n`);

  // ── Services (Docker) ─────────────────────────────────────────────────────
  if (scan.hasDocker) {
    sections.push(
`## ${step()}. Start local services

This project uses Docker Compose for databases, caches, and other services.

\`\`\`bash
docker compose up -d
docker compose ps          # confirm everything is healthy
\`\`\`

When you're done for the day:

\`\`\`bash
docker compose stop        # keeps your data
docker compose down        # tears down containers (data persists in volumes)
\`\`\`
`);
  }

  // ── Database setup ────────────────────────────────────────────────────────
  // Fire this section when an ORM is detected OR when a migrations/ folder is
  // present — many projects (e.g. Graphile Migrate, raw SQL) use migrations
  // without a recognised ORM dependency.
  const hasOrm = t.some((x) => x.category === "orm");
  if (hasOrm || enr.hasMigrations) {
    const migrate = migrateCommand(pm, t, enr);
    const dbLines: string[] = [];
    dbLines.push("Run pending migrations to set up the schema:\n");
    dbLines.push("```bash");
    dbLines.push(migrate);
    dbLines.push("```");
    if (!hasOrm) {
      dbLines.push("");
      dbLines.push("_No ORM was detected — the command above is a best guess based on `package.json` scripts and the `migrations/` folder. Check the project README if it fails._");
    }
    if (enr.scripts["seed"] || enr.scripts["db:seed"]) {
      const seedScript = enr.scripts["seed"] ? "seed" : "db:seed";
      dbLines.push("");
      dbLines.push("Seed development data:\n");
      dbLines.push("```bash");
      dbLines.push(`${pm} run ${seedScript}`);
      dbLines.push("```");
    }
    if (enr.dbModels.length > 0) {
      dbLines.push("");
      dbLines.push(`Models defined in this project: ${enr.dbModels.map((m) => `\`${m}\``).join(", ")}.`);
    }
    sections.push(`## ${step()}. Database setup\n\n${dbLines.join("\n")}\n`);
  }

  // ── Run / Test / Build ────────────────────────────────────────────────────
  const runLines: string[] = [];
  const scripts = enr.scripts;
  const scriptNames = new Set(Object.keys(scripts));

  const devCmd =
    scriptNames.has("dev")   ? `${pm} run dev`   :
    scriptNames.has("start") ? `${pm} run start` :
    devFallback(pm, f);

  const testCmd =
    scriptNames.has("test") ? `${pm} test` :
    testFallback(pm, t, f);

  const buildCmd =
    scriptNames.has("build") ? `${pm} run build` :
    buildFallback(pm, f);

  runLines.push("Start the development server:\n");
  runLines.push("```bash");
  runLines.push(devCmd);
  runLines.push("```");
  runLines.push("");
  runLines.push("Run the test suite:\n");
  runLines.push("```bash");
  runLines.push(testCmd);
  runLines.push("```");
  runLines.push("");
  runLines.push("Build for production:\n");
  runLines.push("```bash");
  runLines.push(buildCmd);
  runLines.push("```");

  const otherKeys = ["lint", "format", "typecheck", "check", "ci"].filter((k) => scriptNames.has(k));
  if (otherKeys.length > 0) {
    runLines.push("");
    runLines.push("Other useful scripts:\n");
    for (const k of otherKeys) runLines.push(`- \`${pm} run ${k}\``);
  }

  sections.push(`## ${step()}. Run the project\n\n${runLines.join("\n")}\n`);

  // ── Project structure ─────────────────────────────────────────────────────
  const archLines: string[] = [];
  if (scan.monorepo) {
    archLines.push("This is a **monorepo** — each package under the workspaces directory owns a distinct responsibility.\n");
  }
  if (enr.topFolders.length > 0) {
    archLines.push("Top-level layout:\n");
    archLines.push("```");
    for (const folder of enr.topFolders) archLines.push(`${folder.name}/    ${folder.hint}`);
    archLines.push("```");
  } else {
    archLines.push("_Run `ls` from the project root to see the top-level layout._");
  }
  sections.push(`## ${step()}. Project structure\n\n${archLines.join("\n")}\n`);

  // ── Where to look next ────────────────────────────────────────────────────
  const nextSteps: string[] = [];
  if (enr.hasExistingClaudeMd) {
    nextSteps.push("- **`CLAUDE.md`** — full project context for AI-assisted development. Worth reading even if you don't use Claude Code, since it summarises architecture and conventions.");
    nextSteps.push("- **`.claude/rules/`** — coding conventions, broken down by concern (TypeScript, testing, database, security, etc.).");
    nextSteps.push("- **`.claude/skills/`** — reusable workflows for common tasks (add-feature, debug, write-tests, refactor).");
  }
  nextSteps.push("- **`README.md`** — project overview and links to deeper docs.");
  if (scan.hasCi) nextSteps.push("- **`.github/workflows/`** — CI pipelines. Read these to understand what runs on every PR.");
  nextSteps.push("- Pair with a teammate on your first task — fastest way to learn the codebase's unwritten conventions.");

  sections.push(`## ${step()}. Where to look next\n\n${nextSteps.join("\n")}\n`);

  // ── Troubleshooting ───────────────────────────────────────────────────────
  const tsLines: string[] = [];
  tsLines.push("**`" + pm + " install` fails**\n");
  tsLines.push(`- Check your Node version matches \`engines.node\` in \`package.json\`.`);
  tsLines.push(`- Delete \`node_modules\` and the lockfile, then reinstall: \`rm -rf node_modules && ${pm} install\`.`);
  if (scan.hasDocker) {
    tsLines.push("");
    tsLines.push("**Docker services won't start**\n");
    tsLines.push("- Run `docker compose logs` to see what failed.");
    tsLines.push("- Check ports aren't already in use: `lsof -i :5432` (Postgres), `lsof -i :6379` (Redis), etc.");
  }
  if (t.some((x) => x.category === "orm")) {
    tsLines.push("");
    tsLines.push("**Migration errors**\n");
    tsLines.push("- Make sure your database is running and `DATABASE_URL` is correct.");
    tsLines.push("- For a fresh start in dev, drop the local DB and re-run migrations from scratch.");
  }
  tsLines.push("");
  tsLines.push("**Still stuck?** Ask in your team's channel and link to the exact error message.");

  sections.push(`## ${step()}. Troubleshooting\n\n${tsLines.join("\n")}\n`);

  sections.push("---");
  sections.push("\n_Generated by [claude-scout](https://github.com/daudibraheem/claude-scout). Re-run `claude-scout onboard` to refresh._\n");

  return sections.join("\n");
}

// ─── setup.sh ────────────────────────────────────────────────────────────────

function buildSetupScript(scan: ScanResult, enr: ProjectEnrichment): string {
  const hasJsPm = scan.packageManager !== "unknown";
  const pm = hasJsPm ? scan.packageManager : "npm";
  const t = scan.technologies;
  const f = stackFlags(t);
  const lines: string[] = [];

  lines.push("#!/usr/bin/env bash");
  lines.push("# Auto-generated by claude-scout — `claude-scout onboard`");
  lines.push(`# One-shot setup for ${scan.projectName}.`);
  lines.push("# Re-runnable: each step is idempotent or guarded.");
  lines.push("");
  lines.push("set -euo pipefail");
  lines.push("");
  lines.push('GREEN="\\033[0;32m"; YELLOW="\\033[0;33m"; RED="\\033[0;31m"; BOLD="\\033[1m"; RESET="\\033[0m"');
  lines.push('step()  { printf "\\n${BOLD}${GREEN}==>${RESET}${BOLD} %s${RESET}\\n" "$1"; }');
  lines.push('warn()  { printf "${YELLOW}⚠  %s${RESET}\\n" "$1"; }');
  lines.push('die()   { printf "${RED}✖  %s${RESET}\\n" "$1" >&2; exit 1; }');
  lines.push('have()  { command -v "$1" >/dev/null 2>&1; }');
  lines.push("");

  // ── Prereq checks ─────────────────────────────────────────────────────────
  lines.push('step "Checking prerequisites"');
  if (hasJsPm || f.hasNextJs || scan.hasTypeScript) {
    lines.push('have node || die "Node.js not found. Install Node 20+: https://nodejs.org"');
    lines.push(`have ${pm} || die "${pm} not found.${shellInstallHint(pm)}"`);
  }
  if (f.hasPython) lines.push('have python3 || die "Python 3 not found. Install Python 3.10+."');
  if (f.hasGo)     lines.push('have go || die "Go not found. Install Go 1.21+: https://go.dev/dl"');
  if (f.hasRust)   lines.push('have cargo || die "Rust toolchain not found. Install: https://rustup.rs"');
  if (f.hasJava)   lines.push('have java || die "JDK not found. Install JDK 17+."');
  if (f.hasDotnet) lines.push('have dotnet || die "dotnet SDK not found. Install .NET 8+."');
  if (has(t, "Ruby")) lines.push('have ruby || die "Ruby not found. Install Ruby 3.1+."');
  if (scan.hasDocker) {
    lines.push('have docker || die "Docker not found. Install Docker Desktop or Docker Engine."');
    lines.push('docker compose version >/dev/null 2>&1 || die "Docker Compose plugin not found. Update Docker."');
  }
  // If the project needs a database but no compose file will start one, warn.
  const dbServer = pickDatabaseServer(t);
  if (dbServer && !scan.hasDocker) {
    const cmd = dbServer.check.split(" ")[0] ?? "";
    lines.push(`have ${cmd} || warn "${dbServer.label} client not found — make sure a ${dbServer.label} server is running before migrations."`);
  }
  lines.push('have git || die "git not found."');
  lines.push("");

  // ── nvm use (if .nvmrc exists) ────────────────────────────────────────────
  if (enr.hasNvmrc) {
    lines.push('step "Selecting Node version (.nvmrc)"');
    // `nvm` is a shell function, not a binary — sourcing the user's nvm.sh
    // is fragile, so just remind them to run `nvm use` themselves.
    lines.push('if have nvm; then');
    lines.push('  nvm use || warn "nvm use failed — install the pinned Node version with: nvm install"');
    lines.push('else');
    lines.push('  warn "nvm not on PATH — run \\"nvm use\\" yourself before continuing if your node version doesn\'t match .nvmrc."');
    lines.push('fi');
    lines.push("");
  }

  // ── Install dependencies ──────────────────────────────────────────────────
  lines.push('step "Installing dependencies"');
  if (hasJsPm) lines.push(`${pm} install`);
  if (f.hasPython) {
    lines.push('if [ ! -d ".venv" ]; then python3 -m venv .venv; fi');
    lines.push('# shellcheck disable=SC1091');
    lines.push('source .venv/bin/activate');
    if (has(t, "Poetry")) {
      lines.push('poetry install');
    } else {
      lines.push('if [ -f requirements.txt ]; then pip install -r requirements.txt; fi');
    }
  }
  if (f.hasGo)     lines.push("go mod download");
  if (f.hasRust)   lines.push("cargo fetch");
  if (f.hasJava)   lines.push(has(t, "Gradle") ? "./gradlew --no-daemon build -x test" : "./mvnw -B install -DskipTests");
  if (f.hasDotnet) lines.push("dotnet restore");
  if (has(t, "Ruby")) lines.push("bundle install");
  lines.push("");

  // ── Environment file ──────────────────────────────────────────────────────
  lines.push('step "Preparing .env file"');
  lines.push('if [ -f .env ]; then');
  lines.push('  warn ".env already exists — leaving it alone."');
  lines.push('elif [ -f .env.example ]; then');
  lines.push('  cp .env.example .env');
  lines.push('  warn "Created .env from .env.example — fill in real values before running the app."');
  lines.push('else');
  lines.push('  warn "No .env.example found — skipping."');
  lines.push('fi');
  lines.push("");

  // ── Docker services ───────────────────────────────────────────────────────
  if (scan.hasDocker) {
    lines.push('step "Starting local services (Docker Compose)"');
    lines.push('docker compose up -d');
    lines.push('# Give services a moment to become healthy before migrations.');
    lines.push('sleep 3');
    lines.push("");
  }

  // ── Migrations ────────────────────────────────────────────────────────────
  if (t.some((x) => x.category === "orm") || enr.hasMigrations) {
    const migrate = migrateCommand(pm, t, enr);
    lines.push('step "Running database migrations"');
    lines.push(`${migrate} || warn "Migrations failed — check DATABASE_URL in .env and that your database is running."`);
    lines.push("");
  }

  // ── Smoke test (build, if available) ──────────────────────────────────────
  const scriptNames = new Set(Object.keys(enr.scripts));
  if (scriptNames.has("build") || scriptNames.has("typecheck")) {
    const verifyScript = scriptNames.has("typecheck") ? "typecheck" : "build";
    lines.push('step "Verifying the project builds"');
    lines.push(`${pm} run ${verifyScript} || warn "${verifyScript} reported errors — review the output above."`);
    lines.push("");
  }

  // ── Final message ─────────────────────────────────────────────────────────
  const devCmd =
    scriptNames.has("dev") ? `${pm} run dev` :
    scriptNames.has("start") ? `${pm} run start` :
    devFallback(pm, f);

  lines.push('printf "\\n${BOLD}${GREEN}✓ Setup complete.${RESET}\\n"');
  lines.push(`printf "  Next: edit ${"\\033[1m"}.env${"\\033[0m"} with real values, then run ${"\\033[1m"}${devCmd}${"\\033[0m"}\\n"`);
  if (enr.hasExistingClaudeMd) {
    lines.push(`printf "  Read ${"\\033[1m"}ONBOARDING.md${"\\033[0m"} and ${"\\033[1m"}CLAUDE.md${"\\033[0m"} for project conventions.\\n\\n"`);
  } else {
    lines.push(`printf "  Read ${"\\033[1m"}ONBOARDING.md${"\\033[0m"} for the full walkthrough.\\n\\n"`);
  }

  return lines.join("\n") + "\n";
}

// ─── helpers ─────────────────────────────────────────────────────────────────

interface StackFlags {
  hasNextJs: boolean; hasPython: boolean; hasGo: boolean;
  hasRust: boolean; hasJava: boolean; hasDotnet: boolean;
}

function stackFlags(t: DetectedTech[]): StackFlags {
  return {
    hasNextJs: has(t, "Next.js"),
    hasPython: has(t, "Python"),
    hasGo:     has(t, "Go"),
    hasRust:   has(t, "Rust"),
    hasJava:   has(t, "Java") || has(t, "Spring Boot"),
    hasDotnet: has(t, "C#") || has(t, "F#"),
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

function testFallback(pm: string, t: DetectedTech[], f: StackFlags): string {
  if (has(t, "pytest")) return "pytest -v";
  if (has(t, "RSpec"))  return "bundle exec rspec";
  if (f.hasGo)     return "go test ./... -v";
  if (f.hasRust)   return "cargo test";
  if (f.hasJava)   return "./mvnw test";
  if (f.hasDotnet) return "dotnet test";
  return `${pm} test`;
}

function buildFallback(pm: string, f: StackFlags): string {
  if (f.hasPython) return "python -m build";
  if (f.hasGo)     return "go build ./...";
  if (f.hasRust)   return "cargo build --release";
  if (f.hasJava)   return "./mvnw package -DskipTests";
  if (f.hasDotnet) return "dotnet build";
  return `${pm} run build`;
}

function migrateCommand(pm: string, t: DetectedTech[], enr: ProjectEnrichment): string {
  const scripts = new Set(Object.keys(enr.scripts));
  // Real scripts win over framework defaults — they reflect what the project actually uses.
  if (scripts.has("migrate"))         return `${pm} run migrate`;
  if (scripts.has("db:migrate"))      return `${pm} run db:migrate`;
  if (scripts.has("db:push"))         return `${pm} run db:push`;
  if (scripts.has("migrate:dev"))     return `${pm} run migrate:dev`;
  if (scripts.has("migrate:up"))      return `${pm} run migrate:up`;
  if (scripts.has("graphile-migrate")) return `${pm} run graphile-migrate`;
  if (has(t, "Prisma"))  return `${pm} exec prisma migrate dev`;
  if (has(t, "Drizzle")) return `${pm} run db:push`;
  if (has(t, "TypeORM")) return `${pm} run typeorm migration:run`;
  if (has(t, "Alembic")) return "alembic upgrade head";
  return `${pm} run migrate`;
}

/**
 * Map a detected database to a local-install prereq line.
 * Returns null if we don't recognise the database or there isn't one.
 */
function pickDatabaseServer(t: DetectedTech[]): { label: string; check: string; installHint: string } | null {
  for (const tech of t) {
    if (tech.category !== "database") continue;
    const n = tech.name.toLowerCase();
    if (n.includes("postgres")) return {
      label: "PostgreSQL 14+",
      check: "psql --version",
      installHint: " · install: https://www.postgresql.org/download/ (or run via Docker)",
    };
    if (n.includes("mysql") || n.includes("mariadb")) return {
      label: "MySQL/MariaDB 8+",
      check: "mysql --version",
      installHint: " · install: https://dev.mysql.com/downloads/ (or run via Docker)",
    };
    if (n.includes("redis")) return {
      label: "Redis 6+",
      check: "redis-cli --version",
      installHint: " · install: https://redis.io/download (or run via Docker)",
    };
    if (n.includes("mongo")) return {
      label: "MongoDB 6+",
      check: "mongod --version",
      installHint: " · install: https://www.mongodb.com/try/download/community (or run via Docker)",
    };
  }
  return null;
}

function pmInstallHint(pm: string): string {
  if (pm === "pnpm") return " · install: `npm install -g pnpm`";
  if (pm === "yarn") return " · install: `npm install -g yarn`";
  if (pm === "bun")  return " · install: https://bun.sh";
  return "";
}

function shellInstallHint(pm: string): string {
  if (pm === "pnpm") return " Install with: npm install -g pnpm";
  if (pm === "yarn") return " Install with: npm install -g yarn";
  if (pm === "bun")  return " Install: https://bun.sh";
  return "";
}
