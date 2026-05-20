import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { scanProject } from "@claude-scout/detectors";
import { generateMigration } from "@claude-scout/templates";

export function registerMigration(program: Command): void {
  program
    .command("migration <intent...>")
    .description("Scaffold a migration file in the right place for the detected ORM")
    .option("--path <dir>", "Project path", process.cwd())
    .option("--force",      "Overwrite a file with the same name")
    .option("--dry-run",    "Print the file(s) that would be written")
    .action(async (intentParts: string[], options) => {
      const intent = intentParts.join(" ");
      console.log(chalk.bold(`\n🧱 Scaffolding migration — "${intent}"\n`));

      const spinner = ora("Detecting migration system").start();
      const scan = await scanProject(options.path);
      const result = generateMigration(scan, { intent });
      spinner.succeed(`Target: ${result.system}`);

      if (options.dryRun) {
        console.log(chalk.yellow("\n📋 Dry run — files that would be written:\n"));
        for (const f of result.files) {
          console.log(chalk.gray(`  ${f.path}`));
        }
        console.log(chalk.dim("\n──────────────────────────────────────────"));
        for (const f of result.files) {
          console.log(chalk.dim(`# ${f.path}`));
          console.log(f.content);
        }
        console.log(chalk.dim("──────────────────────────────────────────\n"));
        if (result.followUp) console.log(chalk.gray(`Next: ${result.followUp}\n`));
        return;
      }

      for (const f of result.files) {
        const target = join(options.path, f.path);
        if (!options.force && await exists(target)) {
          console.error(chalk.red(`\n✖  ${f.path} already exists. Use --force to overwrite.\n`));
          process.exit(1);
        }
      }

      for (const f of result.files) {
        const target = join(options.path, f.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, f.content, "utf-8");
        console.log(chalk.green(`✅ Wrote ${f.path}`));
      }
      if (result.followUp) console.log(chalk.gray(`\nNext: ${result.followUp}\n`));
    });
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
