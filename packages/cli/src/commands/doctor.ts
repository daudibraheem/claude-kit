import { execSync } from "node:child_process";
import { readFile, access, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { scanProject } from "@claude-scout/detectors";
import type { ScanResult, DetectedTech } from "@claude-scout/core";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail?: string;
  fix?: string;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose a broken local environment — runs every onboard prereq check and tells you what to fix")
    .option("--path <dir>", "Project path", process.cwd())
    .action(async (options) => {
      const cwd: string = options.path;
      console.log(chalk.bold("\n🩺 Running diagnostic checks...\n"));

      const spinner = ora("Scanning project").start();
      const scan = await scanProject(cwd);
      spinner.succeed("Project scanned");

      const checks = await runAllChecks(cwd, scan);
      printResults(checks);

      const fails = checks.filter((c) => c.status === "fail").length;
      const warns = checks.filter((c) => c.status === "warn").length;
      console.log();
      if (fails > 0) {
        console.log(chalk.red(`✖  ${fails} blocking issue${fails === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}.`));
        process.exit(1);
      } else if (warns > 0) {
        console.log(chalk.yellow(`⚠  Environment looks usable, ${warns} warning${warns === 1 ? "" : "s"} to address.`));
      } else {
        console.log(chalk.green("✓  All checks passed — environment looks healthy."));
      }
      console.log();
    });
}

// ─── Check runner ────────────────────────────────────────────────────────────

async function runAllChecks(cwd: string, scan: ScanResult): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const t = scan.technologies;
  const hasJsPm = scan.packageManager !== "unknown";

  // Git is the universal baseline.
  results.push(checkBinary("git", "git --version", null));

  if (hasJsPm) {
    results.push(checkBinary("Node.js", "node --version", "Install Node 20+ from https://nodejs.org or via nvm"));
    results.push(checkBinary(scan.packageManager, `${scan.packageManager} --version`, `Install: ${pmInstallCmd(scan.packageManager)}`));
    results.push(await checkNodeMatchesNvmrc(cwd));
    results.push(await checkLockfileSync(cwd, scan.packageManager));
  }
  if (has(t, "Python")) {
    results.push(checkBinary("Python", "python3 --version", "Install Python 3.10+"));
    results.push(await checkPyVenv(cwd));
  }
  if (has(t, "Go"))   results.push(checkBinary("Go", "go version", "Install Go 1.21+ from https://go.dev/dl"));
  if (has(t, "Rust")) results.push(checkBinary("Rust toolchain", "cargo --version", "Install via https://rustup.rs"));
  if (has(t, "Java") || has(t, "Spring Boot")) {
    results.push(checkBinary("JDK", "java -version", "Install JDK 17+"));
  }
  if (scan.hasDocker) {
    results.push(checkBinary("Docker", "docker --version", "Install Docker Desktop or Docker Engine"));
    results.push(checkBinary("Docker Compose", "docker compose version", "Update Docker — Compose v2 is bundled"));
    results.push(checkDockerRunning());
  }

  // Database server reachability.
  const dbServer = pickDatabaseServer(t);
  if (dbServer) {
    results.push(checkBinary(`${dbServer.name} client`, `${dbServer.cliBin} --version`, dbServer.installHint));
  }

  // Environment files.
  results.push(await checkEnvFile(cwd));

  // CI/workflow sanity.
  if (scan.hasCi) results.push(await checkCiWorkflow(cwd));

  return results;
}

function pmInstallCmd(pm: string): string {
  if (pm === "pnpm") return "npm install -g pnpm";
  if (pm === "yarn") return "npm install -g yarn";
  if (pm === "bun")  return "curl -fsSL https://bun.sh/install | bash";
  return "Install Node first; npm ships with it.";
}

// ─── Individual checks ───────────────────────────────────────────────────────

function checkBinary(name: string, probe: string, fix: string | null): CheckResult {
  try {
    const out = execSync(probe, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
    return { name, status: "ok", detail: firstLine(out) };
  } catch {
    return { name, status: "fail", detail: "not found on PATH", fix: fix ?? undefined };
  }
}

async function checkNodeMatchesNvmrc(cwd: string): Promise<CheckResult> {
  const name = "Node version matches .nvmrc";
  try {
    const pinned = (await readFile(join(cwd, ".nvmrc"), "utf-8")).trim().replace(/^v/, "");
    if (!pinned) return { name, status: "skip", detail: ".nvmrc is empty" };
    const actual = execSync("node --version", { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim().replace(/^v/, "");
    const pinnedMajor = pinned.split(".")[0];
    const actualMajor = actual.split(".")[0];
    if (pinnedMajor === actualMajor) {
      return { name, status: "ok", detail: `pinned ${pinned}, running ${actual}` };
    }
    return {
      name,
      status: "warn",
      detail: `pinned ${pinned}, running ${actual}`,
      fix: "Run: nvm use   (or install the pinned version: nvm install)",
    };
  } catch {
    return { name, status: "skip", detail: "no .nvmrc" };
  }
}

async function checkLockfileSync(cwd: string, pm: string): Promise<CheckResult> {
  const name = "Lockfile in sync with package.json";
  const lockfile =
    pm === "pnpm" ? "pnpm-lock.yaml" :
    pm === "yarn" ? "yarn.lock" :
    pm === "bun"  ? "bun.lock" :
                    "package-lock.json";
  try {
    const [pkgStat, lockStat] = await Promise.all([
      stat(join(cwd, "package.json")),
      stat(join(cwd, lockfile)),
    ]);
    // If package.json is newer than the lockfile, the lockfile is suspicious.
    // Not always wrong (could be a timestamp-only edit), but worth flagging.
    if (pkgStat.mtimeMs > lockStat.mtimeMs + 60_000) {
      return {
        name,
        status: "warn",
        detail: `${lockfile} is older than package.json`,
        fix: `Run: ${pm} install`,
      };
    }
    return { name, status: "ok", detail: lockfile };
  } catch {
    return { name, status: "warn", detail: `${lockfile} not found`, fix: `Run: ${pm} install` };
  }
}

async function checkPyVenv(cwd: string): Promise<CheckResult> {
  const name = "Python venv";
  try {
    await access(join(cwd, ".venv"));
    return { name, status: "ok", detail: ".venv present" };
  } catch {
    return {
      name,
      status: "warn",
      detail: ".venv not found",
      fix: "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt",
    };
  }
}

function checkDockerRunning(): CheckResult {
  const name = "Docker daemon reachable";
  try {
    execSync("docker info", { stdio: ["ignore", "pipe", "pipe"] });
    return { name, status: "ok" };
  } catch {
    return {
      name,
      status: "fail",
      detail: "`docker info` failed",
      fix: "Start Docker Desktop (Mac/Windows) or `sudo systemctl start docker` (Linux)",
    };
  }
}

async function checkEnvFile(cwd: string): Promise<CheckResult> {
  const name = "Environment file (.env / .env.local)";
  const candidates = [".env", ".env.local"];
  const examples = [".env.example", ".env.sample", ".env.template"];

  let envPath: string | null = null;
  for (const c of candidates) {
    if (await exists(join(cwd, c))) { envPath = c; break; }
  }

  let examplePath: string | null = null;
  for (const c of examples) {
    if (await exists(join(cwd, c))) { examplePath = c; break; }
  }

  if (!examplePath && !envPath) {
    return { name, status: "skip", detail: "no .env.example, project may not need env vars" };
  }
  if (examplePath && !envPath) {
    return {
      name,
      status: "fail",
      detail: `${examplePath} exists but no ${candidates.join("/")}`,
      fix: `Run: cp ${examplePath} .env   (or .env.local) and fill in real values`,
    };
  }

  // Both exist — check for required vars present in example but missing/empty in env.
  if (envPath && examplePath) {
    try {
      const exampleVars = parseEnvKeys(await readFile(join(cwd, examplePath), "utf-8"));
      const envVars = parseEnvMap(await readFile(join(cwd, envPath), "utf-8"));
      const empty: string[] = [];
      const missing: string[] = [];
      for (const key of exampleVars) {
        if (!(key in envVars)) missing.push(key);
        else if (!envVars[key]) empty.push(key);
      }
      if (missing.length > 0 || empty.length > 0) {
        const detail =
          (missing.length > 0 ? `${missing.length} missing` : "") +
          (missing.length > 0 && empty.length > 0 ? ", " : "") +
          (empty.length > 0 ? `${empty.length} empty` : "");
        return {
          name,
          status: "warn",
          detail: `${envPath} present (${detail})`,
          fix: [...missing, ...empty].slice(0, 8).map((v) => `  - ${v}`).join("\n"),
        };
      }
      return { name, status: "ok", detail: `${envPath} present, all keys filled` };
    } catch {
      return { name, status: "warn", detail: `could not parse ${envPath}` };
    }
  }

  return { name, status: "ok" };
}

async function checkCiWorkflow(cwd: string): Promise<CheckResult> {
  const name = "CI workflow";
  try {
    const files = await import("node:fs/promises").then((m) => m.readdir(join(cwd, ".github", "workflows")));
    return { name, status: "ok", detail: `${files.length} workflow file${files.length === 1 ? "" : "s"}` };
  } catch {
    return { name, status: "skip" };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseEnvKeys(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=/);
    if (m) out.push(m[1]!);
  }
  return out;
}

function parseEnvMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      const val = m[2]!.trim().replace(/^["']|["']$/g, "");
      map[m[1]!] = val;
    }
  }
  return map;
}

function pickDatabaseServer(t: DetectedTech[]): { name: string; cliBin: string; installHint: string } | null {
  for (const tech of t) {
    if (tech.category !== "database") continue;
    const n = tech.name.toLowerCase();
    if (n.includes("postgres")) return { name: "PostgreSQL", cliBin: "psql", installHint: "Install Postgres locally or run via Docker" };
    if (n.includes("mysql") || n.includes("mariadb")) return { name: "MySQL", cliBin: "mysql", installHint: "Install MySQL locally or run via Docker" };
    if (n.includes("redis")) return { name: "Redis", cliBin: "redis-cli", installHint: "Install Redis locally or run via Docker" };
    if (n.includes("mongo")) return { name: "MongoDB", cliBin: "mongosh", installHint: "Install MongoDB Shell or run mongod via Docker" };
  }
  return null;
}

function has(t: DetectedTech[], name: string): boolean {
  return t.some((x) => x.name === name);
}

function firstLine(s: string): string {
  return s.split("\n")[0] ?? "";
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// ─── Output ──────────────────────────────────────────────────────────────────

function printResults(checks: CheckResult[]): void {
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  const widest = Math.min(40, checks.reduce((m, c) => Math.max(m, c.name.length), 0));

  for (const c of checks) {
    const icon =
      c.status === "ok"   ? chalk.green("✓") :
      c.status === "warn" ? chalk.yellow("⚠") :
      c.status === "fail" ? chalk.red("✖") :
                            chalk.gray("·");
    const label = pad(c.name, widest);
    const detail = c.detail ? chalk.dim(`  ${c.detail}`) : "";
    console.log(`  ${icon}  ${label}${detail}`);
    if (c.fix && (c.status === "fail" || c.status === "warn")) {
      const fixLines = c.fix.split("\n");
      for (const line of fixLines) {
        console.log(chalk.dim(`       ↳ ${line.trimStart()}`));
      }
    }
  }
}
