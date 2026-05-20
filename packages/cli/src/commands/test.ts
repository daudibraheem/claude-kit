import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { scanProject } from "@claude-scout/detectors";
import { findUntested, generateTestStub } from "@claude-scout/templates";
import { askClaude } from "@claude-scout/ai-generator";
import { isGitRepo, detectBaseBranch, changedFiles } from "../git.js";

export function registerTest(program: Command): void {
  program
    .command("test [target]")
    .description("Scaffold test files for source files that don't have one")
    .option("--path <dir>",  "Project path", process.cwd())
    .option("--new",         "Only consider files added/modified on the current branch")
    .option("--ai",          "Use Claude to write real tests (default: write a skeleton stub)")
    .option("--force",       "Overwrite an existing test file (the tool refuses by default)")
    .option("--dry-run",     "List the files that would be created without writing them")
    .action(async (target: string | undefined, options) => {
      const cwd: string = options.path;
      console.log(chalk.bold("\n🧪 Scaffolding tests...\n"));
      const spinner = ora("Scanning project").start();

      const scan = await scanProject(cwd);

      // Restrict set: which source files are we considering?
      let restrictTo: Set<string> | undefined;
      if (target) {
        restrictTo = new Set([target]);
      } else if (options.new) {
        if (!isGitRepo(cwd)) {
          spinner.fail("--new requires a git repository");
          process.exit(1);
        }
        const base = detectBaseBranch(cwd);
        const changed = changedFiles(cwd, base);
        if (changed.length === 0) {
          spinner.succeed("No files changed on this branch");
          return;
        }
        restrictTo = new Set(changed);
      }

      const untested = await findUntested(scan, restrictTo);
      if (untested.length === 0) {
        const where = target ? `for ${target}` : options.new ? "among changed files" : "in the project";
        spinner.succeed(`No untested source files found ${where}`);
        return;
      }
      spinner.succeed(`Found ${untested.length} untested file${untested.length === 1 ? "" : "s"}`);

      console.log();
      for (const u of untested) console.log(chalk.dim(`  ${u.source} → ${u.test}`));
      console.log();

      if (options.dryRun) {
        console.log(chalk.yellow("Dry run — no files written.\n"));
        return;
      }

      // Skip files that already have a test we missed (e.g. race or odd convention).
      const toWrite = [];
      for (const u of untested) {
        const target = join(cwd, u.test);
        if (!options.force && await exists(target)) {
          console.log(chalk.gray(`  skip — ${u.test} already exists`));
          continue;
        }
        toWrite.push(u);
      }

      let writtenCount = 0;
      for (const u of toWrite) {
        const path = join(cwd, u.test);
        const content = options.ai
          ? await generateAiTest(cwd, scan, u.source, u.test)
          : generateTestStub(scan, u.source).content;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf-8");
        writtenCount++;
        console.log(chalk.green(`  ✓ ${u.test}`));
      }

      console.log(chalk.green(`\n✅ Wrote ${writtenCount} test file${writtenCount === 1 ? "" : "s"}.\n`));
      if (!options.ai) {
        console.log(chalk.gray("These are skeletons — fill in real assertions before merging."));
        console.log(chalk.gray("Re-run with --ai to have Claude write actual tests.\n"));
      } else {
        console.log(chalk.gray("Review and adjust — AI-generated tests need human review before merge.\n"));
      }
    });
}

async function generateAiTest(cwd: string, scan: ReturnType<typeof Object>, source: string, testPath: string): Promise<string> {
  const sourceContent = await readFile(join(cwd, source), "utf-8").catch(() => "");
  const truncated = sourceContent.length > 10_000
    ? sourceContent.slice(0, 10_000) + `\n\n…[truncated — ${sourceContent.length - 10_000} more chars]`
    : sourceContent;

  const technologies = (scan as { technologies: Array<{ name: string }> }).technologies;
  const stack = technologies.map((t) => t.name).join(", ");

  const prompt = `Write a complete test file for the source code below.

## Rules
- Output ONLY the test file contents — no markdown fences, no preamble.
- Pick the test framework based on the stack: Vitest (if seen) > Jest > pytest > Go test.
- Cover the happy path, at least one edge case, and one error path.
- Follow Arrange-Act-Assert.
- One logical assertion per test.
- If the source has no exported symbols, return a single \`it.todo(...)\` test with a comment explaining why.
- Do NOT mock the module under test. Mock external services (HTTP, DB, fs) at the boundary.

## Stack
${stack}

## Test file path
${testPath}

## Source path
${source}

## Source code
\`\`\`
${truncated}
\`\`\`

Return only the test file content.`;

  const raw = await askClaude(prompt, { cwd, maxTokens: 2500 });
  return stripFences(raw);
}

function stripFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  return out.trim() + "\n";
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
