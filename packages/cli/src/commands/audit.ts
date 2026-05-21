import { readFile, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { scanProject } from "@claude-scout/detectors";

/**
 * Light security audit. Catches the egregious cases — committed secrets,
 * env vars used but undocumented, SQL string interpolation. Designed as a
 * "pre-PR sanity check", NOT a replacement for gitleaks/semgrep/etc.
 */
export function registerAudit(program: Command): void {
  program
    .command("audit")
    .description("Light security scan: committed secrets, env-var drift, SQL injection risks")
    .option("--path <dir>",   "Project root", process.cwd())
    .option("--strict",       "Exit with code 1 if any high-severity finding is reported (for CI)")
    .action(async (options) => {
      const cwd: string = options.path;

      console.log(chalk.bold("\n🛡  Running security audit...\n"));
      const spinner = ora("Scanning project").start();
      const scan = await scanProject(cwd);

      const findings: Finding[] = [];

      spinner.text = "Looking for committed secrets";
      findings.push(...(await scanForSecrets(cwd)));

      spinner.text = "Checking env-var drift";
      findings.push(...(await scanEnvDrift(cwd)));

      spinner.text = "Looking for SQL string interpolation";
      findings.push(...(await scanSqlInterpolation(cwd, scan.technologies.some((t) => t.category === "database" || t.category === "orm"))));

      spinner.succeed(`Audit done — ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
      printFindings(findings);

      console.log(chalk.dim("\nThis is a light scan. For serious work, run:"));
      console.log(chalk.dim("  - gitleaks (committed-secret history scanning)"));
      console.log(chalk.dim("  - semgrep / CodeQL (semantic security rules)"));
      console.log(chalk.dim("  - npm audit / pip-audit / cargo audit (known-vuln deps)\n"));

      if (options.strict && findings.some((f) => f.severity === "high")) {
        console.error(chalk.red("✖  --strict: high-severity findings present.\n"));
        process.exit(1);
      }
    });
}

interface Finding {
  severity: "high" | "medium" | "low";
  category: string;
  message: string;
  location?: string;
}

// ─── Secrets ────────────────────────────────────────────────────────────────

interface SecretPattern {
  label: string;
  regex: RegExp;
  severity: "high" | "medium";
}

const SECRET_PATTERNS: SecretPattern[] = [
  { label: "AWS access key",       regex: /\bAKIA[0-9A-Z]{16}\b/,                 severity: "high" },
  { label: "GitHub token",         regex: /\bghp_[A-Za-z0-9]{36}\b/,              severity: "high" },
  { label: "GitHub fine-grained",  regex: /\bgithub_pat_[A-Za-z0-9_]{82}\b/,      severity: "high" },
  { label: "Slack bot token",      regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,     severity: "high" },
  { label: "OpenAI key",           regex: /\bsk-[A-Za-z0-9]{20,}\b/,              severity: "high" },
  { label: "Anthropic key",        regex: /\bsk-ant-[A-Za-z0-9-_]{40,}\b/,        severity: "high" },
  { label: "Stripe key",           regex: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/, severity: "high" },
  { label: "Google API key",       regex: /\bAIza[0-9A-Za-z\-_]{35}\b/,           severity: "high" },
  { label: "Private key block",    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, severity: "high" },
  { label: "Generic JWT",          regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, severity: "medium" },
];

async function scanForSecrets(cwd: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await walk(cwd, cwd);

  for (const rel of files) {
    // Always-OK files (examples are expected to contain placeholder secrets,
    // .lock files are noisy and rarely contain real secrets).
    const name = basename(rel);
    if (name === ".env.example" || name === ".env.sample" || name === ".env.template") continue;
    if (name.endsWith(".lock") || name === "package-lock.json" || name === "yarn.lock" || name === "pnpm-lock.yaml") continue;
    if (rel.includes(".git/")) continue;

    let content: string;
    try { content = await readFile(join(cwd, rel), "utf-8"); } catch { continue; }
    if (content.length > 500_000) continue; // skip huge files

    for (const p of SECRET_PATTERNS) {
      const m = p.regex.exec(content);
      if (m) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        // .env files are gitignored typically, but still high-severity if committed.
        // Bump severity if the file looks committed (no .env. prefix).
        const isEnvFile = /^\.env(\.[^.]+)?$/.test(name);
        findings.push({
          severity: isEnvFile && p.severity === "medium" ? "low" : p.severity,
          category: "Secret",
          message: `${p.label} pattern detected`,
          location: `${rel}:${lineNum}`,
        });
        break; // one finding per file per pattern is enough
      }
    }
  }
  return findings;
}

// ─── Env-var drift ──────────────────────────────────────────────────────────

async function scanEnvDrift(cwd: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const examples = [".env.example", ".env.sample", ".env.template"];
  let exampleVars: Set<string> | null = null;
  let examplePath: string | null = null;

  for (const c of examples) {
    try {
      const raw = await readFile(join(cwd, c), "utf-8");
      exampleVars = new Set(parseEnvKeys(raw));
      examplePath = c;
      break;
    } catch { /* not present */ }
  }

  if (!exampleVars) return findings;

  // Find env vars referenced in source code.
  const usedVars = new Set<string>();
  const files = await walk(cwd, cwd);
  for (const rel of files) {
    if (!isSourceFile(rel)) continue;
    let content: string;
    try { content = await readFile(join(cwd, rel), "utf-8"); } catch { continue; }
    // process.env.X (JS/TS), os.environ["X"] (Python), os.Getenv("X") (Go), std::env::var("X") (Rust)
    for (const m of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) usedVars.add(m[1]!);
    for (const m of content.matchAll(/process\.env\["([A-Z][A-Z0-9_]*)"\]/g)) usedVars.add(m[1]!);
    for (const m of content.matchAll(/os\.environ(?:\.get)?\[?["']([A-Z][A-Z0-9_]*)["']/g)) usedVars.add(m[1]!);
    for (const m of content.matchAll(/os\.Getenv\("([A-Z][A-Z0-9_]*)"\)/g)) usedVars.add(m[1]!);
    for (const m of content.matchAll(/env::var\("([A-Z][A-Z0-9_]*)"\)/g)) usedVars.add(m[1]!);
  }

  for (const used of usedVars) {
    if (!exampleVars.has(used)) {
      findings.push({
        severity: "medium",
        category: "Env drift",
        message: `Code references ${used} but it isn't in ${examplePath}`,
        location: `add to ${examplePath}`,
      });
    }
  }
  return findings;
}

function parseEnvKeys(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=/);
    if (m) out.push(m[1]!);
  }
  return out;
}

// ─── SQL string interpolation ───────────────────────────────────────────────

async function scanSqlInterpolation(cwd: string, hasDb: boolean): Promise<Finding[]> {
  if (!hasDb) return [];
  const findings: Finding[] = [];
  const files = await walk(cwd, cwd);

  // Heuristic: look for SQL keywords in template literals that contain ${},
  // or in Python f-strings, or in Go fmt.Sprintf used near db queries. These
  // are imprecise — false positives are worth it to catch the obvious cases.
  const patterns: Array<{ rx: RegExp; lang: string }> = [
    { rx: /`\s*(SELECT|INSERT|UPDATE|DELETE|DROP)\b[^`]*\$\{/i, lang: "JS/TS template literal" },
    { rx: /f["']\s*(SELECT|INSERT|UPDATE|DELETE|DROP)\b[^"']*\{/i, lang: "Python f-string" },
    { rx: /fmt\.Sprintf\(\s*["']\s*(SELECT|INSERT|UPDATE|DELETE|DROP)\b/i, lang: "Go fmt.Sprintf" },
  ];

  for (const rel of files) {
    if (!isSourceFile(rel)) continue;
    if (rel.includes("/test")) continue; // tests can interpolate freely
    if (rel.includes(".test.") || rel.includes(".spec.")) continue;
    let content: string;
    try { content = await readFile(join(cwd, rel), "utf-8"); } catch { continue; }
    for (const p of patterns) {
      const m = p.rx.exec(content);
      if (m) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        findings.push({
          severity: "high",
          category: "SQL injection risk",
          message: `${p.lang} with SQL keyword and interpolation — use parameterised query`,
          location: `${rel}:${lineNum}`,
        });
        break;
      }
    }
  }
  return findings;
}

// ─── Helpers / output ───────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv",
  "target", "vendor", ".gradle", "bin", "obj",
]);

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".py", ".go", ".rs", ".rb", ".java", ".cs"]);

function isSourceFile(rel: string): boolean {
  if (!SOURCE_EXTS.has(extname(rel))) return false;
  if (rel.includes("node_modules/")) return false;
  if (rel.startsWith("dist/") || rel.startsWith("build/")) return false;
  return true;
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
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".env.local" && entry.name !== ".env.production" && entry.name !== ".github") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walk(root, full)));
    } else if (entry.isFile()) {
      try {
        const s = await stat(full);
        if (s.size > 1_000_000) continue;
      } catch { continue; }
      paths.push(relative(root, full));
    }
  }
  return paths;
}

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(chalk.green("\n  ✓ No findings.\n"));
    return;
  }
  const grouped: Record<string, Finding[]> = { high: [], medium: [], low: [] };
  for (const f of findings) grouped[f.severity]!.push(f);

  console.log("");
  for (const sev of ["high", "medium", "low"] as const) {
    const list = grouped[sev] ?? [];
    if (list.length === 0) continue;
    const icon = sev === "high" ? chalk.red("✖") : sev === "medium" ? chalk.yellow("⚠") : chalk.gray("·");
    const label = sev === "high" ? chalk.bold.red("HIGH") : sev === "medium" ? chalk.bold.yellow("MEDIUM") : chalk.bold.gray("LOW");
    console.log(`  ${label} (${list.length})`);
    for (const f of list) {
      console.log(`    ${icon}  [${f.category}] ${f.message}`);
      if (f.location) console.log(chalk.dim(`        ${f.location}`));
    }
    console.log();
  }
}
