import { execSync } from "node:child_process";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { askClaude } from "@claude-scout/ai-generator";
import { isGitRepo, stagedDiff, stagedFiles, recentCommitSubjects } from "../git.js";

export function registerCommit(program: Command): void {
  program
    .command("commit")
    .description("Generate a commit message from your staged diff in this repo's style")
    .option("--path <dir>",      "Project path", process.cwd())
    .option("--yes",             "Commit immediately with the generated message (no preview)")
    .option("--dry-run",         "Print the message but never run `git commit`")
    .action(async (options) => {
      const cwd: string = options.path;

      if (!isGitRepo(cwd)) {
        console.error(chalk.red("\n✖  Not a git repository.\n"));
        process.exit(1);
      }
      const diff = stagedDiff(cwd);
      if (!diff.trim()) {
        console.error(chalk.yellow("\n⚠  Nothing staged. Run `git add <files>` first.\n"));
        process.exit(1);
      }
      const files = stagedFiles(cwd);
      const styleSamples = recentCommitSubjects(cwd, 10);

      console.log(chalk.bold(`\n📝 Generating commit message (${files.length} staged file${files.length === 1 ? "" : "s"})...\n`));
      const spinner = ora("Asking Claude").start();

      let message: string;
      try {
        message = await askClaude(buildPrompt(diff, files, styleSamples), {
          cwd,
          onProgress: (msg) => { spinner.text = msg; },
          maxTokens: 600,
        });
        spinner.succeed("Suggestion ready");
      } catch (err) {
        spinner.fail("Could not generate a message");
        console.error(chalk.red("\n" + (err as Error).message + "\n"));
        process.exit(1);
      }

      const cleaned = cleanMessage(message);
      console.log("");
      console.log(chalk.dim("──── suggested commit message ────"));
      console.log(cleaned);
      console.log(chalk.dim("──────────────────────────────────"));

      if (options.dryRun) return;

      if (options.yes) {
        try {
          execSync("git commit -F -", { cwd, input: cleaned, stdio: ["pipe", "inherit", "inherit"] });
          console.log(chalk.green("\n✅ Commit created.\n"));
        } catch {
          console.error(chalk.red("\n✖  `git commit` failed (see output above).\n"));
          process.exit(1);
        }
        return;
      }

      console.log(chalk.gray("\nReview the message above. To commit:"));
      console.log(chalk.cyan("  claude-scout commit --yes"));
      console.log(chalk.gray("…or copy the message into `git commit -m \"…\"` yourself.\n"));
    });
}

function buildPrompt(diff: string, files: string[], styleSamples: string[]): string {
  // Cap the diff so the prompt stays reasonable. Most useful info is in the
  // first few KB anyway — file headers, hunk headers, the first changes.
  const trimmedDiff = diff.length > 12_000
    ? diff.slice(0, 12_000) + `\n\n…[diff truncated — ${diff.length - 12_000} more chars]`
    : diff;

  return `Write a single git commit message for the staged changes below.

## Rules
- Output ONLY the message — no preamble, no markdown fences, no commentary.
- Subject line: imperative mood, no trailing period, under 72 characters.
- If the change is non-trivial, add a blank line and 1–3 short body lines explaining WHY (not what).
- Match the style of recent commits in this repo (samples below).
- Do not invent file names, ticket numbers, or co-authors.

## Recent commit subjects in this repo (for style)
${styleSamples.length > 0 ? styleSamples.map((s) => `- ${s}`).join("\n") : "(no recent commits found)"}

## Staged files
${files.map((f) => `- ${f}`).join("\n")}

## Staged diff
\`\`\`diff
${trimmedDiff}
\`\`\`

Return only the commit message.`;
}

/**
 * Strip code-fence wrappers, leading/trailing quote chars, and assistant
 * preamble like "Here is the commit message:". Defensive parsing — Claude
 * usually follows the "output only" rule but not always.
 */
function cleanMessage(raw: string): string {
  let out = raw.trim();
  // Strip surrounding code fence.
  out = out.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  // Strip "Here is..." or "Sure," preambles on the first line.
  out = out.replace(/^(here(?: is|'s) (?:the |a )?(?:suggested |proposed )?commit message:?\s*\n)/i, "");
  // Trim wrapping quotes.
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1);
  }
  return out.trim();
}
