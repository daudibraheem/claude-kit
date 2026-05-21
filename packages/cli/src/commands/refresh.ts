import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { scanProject } from "@claude-scout/detectors";
import { generateConfig, generateOnboarding } from "@claude-scout/templates";
import { generateConfigWithAI, generateOnboardingWithAI } from "@claude-scout/ai-generator";

/**
 * Re-run init/onboard against the current state of the project. Useful when
 * scripts, env vars, or tech-stack have changed since the files were
 * originally written.
 *
 * Conservative by default: only refreshes files that already exist (you
 * don't get a surprise CLAUDE.md when you didn't ask for one). Always
 * shows what changed before overwriting.
 */
export function registerRefresh(program: Command): void {
  program
    .command("refresh")
    .description("Re-generate CLAUDE.md and ONBOARDING.md against the current state of the project")
    .option("--path <dir>",    "Project path", process.cwd())
    .option("--ai",            "Use Claude for richer content (same as init --ai / onboard --ai)")
    .option("--claude",        "Only refresh CLAUDE.md (skip ONBOARDING.md)")
    .option("--onboarding",    "Only refresh ONBOARDING.md (skip CLAUDE.md)")
    .option("--force",         "Replace files without confirmation")
    .option("--dry-run",       "Show what would change but don't write")
    .action(async (options) => {
      const cwd: string = options.path;
      const onlyClaude = options.claude === true;
      const onlyOnboarding = options.onboarding === true;

      const claudeMdPath = join(cwd, "CLAUDE.md");
      const onboardingPath = join(cwd, "ONBOARDING.md");
      const setupShPath = join(cwd, "setup.sh");

      const hasClaude = await exists(claudeMdPath);
      const hasOnboarding = await exists(onboardingPath);

      const refreshClaude = !onlyOnboarding && hasClaude;
      const refreshOnboarding = !onlyClaude && hasOnboarding;

      if (!refreshClaude && !refreshOnboarding) {
        console.error(chalk.yellow("\n⚠  Nothing to refresh."));
        if (!hasClaude && !onlyOnboarding) console.error(chalk.dim("   No CLAUDE.md found — run `claude-scout init` first."));
        if (!hasOnboarding && !onlyClaude) console.error(chalk.dim("   No ONBOARDING.md found — run `claude-scout onboard` first."));
        console.error();
        process.exit(1);
      }

      console.log(chalk.bold("\n♻️  Refreshing project docs...\n"));
      const spinner = ora("Scanning current state").start();
      const scan = await scanProject(cwd);
      spinner.succeed(`Scanned: ${scan.technologies.length} technologies`);

      // ── CLAUDE.md ───────────────────────────────────────────────────────────
      if (refreshClaude) {
        spinner.start("Generating refreshed CLAUDE.md");
        const config = options.ai
          ? await generateConfigWithAI(scan, { onProgress: (m) => { spinner.text = m; } })
          : await generateConfig(scan);
        spinner.succeed("CLAUDE.md generated");

        const existing = await readFile(claudeMdPath, "utf-8");
        const summary = diffSummary(existing, config.claudeMd);
        printDriftSummary("CLAUDE.md", summary);

        if (!options.dryRun && (options.force || await confirmReplace("CLAUDE.md"))) {
          await writeFile(claudeMdPath, config.claudeMd, "utf-8");
          console.log(chalk.green("  ✓ CLAUDE.md replaced\n"));
        } else if (options.dryRun) {
          console.log(chalk.gray("  (dry run — not written)\n"));
        } else {
          console.log(chalk.gray("  skipped\n"));
        }
      }

      // ── ONBOARDING.md + setup.sh ────────────────────────────────────────────
      if (refreshOnboarding) {
        spinner.start("Generating refreshed ONBOARDING.md");
        const onboarding = options.ai
          ? await generateOnboardingWithAI(scan, { onProgress: (m) => { spinner.text = m; } })
          : await generateOnboarding(scan);
        spinner.succeed("ONBOARDING.md generated");

        const existing = await readFile(onboardingPath, "utf-8");
        const summary = diffSummary(existing, onboarding.markdown);
        printDriftSummary("ONBOARDING.md", summary);

        if (!options.dryRun && (options.force || await confirmReplace("ONBOARDING.md and setup.sh"))) {
          await writeFile(onboardingPath, onboarding.markdown, "utf-8");
          await writeFile(setupShPath, onboarding.script, "utf-8");
          await import("node:fs/promises").then((m) => m.chmod(setupShPath, 0o755));
          console.log(chalk.green("  ✓ ONBOARDING.md and setup.sh replaced\n"));
        } else if (options.dryRun) {
          console.log(chalk.gray("  (dry run — not written)\n"));
        } else {
          console.log(chalk.gray("  skipped\n"));
        }
      }
    });
}

// ─── Diff summary ─────────────────────────────────────────────────────────────

interface DriftSummary {
  oldLines: number;
  newLines: number;
  oldChars: number;
  newChars: number;
  /** Headings that exist in the new version but not the old, and vice versa */
  addedHeadings: string[];
  removedHeadings: string[];
}

function diffSummary(oldContent: string, newContent: string): DriftSummary {
  const oldHeadings = extractHeadings(oldContent);
  const newHeadings = extractHeadings(newContent);
  return {
    oldLines: oldContent.split("\n").length,
    newLines: newContent.split("\n").length,
    oldChars: oldContent.length,
    newChars: newContent.length,
    addedHeadings: newHeadings.filter((h) => !oldHeadings.includes(h)),
    removedHeadings: oldHeadings.filter((h) => !newHeadings.includes(h)),
  };
}

function extractHeadings(s: string): string[] {
  const out: string[] = [];
  for (const line of s.split("\n")) {
    const m = line.match(/^#{1,3}\s+(.+)$/);
    if (m) out.push(m[1]!.trim());
  }
  return out;
}

function printDriftSummary(file: string, s: DriftSummary): void {
  const lineDelta = s.newLines - s.oldLines;
  const charDelta = s.newChars - s.oldChars;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  console.log();
  console.log(chalk.bold(`  Drift in ${file}:`));
  console.log(chalk.dim(`    lines: ${s.oldLines} → ${s.newLines} (${sign(lineDelta)})`));
  console.log(chalk.dim(`    chars: ${s.oldChars} → ${s.newChars} (${sign(charDelta)})`));
  if (s.addedHeadings.length > 0) {
    console.log(chalk.green(`    + ${s.addedHeadings.length} new section${s.addedHeadings.length === 1 ? "" : "s"}:`));
    for (const h of s.addedHeadings.slice(0, 5)) console.log(chalk.green(`        + ${h}`));
    if (s.addedHeadings.length > 5) console.log(chalk.dim(`        … and ${s.addedHeadings.length - 5} more`));
  }
  if (s.removedHeadings.length > 0) {
    console.log(chalk.red(`    − ${s.removedHeadings.length} removed:`));
    for (const h of s.removedHeadings.slice(0, 5)) console.log(chalk.red(`        − ${h}`));
    if (s.removedHeadings.length > 5) console.log(chalk.dim(`        … and ${s.removedHeadings.length - 5} more`));
  }
}

// ─── Confirm prompt ──────────────────────────────────────────────────────────

async function confirmReplace(label: string): Promise<boolean> {
  // Use a tiny built-in readline prompt — pulling in inquirer/prompts just
  // for one y/n confirmation would bloat the bundle.
  process.stdout.write(chalk.bold(`  Replace ${label}? `) + chalk.dim("[y/N] "));
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (data: string) => {
      process.stdin.pause();
      const answer = data.trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });
  });
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
