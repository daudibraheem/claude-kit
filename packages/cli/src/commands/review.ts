import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { askClaude } from "@claude-scout/ai-generator";
import {
  isGitRepo, detectBaseBranch, currentBranch,
  branchDiff, branchCommits,
} from "../git.js";

/**
 * Self-review your branch before opening a PR. Reads <base>...HEAD and asks
 * Claude to flag issues grouped by severity. Designed to be runnable in CI
 * as a soft check (--strict to fail on any "must fix").
 */
export function registerReview(program: Command): void {
  program
    .command("review")
    .description("Self-review your branch diff against the base — flag issues grouped by severity")
    .option("--path <dir>",   "Project root", process.cwd())
    .option("--base <branch>", "Base branch (default: auto-detected)")
    .option("--strict",       "Exit with code 1 if any \"must fix\" issues are found (useful in CI)")
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
      if (!diff.trim()) {
        console.error(chalk.yellow(`\n⚠  No changes between ${branch} and ${base}.\n`));
        process.exit(1);
      }

      console.log(chalk.bold(`\n🔍 Reviewing ${branch} → ${base}...\n`));
      const spinner = ora("Asking Claude").start();

      let result: string;
      try {
        result = await askClaude(buildPrompt(diff, commits, branch, base), {
          cwd,
          onProgress: (m) => { spinner.text = m; },
          maxTokens: 3000,
        });
        spinner.succeed("Review ready");
      } catch (err) {
        spinner.fail("Could not generate review");
        console.error(chalk.red("\n" + (err as Error).message + "\n"));
        process.exit(1);
      }

      const cleaned = stripFences(result);
      console.log("");
      console.log(cleaned);
      console.log();

      if (options.strict) {
        // Naïve but effective: if the review contains any "must fix" bullets
        // (and isn't ambiguous about it), exit non-zero. Suitable for CI.
        const hasMustFix = /^\s*[-*]\s/m.test(cleaned) && /must fix/i.test(cleaned);
        if (hasMustFix) {
          console.error(chalk.red("\n✖  --strict: review reported \"must fix\" issues.\n"));
          process.exit(1);
        }
      }
    });
}

function buildPrompt(diff: string, commits: string[], branch: string, base: string): string {
  const trimmedDiff = diff.length > 35_000
    ? diff.slice(0, 35_000) + `\n\n…[diff truncated — ${diff.length - 35_000} more chars]`
    : diff;

  return `Review the changes below as if you were a senior engineer reviewing this branch before it merges.

## Output format (strict)
Three level-2 sections, even if a section is empty (write "_None._" in that case):

## Must fix
Bullet list of issues that must be addressed before merging: bugs, security holes, missed edge cases, broken contracts, missing critical tests. Cite the file and approximate line range when possible.

## Should fix
Bullet list of strong concerns that aren't blocking but should be addressed: subtle correctness risks, performance smells, weak naming, missing non-critical tests, doc gaps.

## Nice to have
Bullet list of stylistic suggestions or refactor opportunities. Skip if there's nothing material.

## Rules
- Be specific. Reference real symbols and files. No generic advice like "consider adding tests".
- Do NOT restate what the change does. Reviewers know the diff.
- Skip a category entirely if there's nothing real to say (use "_None._").
- Stop when you're out of substance. Brevity is a virtue.

## Branch
- Current: ${branch}
- Base: ${base}

## Commits on this branch
${commits.length > 0 ? commits.map((c) => `- ${c}`).join("\n") : "(none)"}

## Diff
\`\`\`diff
${trimmedDiff}
\`\`\`

Return only the three sections. No preamble.`;
}

function stripFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  return out.trim();
}
