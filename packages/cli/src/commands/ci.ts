import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { scanProject } from "@claude-scout/detectors";
import { generateCi } from "@claude-scout/templates";

export function registerCi(program: Command): void {
  program
    .command("ci")
    .description("Generate a GitHub Actions workflow tailored to the detected stack")
    .option("--path <dir>", "Project path", process.cwd())
    .option("--force",      "Overwrite an existing workflow at the same path")
    .option("--dry-run",    "Print the workflow that would be written")
    .action(async (options) => {
      console.log(chalk.bold("\n⚙️  Generating CI workflow...\n"));
      const spinner = ora("Analyzing project").start();
      const scan = await scanProject(options.path);
      const ci = await generateCi(scan);
      spinner.succeed(`Workflow generated for ${scan.technologies.length} detected technologies`);

      const target = join(options.path, ci.path);
      if (options.dryRun) {
        console.log(chalk.yellow(`\n📋 Dry run — would write ${ci.path}:\n`));
        console.log(chalk.dim("──────────────────────────────────────────"));
        console.log(ci.content);
        console.log(chalk.dim("──────────────────────────────────────────\n"));
        return;
      }

      if (!options.force && await exists(target)) {
        console.error(chalk.red(`\n✖  ${ci.path} already exists. Use --force to overwrite.\n`));
        process.exit(1);
      }

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, ci.content, "utf-8");
      console.log(chalk.green(`\n✅ Wrote ${ci.path}\n`));
      console.log(chalk.gray("Review the workflow and commit it — GitHub will pick it up on the next push."));
    });
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
