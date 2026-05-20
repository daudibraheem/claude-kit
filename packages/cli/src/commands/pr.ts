import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { askClaude } from "@claude-scout/ai-generator";
import {
  isGitRepo, detectBaseBranch, currentBranch,
  branchDiff, branchCommits,
} from "../git.js";

export function registerPr(program: Command): void {
  program
    .command("pr")
    .description("Generate a PR title and body from your branch diff vs the base branch")
    .option("--path <dir>",  "Project path", process.cwd())
    .option("--base <branch>", "Base branch to diff against (default: auto-detected)")
    .option("--gh",          "Create the PR via `gh pr create` after generation (requires GitHub CLI)")
    .action(async (options) => {
      const cwd: string = options.path;
      if (!isGitRepo(cwd)) {
        console.error(chalk.red("\n✖  Not a git repository.\n"));
        process.exit(1);
      }

      const base: string = options.base ?? detectBaseBranch(cwd);
      const branch = currentBranch(cwd);
      if (branch === base) {
        console.error(chalk.red(`\n✖  You're on the base branch (${base}). Switch to a feature branch first.\n`));
        process.exit(1);
      }

      const diff = branchDiff(cwd, base);
      const commits = branchCommits(cwd, base);
      if (!diff.trim() && commits.length === 0) {
        console.error(chalk.yellow(`\n⚠  No changes between ${branch} and ${base}.\n`));
        process.exit(1);
      }

      console.log(chalk.bold(`\n🔀 Generating PR description (${branch} → ${base})...\n`));
      const spinner = ora("Asking Claude").start();

      let raw: string;
      try {
        raw = await askClaude(buildPrPrompt(diff, commits, branch, base), {
          cwd,
          onProgress: (msg) => { spinner.text = msg; },
          maxTokens: 1500,
        });
        spinner.succeed("Suggestion ready");
      } catch (err) {
        spinner.fail("Could not generate PR description");
        console.error(chalk.red("\n" + (err as Error).message + "\n"));
        process.exit(1);
      }

      const { title, body } = splitTitleAndBody(raw, branch, commits);

      console.log("");
      console.log(chalk.dim("──── title ────"));
      console.log(chalk.bold(title));
      console.log(chalk.dim("──── body ─────"));
      console.log(body);
      console.log(chalk.dim("───────────────"));

      if (options.gh) {
        await createWithGh(cwd, title, body, base);
        return;
      }

      console.log(chalk.gray("\nTo open the PR:"));
      console.log(chalk.cyan(`  gh pr create --base ${base} --title "${escapeForShell(title)}" --body-file <(echo "...")`));
      console.log(chalk.gray("…or re-run with --gh to do it automatically.\n"));
    });
}

function buildPrPrompt(diff: string, commits: string[], branch: string, base: string): string {
  const trimmedDiff = diff.length > 30_000
    ? diff.slice(0, 30_000) + `\n\n…[diff truncated — ${diff.length - 30_000} more chars]`
    : diff;

  return `Write a pull-request title and body for the changes below.

## Output format (exact)
First line: the PR title (under 70 chars, imperative mood, no trailing period).
Second line: blank.
Remaining lines: the PR body in GitHub-flavored markdown.

Body structure:
## Summary
A short paragraph or 2–4 bullet points describing what changed and why.

## Notable changes
Bullet list of the most important code-level changes (skip if there's only one).

## Test plan
Bulleted checklist of how to verify this — real commands or steps, not "ensure tests pass".

Do not include preamble like "Here is the PR description". Output ONLY the title + body.

## Branch
- Current: ${branch}
- Base: ${base}

## Commits on this branch (oldest first)
${commits.length > 0 ? commits.map((c) => `- ${c}`).join("\n") : "(no commit messages)"}

## Diff (${base}...HEAD)
\`\`\`diff
${trimmedDiff}
\`\`\``;
}

function splitTitleAndBody(raw: string, branch: string, commits: string[]): { title: string; body: string } {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");

  const newlineIdx = cleaned.indexOf("\n");
  if (newlineIdx === -1) {
    // No body at all — fall back to a body built from commit messages.
    return {
      title: cleaned.slice(0, 100).trim() || branch,
      body: commits.length > 0 ? `## Summary\n\n${commits.map((c) => `- ${c}`).join("\n")}\n` : "(no body generated)",
    };
  }

  const title = cleaned.slice(0, newlineIdx).trim();
  const body = cleaned.slice(newlineIdx + 1).trim();
  return { title: title || branch, body: body || `(no body)` };
}

async function createWithGh(cwd: string, title: string, body: string, base: string): Promise<void> {
  // Write body to a temp file so we can pass `--body-file` and dodge shell quoting hell.
  const tmpPath = join(tmpdir(), `claude-scout-pr-${Date.now()}.md`);
  writeFileSync(tmpPath, body, "utf-8");
  try {
    execSync(`gh pr create --base "${base}" --title "${escapeForShell(title)}" --body-file "${tmpPath}"`, {
      cwd,
      stdio: "inherit",
    });
  } catch {
    console.error(chalk.red("\n✖  `gh pr create` failed (see output above).\n"));
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

function escapeForShell(s: string): string {
  return s.replace(/"/g, '\\"');
}
