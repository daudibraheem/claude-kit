import chalk from "chalk";
import type { ScanResult, DetectedTech, TechCategory } from "@claude-scout/core";

const CATEGORY_LABEL: Record<TechCategory, string> = {
  language:  "Languages",
  framework: "Frameworks",
  database:  "Databases",
  cache:     "Caches",
  orm:       "ORMs",
  testing:   "Testing",
  bundler:   "Bundlers / Package Managers",
  linter:    "Linters / Formatters",
  ci:        "CI / CD",
  container: "Containers",
  cloud:     "Cloud",
  api:       "APIs",
  ui:        "UI Libraries",
};

const CATEGORY_COLOR: Record<TechCategory, (s: string) => string> = {
  language:  chalk.cyan,
  framework: chalk.green,
  database:  chalk.yellow,
  cache:     chalk.yellow,
  orm:       chalk.yellow,
  testing:   chalk.magenta,
  bundler:   chalk.blue,
  linter:    chalk.blue,
  ci:        chalk.blue,
  container: chalk.red,
  cloud:     chalk.red,
  api:       chalk.green,
  ui:        chalk.cyan,
};

export function showScanResults(scan: ScanResult): void {
  console.log();
  console.log(chalk.bold("📦 Project:"), chalk.white(scan.projectName));
  console.log(chalk.dim("   " + scan.projectPath));
  console.log();

  if (scan.technologies.length === 0) {
    console.log(chalk.yellow("  No technologies detected.\n"));
    return;
  }

  // Group by category
  const groups = new Map<TechCategory, DetectedTech[]>();
  for (const tech of scan.technologies) {
    const list = groups.get(tech.category) ?? [];
    list.push(tech);
    groups.set(tech.category, list);
  }

  // Print in a defined order
  const categoryOrder: TechCategory[] = [
    "language", "framework", "ui", "orm", "database", "cache",
    "api", "testing", "bundler", "linter", "ci", "container", "cloud",
  ];

  for (const cat of categoryOrder) {
    const techs = groups.get(cat);
    if (!techs || techs.length === 0) continue;

    const color = CATEGORY_COLOR[cat];
    console.log(color(`  ${CATEGORY_LABEL[cat]}`));

    for (const tech of techs) {
      const version = tech.version ? chalk.dim(`  v${tech.version}`) : "";
      const confidence = tech.confidence < 1.0
        ? chalk.dim(` (${Math.round(tech.confidence * 100)}% confidence)`)
        : "";
      console.log(`    ${chalk.white(tech.name)}${version}${confidence}`);
    }
    console.log();
  }

  // Summary flags
  const flags: string[] = [];
  if (scan.hasTypeScript) flags.push(chalk.cyan("TypeScript"));
  if (scan.hasDocker)     flags.push(chalk.red("Docker"));
  if (scan.hasCi)         flags.push(chalk.blue("CI/CD"));
  if (scan.monorepo)      flags.push(chalk.magenta("Monorepo"));

  if (flags.length > 0) {
    console.log(chalk.bold("  Flags:"), flags.join(chalk.dim("  ·  ")));
    console.log();
  }

  console.log(
    chalk.dim(`  Package manager: ${scan.packageManager}`) +
    chalk.dim(`  ·  Scanned ${scan.technologies.length} technologies`),
  );
  console.log();
}
