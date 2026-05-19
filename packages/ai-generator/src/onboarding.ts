import { execSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { ScanResult } from "@claude-scout/core";
import { collectProjectFiles, type ProjectFile } from "./file-reader.js";

export interface GeneratedOnboarding {
  markdown: string;
  script: string;
}

/**
 * Generate ONBOARDING.md + setup.sh by asking Claude to read the project
 * directly. Tries the Claude Code CLI first (uses the user's existing login,
 * has tools), falls back to the Anthropic API with a bundled-files prompt.
 */
export async function generateOnboardingWithAI(
  scan: ScanResult,
  options: { verbose?: boolean; onProgress?: (msg: string) => void } = {},
): Promise<GeneratedOnboarding> {
  const report = (msg: string) => {
    options.onProgress?.(msg);
    if (options.verbose) process.stderr.write(`  ${msg}\n`);
  };

  const claudePath = findCLI();
  let cliError: string | null = null;
  if (claudePath) {
    report("Asking Claude to scan the project for onboarding details…");
    try {
      const result = await generateWithCLI(scan, claudePath, report);
      report("Parsing Claude response…");
      return result;
    } catch (err) {
      cliError = (err as Error).message;
      report("CLI strategy failed — trying API key fallback…");
    }
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    const cliDetail = cliError
      ? `\nCLI error:\n${cliError}\n`
      : claudePath
        ? "\nClaude Code found but failed (run with verbose for details).\n"
        : "\nClaude Code CLI not found in PATH.\n";
    throw new Error(
      `No AI strategy available.${cliDetail}\n` +
      "Option 1: Install Claude Code (https://claude.ai/code) and run `claude login`\n" +
      "Option 2: Set ANTHROPIC_API_KEY — export ANTHROPIC_API_KEY=sk-ant-...",
    );
  }

  report("Collecting project files for API fallback…");
  const files = await collectProjectFiles(scan);
  report(`Collected ${files.length} files — calling Anthropic API…`);
  const prompt = buildBundledPrompt(scan, files);

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return parseOnboardingResponse(raw);
}

// ─── Strategy: Claude Code CLI ───────────────────────────────────────────────

function findCLI(): string | null {
  try {
    const p = execSync("which claude", { stdio: "pipe", encoding: "utf-8" }).trim();
    return p || null;
  } catch {
    return null;
  }
}

const CLI_TIMEOUT_MS = 10 * 60 * 1000;

function generateWithCLI(
  scan: ScanResult,
  claudePath: string,
  onProgress?: (msg: string) => void,
): Promise<GeneratedOnboarding> {
  return new Promise((resolve, reject) => {
    const prompt = buildScanPrompt(scan);

    const child = spawn(
      claudePath,
      [
        "-p",
        "--dangerously-skip-permissions",
        "--model", "claude-sonnet-4-6",
        "--add-dir", scan.projectPath,
        "--allowedTools", "Read", "Glob", "Grep", "LS",
      ],
      {
        env: process.env,
        cwd: scan.projectPath,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      onProgress?.(`Claude is working (${stdout.length} bytes received)…`);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      const tail = (stderr || "<no stderr>").slice(-400);
      reject(new Error(
        `Claude timed out after ${CLI_TIMEOUT_MS / 1000} s — received ${stdout.length} bytes\nstderr tail: ${tail}`,
      ));
    }, CLI_TIMEOUT_MS);

    child.on("error", (err) => { clearTimeout(timer); reject(err); });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}\nstderr: ${stderr.slice(0, 400)}`));
        return;
      }
      try {
        resolve(parseOnboardingResponse(stdout));
      } catch (err) {
        const debugPath = `/tmp/claude-scout-onboard-raw-${Date.now()}.txt`;
        try { writeFileSync(debugPath, stdout); } catch { /* ignore */ }
        reject(new Error(
          `${(err as Error).message}\n\nFull raw response saved to: ${debugPath}`,
        ));
      }
    });

    child.stdin.write(prompt, "utf-8");
    child.stdin.end();
  });
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function buildScanPrompt(scan: ScanResult): string {
  const techList = scan.technologies
    .map((t) => `- ${t.name}${t.version ? ` v${t.version}` : ""} (${t.category})`)
    .join("\n") || "(none detected — explore the project yourself)";

  return `You are generating a developer onboarding guide for the project in your current working directory.

You have read-only access through your Read, Glob, Grep, and LS tools — use them. Explore thoroughly before writing the onboarding guide. (You don't need to write any files — just return the JSON described below; the host tool will write the files from your response.)

## What we already detected
- Project name: ${scan.projectName}
- Project path: ${scan.projectPath}
- Package manager: ${scan.packageManager}
- TypeScript: ${scan.hasTypeScript}
- Docker: ${scan.hasDocker}
- CI/CD: ${scan.hasCi}
- Monorepo: ${scan.monorepo}

Detected technologies:
${techList}

## What to explore
1. README — what does this project actually do? Borrow its first real paragraph for the intro.
2. \`package.json\` / \`pyproject.toml\` / \`go.mod\` — real scripts, real engines/version requirements.
3. \`.env.example\` (or \`.env.sample\`) — real environment variables a new dev must set.
4. \`docker-compose.yml\` if present — what services run locally (Postgres, Redis, etc.)?
5. ORM schema files — \`prisma/schema.prisma\`, drizzle schemas, migrations folders — real table/model names.
6. \`.github/workflows/\` — the canonical "what must pass" pipeline.
7. Directory layout — top-level folders and what each owns.

## What to produce
A single JSON object (no markdown, no prose, no preamble). Start with \`{\` and end with \`}\`:

{
  "markdown": "<full ONBOARDING.md content — see quality bar below>",
  "script":   "<full setup.sh content, POSIX bash, executable>"
}

## Quality bar — ONBOARDING.md

Write a guide that takes a new developer from a fresh machine to a working app, step by step. Required sections in order:

1. **Title + intro** — what this project is, in plain language. Borrow from README if accurate.
2. **Prerequisites** — exact tooling versions (Node 20+, ${scan.packageManager}, Docker, etc.) — only list what this project actually uses.
3. **Clone the repository** — \`git clone …\` placeholder.
4. **Install dependencies** — the exact command(s) for this stack.
5. **Environment variables** — \`cp .env.example .env\` + a table of every real variable from \`.env.example\` with the inline-comment description if present.
6. **Start local services** (only if Docker Compose is used) — \`docker compose up -d\`, ports, how to stop.
7. **Database setup** (only if ORM detected) — the actual migration command for this project (read \`package.json\` scripts: \`migrate\`, \`db:migrate\`, \`db:push\`, etc.). Include seed command if a seed script exists. List real model/table names.
8. **Run the project** — dev, test, build commands using the REAL script names from \`package.json\`. Include lint/typecheck/format if those scripts exist.
9. **Project structure** — top-level folders with one-line descriptions of what each contains, based on what you saw.
10. **Where to look next** — README, CLAUDE.md if it exists, \`.claude/rules/\`, CI workflows, pair with a teammate.
11. **Troubleshooting** — 2–4 common failure modes specific to this stack (port conflicts, missing env vars, migration failures, lockfile issues).

Use level-2 headings (\`## 1. Prerequisites\`), short paragraphs, and copy-pasteable code fences. No filler. No generic "AI-flavored" prose.

## Quality bar — setup.sh

A re-runnable POSIX bash script with \`set -euo pipefail\`. Structure:

1. Helper functions for coloured step/warn/die output and a \`have\` command check.
2. Prereq checks — \`have node\`, \`have ${scan.packageManager}\`, \`have docker\` (only if applicable), etc. Die with a helpful message if missing.
3. Install dependencies (the same command from the markdown).
4. Copy \`.env.example\` → \`.env\` if \`.env\` doesn't already exist; warn the user to fill it in.
5. \`docker compose up -d\` if applicable, with a short sleep before migrations.
6. Run migrations if an ORM is detected, with a graceful warning on failure.
7. Run a smoke verification — \`<pm> run build\` or \`<pm> run typecheck\` if those scripts exist.
8. Print a "Setup complete" message with next steps.

Each step must be idempotent — running the script twice in a row must not break anything.

Return ONLY the JSON. No preamble. Start with \`{\`.`;
}

function buildBundledPrompt(scan: ScanResult, files: ProjectFile[]): string {
  const techList = scan.technologies
    .map((t) => `- ${t.name}${t.version ? ` v${t.version}` : ""} (${t.category})`)
    .join("\n");

  const filesBlock = files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  return `You are generating a developer onboarding guide (ONBOARDING.md + setup.sh) for the project below.

Ground everything in the ACTUAL files you read — no generic boilerplate.

## Project scan
- Name: ${scan.projectName}
- Package manager: ${scan.packageManager}
- TypeScript: ${scan.hasTypeScript}
- Docker: ${scan.hasDocker}
- CI/CD: ${scan.hasCi}
- Monorepo: ${scan.monorepo}

### Detected technologies
${techList}

## Project files
${filesBlock}

---

Return ONLY a JSON object with two string fields:

{
  "markdown": "<full ONBOARDING.md content>",
  "script":   "<full setup.sh content, POSIX bash>"
}

ONBOARDING.md sections (in order): title+intro, Prerequisites, Clone, Install, Environment variables (with a table of real vars from .env.example), Docker services (only if compose detected), Database setup (only if ORM detected — use the real migrate script from package.json), Run (dev/test/build with real script names), Project structure, Where to look next, Troubleshooting.

setup.sh: start with \`#!/usr/bin/env bash\` + \`set -euo pipefail\`, check prereqs, install, copy .env, start docker, migrate, verify build, print done message. Idempotent.

Return ONLY the JSON. Start with \`{\`.`;
}

// ─── Parse ───────────────────────────────────────────────────────────────────

interface RawOnboarding {
  markdown?: string;
  script?: string;
}

export function parseOnboardingResponse(raw: string): GeneratedOnboarding {
  const jsonStr = extractJson(raw);
  let parsed: RawOnboarding;
  try {
    parsed = JSON.parse(jsonStr) as RawOnboarding;
  } catch {
    throw new Error(
      `Claude returned invalid JSON for onboarding.\n\nRaw response (first 500 chars):\n${raw.slice(0, 500)}`,
    );
  }
  if (!parsed.markdown || !parsed.script) {
    throw new Error(
      `Claude response is missing markdown or script field.\n\nGot keys: ${Object.keys(parsed).join(", ")}`,
    );
  }
  return { markdown: parsed.markdown, script: parsed.script };
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) return trimmed;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  const end = trimmed.lastIndexOf("}");
  if (end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
