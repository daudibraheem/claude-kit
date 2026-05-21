import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { scanProject } from "@claude-scout/detectors";
import { generateConfig, generateOnboarding } from "@claude-scout/templates";
import { generateConfigWithAI, generateOnboardingWithAI } from "@claude-scout/ai-generator";
import { writeConfig, writeOnboarding } from "./writer.js";
import { showScanResults } from "./display.js";
import { registerCi } from "./commands/ci.js";
import { registerMigration } from "./commands/migration.js";
import { registerCommit } from "./commands/commit.js";
import { registerPr } from "./commands/pr.js";
import { registerTest } from "./commands/test.js";
import { registerHooks } from "./commands/hooks.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerRefresh } from "./commands/refresh.js";
import { registerExplain } from "./commands/explain.js";
import { registerWhy } from "./commands/why.js";
import { registerChangelog } from "./commands/changelog.js";
import { registerRelease } from "./commands/release.js";
import { registerReview } from "./commands/review.js";
import { registerAudit } from "./commands/audit.js";

const program = new Command();

program
  .name("claude-scout")
  .description("Auto-generate .claude/ configuration for your project")
  .version("0.1.0");

program
  .command("init")
  .description("Scan project and generate .claude/ config")
  .option("--path <dir>",  "Project path", process.cwd())
  .option("--force",       "Overwrite existing .claude/ folder")
  .option("--dry-run",     "Preview files that would be written without writing them")
  .option("--ai",          "Use Claude Opus to deeply analyse source code and generate richer config (requires ANTHROPIC_API_KEY)")
  .action(async (options) => {
    const useAI: boolean = options.ai === true;

    console.log(chalk.bold("\n🔍 Scanning your project...\n"));

    // Step 1: Detect tech stack
    const spinner = ora("Analyzing project files").start();
    const scan = await scanProject(options.path);
    spinner.succeed(`Found ${scan.technologies.length} technologies`);

    // Step 2: Display scan results
    showScanResults(scan);

    // Step 3: Generate config — template mode or AI mode
    let config;
    if (useAI) {
      const aiStart = Date.now();
      let currentPhase = "Starting…";

      const updateSpinner = () => {
        const elapsed = Math.round((Date.now() - aiStart) / 1000);
        spinner.text = `${currentPhase} (${elapsed}s)`;
      };

      spinner.start("Starting…");
      const ticker = setInterval(updateSpinner, 1000);

      try {
        config = await generateConfigWithAI(scan, {
          onProgress: (msg) => {
            currentPhase = msg;
            updateSpinner();
          },
        });
        clearInterval(ticker);
        const total = Math.round((Date.now() - aiStart) / 1000);
        spinner.succeed(`Claude generated the configuration (${total}s)`);
      } catch (err) {
        clearInterval(ticker);
        spinner.fail("AI generation failed");
        console.error(chalk.red("\n" + (err as Error).message));
        console.log(chalk.gray("\nFalling back to template mode...\n"));
        config = await generateConfig(scan);
      }
    } else {
      spinner.start("Generating .claude/ configuration");
      config = await generateConfig(scan);
      spinner.succeed("Configuration generated");
    }

    // Step 4: Write or dry-run
    if (options.dryRun) {
      console.log(chalk.yellow("\n📋 Dry run — files that would be written:\n"));
      const dryFiles = [
        "CLAUDE.md",
        ".claude/settings.json",
        ".claude/settings.local.json",
        ...config.commands.map((c) => `.claude/commands/${c.path}`),
        ...config.rules.map((r) => `.claude/rules/${r.path}`),
        ...config.skills.map((s) => `.claude/skills/${s.name}/SKILL.md`),
      ];
      dryFiles.forEach((f) => console.log(chalk.gray(`  ${f}`)));
      console.log();
    } else {
      const { written } = await writeConfig(options.path, config, options.force);
      const mode = useAI ? "Claude Opus" : "template";
      console.log(chalk.green(`\n✅ .claude/ configuration created! (${mode} mode)\n`));
      written.forEach((f) => console.log(chalk.dim(`  ✓ ${f}`)));
      console.log(chalk.gray("\nReview CLAUDE.md and customize for your team.\n"));
    }
  });

program
  .command("onboard")
  .description("Generate ONBOARDING.md + setup.sh so new devs can get a working environment in minutes")
  .option("--path <dir>",  "Project path", process.cwd())
  .option("--force",       "Overwrite existing ONBOARDING.md / setup.sh")
  .option("--dry-run",     "Preview files that would be written without writing them")
  .option("--ai",          "Use Claude to read the project and produce a richer, project-specific guide")
  .action(async (options) => {
    const useAI: boolean = options.ai === true;

    console.log(chalk.bold("\n🧭 Generating onboarding guide...\n"));

    const spinner = ora("Analyzing project files").start();
    const scan = await scanProject(options.path);
    spinner.succeed(`Found ${scan.technologies.length} technologies`);

    showScanResults(scan);

    let onboarding;
    if (useAI) {
      const aiStart = Date.now();
      let currentPhase = "Starting…";
      const updateSpinner = () => {
        const elapsed = Math.round((Date.now() - aiStart) / 1000);
        spinner.text = `${currentPhase} (${elapsed}s)`;
      };

      spinner.start("Starting…");
      const ticker = setInterval(updateSpinner, 1000);

      try {
        onboarding = await generateOnboardingWithAI(scan, {
          onProgress: (msg) => {
            currentPhase = msg;
            updateSpinner();
          },
        });
        clearInterval(ticker);
        const total = Math.round((Date.now() - aiStart) / 1000);
        spinner.succeed(`Claude generated the onboarding guide (${total}s)`);
      } catch (err) {
        clearInterval(ticker);
        spinner.fail("AI generation failed");
        console.error(chalk.red("\n" + (err as Error).message));
        console.log(chalk.gray("\nFalling back to template mode...\n"));
        onboarding = await generateOnboarding(scan);
      }
    } else {
      spinner.start("Generating onboarding guide");
      onboarding = await generateOnboarding(scan);
      spinner.succeed("Onboarding guide generated");
    }

    if (options.dryRun) {
      console.log(chalk.yellow("\n📋 Dry run — files that would be written:\n"));
      console.log(chalk.gray("  ONBOARDING.md"));
      console.log(chalk.gray("  setup.sh  (executable)"));
      console.log();
      console.log(chalk.dim("Preview — first 20 lines of ONBOARDING.md:"));
      console.log(chalk.dim("──────────────────────────────────────────"));
      onboarding.markdown.split("\n").slice(0, 20).forEach((l: string) => console.log(chalk.dim(l)));
      console.log(chalk.dim("──────────────────────────────────────────\n"));
    } else {
      const { written } = await writeOnboarding(options.path, onboarding, options.force);
      const mode = useAI ? "Claude Opus" : "template";
      console.log(chalk.green(`\n✅ Onboarding guide created! (${mode} mode)\n`));
      written.forEach((f) => console.log(chalk.dim(`  ✓ ${f}`)));
      console.log(chalk.gray("\nNew developers can now run:"));
      console.log(chalk.cyan("  ./setup.sh"));
      console.log(chalk.gray("…or read ONBOARDING.md for the step-by-step walkthrough.\n"));
    }
  });

program
  .command("scan")
  .description("Scan project and show detected technologies (no files written)")
  .option("--path <dir>", "Project path", process.cwd())
  .action(async (options) => {
    const scan = await scanProject(options.path);
    showScanResults(scan);
  });

// ─── Productivity commands (0.3.0) ──────────────────────────────────────────
registerCi(program);
registerMigration(program);
registerCommit(program);
registerPr(program);
registerTest(program);
registerHooks(program);

// ─── Comprehension + lifecycle commands (0.4.0) ─────────────────────────────
registerDoctor(program);
registerRefresh(program);
registerExplain(program);
registerWhy(program);
registerChangelog(program);
registerRelease(program);
registerReview(program);
registerAudit(program);

program.parse();
