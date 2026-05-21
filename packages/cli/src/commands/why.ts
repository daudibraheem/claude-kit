import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { askClaude } from "@claude-scout/ai-generator";
import { isGitRepo } from "../git.js";

/**
 * `why <file>` — Why does this code exist? Combines git log, git blame, and
 * (if `gh` is available) linked PR titles into a single Claude-summarised
 * answer.
 */
export function registerWhy(program: Command): void {
  program
    .command("why <file>")
    .description("Explain why a file exists — pulls git history and linked PRs and summarises the context")
    .option("--path <dir>",   "Project root", process.cwd())
    .option("--commits <n>",  "How many recent commits to pull (default: 15)", "15")
    .action(async (target: string, options) => {
      const cwd: string = options.path;
      if (!isGitRepo(cwd)) {
        console.error(chalk.red("\n✖  Not a git repository.\n"));
        process.exit(1);
      }

      console.log(chalk.bold(`\n🕰  Why does ${target} exist?\n`));
      const spinner = ora("Gathering git history").start();

      const limit = Math.max(1, parseInt(options.commits, 10) || 15);
      const log = git(cwd, `log --no-merges --max-count=${limit} --pretty=format:%h%x09%an%x09%ad%x09%s --date=short -- ${shellEscape(target)}`);
      const fileContent = await readFirstLines(join(cwd, target), 80);
      const prs = await tryFetchPrs(cwd, target);

      if (!log && !fileContent) {
        spinner.fail(`No git history found for ${target}, and the file isn't readable.`);
        process.exit(1);
      }
      spinner.succeed(`Found ${log.split("\n").filter(Boolean).length} commits` + (prs.length > 0 ? `, ${prs.length} linked PR${prs.length === 1 ? "" : "s"}` : ""));

      spinner.start("Asking Claude");
      const prompt = buildPrompt(target, log, fileContent, prs);

      try {
        const result = await askClaude(prompt, {
          cwd,
          onProgress: (m) => { spinner.text = m; },
          maxTokens: 1500,
        });
        spinner.succeed("Summary ready");
        console.log("");
        console.log(result);
        console.log();
      } catch (err) {
        spinner.fail("Could not generate summary");
        console.error(chalk.red("\n" + (err as Error).message + "\n"));
        process.exit(1);
      }
    });
}

function git(cwd: string, args: string): string {
  try {
    return execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

async function readFirstLines(absPath: string, count: number): Promise<string> {
  try {
    const raw = await readFile(absPath, "utf-8");
    const lines = raw.split("\n").slice(0, count);
    return lines.join("\n");
  } catch {
    return "";
  }
}

interface PrEntry {
  number: number;
  title: string;
  url: string;
}

/**
 * Try to find PRs that touched this file via `gh`. Silent fallback if `gh`
 * isn't installed or the user isn't authenticated — `why` should always
 * work without external CLIs.
 */
async function tryFetchPrs(cwd: string, target: string): Promise<PrEntry[]> {
  try {
    execSync("gh --version", { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return [];
  }
  try {
    // Look up the last 5 PRs that touched this path. gh pr list --search supports path-based filters.
    const raw = execSync(
      `gh pr list --state merged --limit 5 --search ${shellEscape(target)} --json number,title,url`,
      { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" },
    ).trim();
    if (!raw) return [];
    const arr = JSON.parse(raw) as PrEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function buildPrompt(target: string, log: string, fileContent: string, prs: PrEntry[]): string {
  const prSection = prs.length > 0
    ? `## Linked merged PRs (top 5)\n${prs.map((p) => `- #${p.number} — ${p.title}`).join("\n")}\n`
    : "";

  return `Explain why \`${target}\` exists in this codebase, based on its git history.

## Output format
Three short sections, level-2 headings:
1. **Origin** — when and why was this file introduced?
2. **Evolution** — what major changes have happened since? Group related commits.
3. **Current purpose** — what is it doing today, derived from the file content + recent commits?

Be concrete. Reference real commit messages and PR titles when relevant. If history is sparse, say so — don't invent.

## File path
${target}

## Recent commits touching this file
\`\`\`
${log || "(no commit history found)"}
\`\`\`

${prSection}

## First lines of the current file
\`\`\`
${fileContent || "(file not readable)"}
\`\`\`

Return only the explanation. No preamble.`;
}

function shellEscape(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
