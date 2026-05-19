import { execSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { ScanResult, GeneratedConfig } from "@claude-scout/core";
import { collectProjectFiles, type ProjectFile } from "./file-reader.js";
import { parseConfigResponse } from "./parse.js";

export async function generateConfigWithAI(
  scan: ScanResult,
  options: { verbose?: boolean; onProgress?: (msg: string) => void } = {},
): Promise<GeneratedConfig> {
  const report = (msg: string) => {
    options.onProgress?.(msg);
    if (options.verbose) process.stderr.write(`  ${msg}\n`);
  };

  // Strategy 1: Claude Code CLI — autonomous scan
  // Don't pre-read files. Just hand Claude a short brief and let it use its
  // own Read/Glob/Grep/Bash tools to explore the project directory. Way more
  // thorough than our priority-glob heuristic, and the tiny prompt avoids any
  // pipe-pressure / hang issues we hit when shipping 80 KB of context.
  const claudePath = findCLI();
  let cliError: string | null = null;
  if (claudePath) {
    report("Asking Claude to scan the project (uses its built-in tools)…");
    try {
      const result = await generateWithCLI(scan, claudePath, report);
      report("Parsing Claude response…");
      return result;
    } catch (err) {
      cliError = (err as Error).message;
      report(`CLI strategy failed — trying API key fallback…`);
    }
  }

  // Strategy 2: Anthropic API — no tools available, so fall back to the
  // old approach of bundling project files into the prompt.
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    const cliDetail = cliError
      ? `\nCLI error:\n${cliError}\n`
      : claudePath
        ? "\nClaude Code found but failed (run with verbose for details).\n"
        : "\nClaude Code CLI not found in PATH.\n";
    throw new Error(
      `No AI strategy available.${cliDetail}\n` +
      "Option 1: Claude Code is installed — it should work automatically (check login with: claude --version)\n" +
      "Option 2: Set ANTHROPIC_API_KEY   export ANTHROPIC_API_KEY=sk-ant-...",
    );
  }

  report("Collecting project files for API fallback…");
  const files = await collectProjectFiles(scan);
  report(`Collected ${files.length} files (${totalChars(files)} chars) — calling Anthropic API…`);
  const apiPrompt = buildBundledPrompt(scan, files);

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    messages: [{ role: "user", content: apiPrompt }],
  });

  const raw = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return parseConfigResponse(raw, scan);
}

// ─── Strategy implementations ─────────────────────────────────────────────────

function findCLI(): string | null {
  try {
    const p = execSync("which claude", { stdio: "pipe", encoding: "utf-8" }).trim();
    return p || null;
  } catch {
    return null;
  }
}

const CLI_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — autonomous scans can take a while

function generateWithCLI(
  scan: ScanResult,
  claudePath: string,
  onProgress?: (msg: string) => void,
): Promise<GeneratedConfig> {
  return new Promise((resolve, reject) => {
    const prompt = buildScanPrompt(scan);

    const child = spawn(
      claudePath,
      [
        "-p",
        "--dangerously-skip-permissions",
        "--model", "claude-sonnet-4-6",
        "--add-dir", scan.projectPath,
        // Read-only scan: Claude can explore but cannot modify the project.
        // We write the .claude/ folder ourselves from the JSON it returns.
        "--allowedTools", "Read", "Glob", "Grep", "LS",
      ],
      {
        env: process.env,
        cwd: scan.projectPath, // run inside the project so Read/Glob see it
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
        resolve(parseConfigResponse(stdout, scan));
      } catch (err) {
        const debugPath = `/tmp/create-claude-config-raw-${Date.now()}.txt`;
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

// ─── Prompts ──────────────────────────────────────────────────────────────────

/**
 * Short brief for the CLI strategy. Claude will use its own tools to scan the
 * project directory, so we don't need to bundle file contents in the prompt.
 */
function buildScanPrompt(scan: ScanResult): string {
  const techList = scan.technologies
    .map((t) => `- ${t.name}${t.version ? ` v${t.version}` : ""} (${t.category})`)
    .join("\n") || "(none detected — explore the project yourself)";

  return `You are generating a complete \`.claude/\` configuration for the project in your current working directory.

You have read-only access to the project through your Read, Glob, Grep, and LS tools — use them. Explore thoroughly before writing the config. (You don't need to write any files — just return the JSON below; the host tool will write the .claude/ folder from your response.)

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
1. \`README*\` — what does this project actually do?
2. \`package.json\` / \`pyproject.toml\` / \`go.mod\` / etc. — real scripts, real dependencies
3. The directory layout — list the top-level folders and what each one owns
4. Entry points (\`src/index.*\`, \`app/\`, \`cmd/\`, \`main.*\`) — actual architecture
5. Schema files (\`*.prisma\`, \`schema.sql\`, \`*.graphql\`) — real tables/models
6. \`.env.example\` — real environment variables
7. API routes / controllers / handlers — actual endpoint patterns
8. Test files — real test patterns and conventions
9. CI workflows in \`.github/workflows/\` — what the pipeline actually does

Use \`Glob\` first to map out the structure, then \`Read\` the most informative files. Use \`Grep\` to find specific patterns (table names, route handlers, etc.). Don't stop at one or two — be thorough.

## What to produce
A single JSON object (no markdown, no explanation, no prose before or after). Start with \`{\` and end with \`}\`. Use this exact shape:

{
  "claudeMd": "<full CLAUDE.md content, project-specific>",
  "settingsJson": {
    "model": "claude-sonnet-4-6",
    "permissions": { "allow": ["Read", "Edit", "Write", "Bash(git *)", "..."], "deny": [] },
    "hooks": {},
    "env": {}
  },
  "settingsLocalJson": { "permissions": { "allow": [], "deny": [] } },
  "commands": [ { "path": "test.md", "content": "..." } ],
  "rules":    [ { "path": "typescript.md", "content": "..." } ],
  "skills":   [ { "name": "add-feature", "content": "---\\nname: add-feature\\ndescription: ...\\nversion: 0.1.0\\n---\\n\\n# ..." } ]
}

## Quality bar — make it a beast-level config
- **CLAUDE.md**: open with what this project actually does (from README/code). Cover real architecture (folder responsibilities), real commands (from scripts), real conventions (observed patterns), real schema tables, real env vars. No generic boilerplate.
- **settings.json**: \`allow\` rules matching actual scripts (e.g. \`Bash(${scan.packageManager} test*)\`, \`Bash(${scan.packageManager} run build*)\`). Include real Bash patterns for every category you find (test, build, lint, migrate, format, db, docker).
- **commands/**: one .md per real script. Each: a one-line description, the exact bash command, what to report afterward, ending with \`$ARGUMENTS\`. Always include \`review.md\` and \`explain.md\`.
- **rules/**: one .md per concern, anchored to THIS codebase. Reference actual table names, actual component names, actual hook names, actual env var names, actual script names. Always include \`git.md\` and \`security.md\`. Add \`typescript.md\`, \`database.md\`, \`frontend.md\`, \`api.md\`, \`testing.md\` only when they apply.
- **skills/**: full SKILL.md with YAML frontmatter (\`name\`, \`description\`, \`version: 0.1.0\`). Include \`add-feature\`, \`debug\`, \`write-tests\`, \`refactor\`. Add \`database-change\` only if you see ORM/migration files. Each skill must reference THIS project's actual test/build/lint commands and folder structure.

Be exhaustive. The whole point is that this config beats a generic template by being grounded in real observations.

Return ONLY the JSON. No preamble. No "Here is..." text. Start with \`{\`.`;
}

/**
 * Long bundled prompt for the API fallback (no tools available).
 */
function buildBundledPrompt(scan: ScanResult, files: ProjectFile[]): string {
  const techList = scan.technologies
    .map((t) => `- ${t.name}${t.version ? ` v${t.version}` : ""} (${t.category})`)
    .join("\n");

  const filesBlock = files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  return `You are an expert developer tool that analyses a software project and generates a complete, accurate .claude/ configuration folder for use with Claude Code.

Your output must be grounded in the ACTUAL code you read below — not generic templates.

## Project Scan
- Name: ${scan.projectName}
- Package manager: ${scan.packageManager}
- TypeScript: ${scan.hasTypeScript}
- Docker: ${scan.hasDocker}
- CI/CD: ${scan.hasCi}
- Monorepo: ${scan.monorepo}

### Detected Technologies
${techList}

## Project Files
${filesBlock}

---

Return ONLY a valid JSON object (no markdown, no explanation) with this structure:

{
  "claudeMd": "<full CLAUDE.md content>",
  "settingsJson": { "model": "claude-sonnet-4-6", "permissions": { "allow": [...], "deny": [] }, "hooks": {}, "env": {} },
  "settingsLocalJson": { "permissions": { "allow": [], "deny": [] } },
  "commands": [ { "path": "test.md", "content": "..." } ],
  "rules":    [ { "path": "typescript.md", "content": "..." } ],
  "skills":   [ { "name": "add-feature", "content": "---\\nname: add-feature\\ndescription: ...\\nversion: 0.1.0\\n---\\n\\n# ..." } ]
}

Make CLAUDE.md project-specific: real architecture, real commands, real conventions, real env vars. Generate commands/, rules/, and skills/ grounded in the actual code above.

Return ONLY the JSON. Start with \`{\` and end with \`}\`.`;
}

function totalChars(files: ProjectFile[]): number {
  return files.reduce((s, f) => s + f.content.length, 0);
}
