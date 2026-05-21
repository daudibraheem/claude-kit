import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { isGitRepo } from "../git.js";
import { readCommits, groupConventional } from "./changelog.js";

/**
 * Semi-automated release: figures out the next version from commits since
 * the last tag, updates package.json, prepends a CHANGELOG.md entry, and
 * (with --write) creates a git tag.
 *
 * Preview-by-default — running `release` alone is read-only.
 */
export function registerRelease(program: Command): void {
  program
    .command("release")
    .description("Bump the version, prepend a CHANGELOG entry, and tag — preview-only by default")
    .option("--path <dir>",   "Project root", process.cwd())
    .option("--bump <kind>",  "Force bump kind: patch | minor | major (default: infer from commits)")
    .option("--package <p>",  "Path to package.json (default: ./package.json)")
    .option("--write",        "Actually apply the changes — without this, just preview")
    .option("--no-tag",       "Skip creating a git tag even with --write")
    .option("--no-changelog", "Skip prepending to CHANGELOG.md")
    .action(async (options) => {
      const cwd: string = options.path;
      if (!isGitRepo(cwd)) {
        console.error(chalk.red("\n✖  Not a git repository.\n"));
        process.exit(1);
      }

      const pkgPath = join(cwd, options.package ?? "package.json");
      let pkgRaw: string, pkg: { version?: string; name?: string };
      try {
        pkgRaw = await readFile(pkgPath, "utf-8");
        pkg = JSON.parse(pkgRaw);
      } catch {
        console.error(chalk.red(`\n✖  Could not read ${pkgPath}. Pass --package <path> for monorepo packages.\n`));
        process.exit(1);
      }

      const currentVersion = pkg.version;
      if (!currentVersion) {
        console.error(chalk.red(`\n✖  ${options.package ?? "package.json"} has no version field.\n`));
        process.exit(1);
      }

      const fromTag = mostRecentTag(cwd);
      const range = fromTag ? `${fromTag}..HEAD` : "HEAD";

      console.log(chalk.bold("\n📦 Planning release...\n"));
      console.log(chalk.dim(`  Package:    ${pkg.name ?? "(unnamed)"}`));
      console.log(chalk.dim(`  Current:    ${currentVersion}`));
      console.log(chalk.dim(`  Range:      ${range}${fromTag ? "" : "  (no prior tag found)"}`));

      const spinner = ora("Reading commits").start();
      const commits = readCommits(cwd, range);
      if (commits.length === 0) {
        spinner.fail(`No commits in ${range}`);
        process.exit(1);
      }
      spinner.succeed(`${commits.length} commit${commits.length === 1 ? "" : "s"} since ${fromTag ?? "root"}`);

      const inferred = inferBumpKind(commits);
      const bumpKind: "patch" | "minor" | "major" = options.bump ?? inferred;
      const nextVersion = bumpVersion(currentVersion, bumpKind);

      console.log(chalk.dim(`  Bump kind:  ${bumpKind}` + (options.bump ? "  (forced via --bump)" : `  (inferred from ${reasonForBump(commits, bumpKind)})`)));
      console.log(chalk.bold(`  Next:       ${nextVersion}\n`));

      const changelogBody = groupConventional(commits);
      const changelogEntry = `## ${nextVersion} — ${todayIso()}\n\n${changelogBody.trim()}\n`;

      console.log(chalk.dim("──── proposed CHANGELOG entry ────"));
      console.log(changelogEntry);
      console.log(chalk.dim("──────────────────────────────────"));

      if (!options.write) {
        console.log(chalk.gray("\nPreview only. To apply: re-run with --write.\n"));
        return;
      }

      // ── Apply ──────────────────────────────────────────────────────────────
      console.log("");

      // 1. Update package.json
      const newPkg = pkgRaw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${nextVersion}$2`);
      if (newPkg === pkgRaw) {
        console.error(chalk.red("\n✖  Could not update version field in package.json.\n"));
        process.exit(1);
      }
      await writeFile(pkgPath, newPkg, "utf-8");
      console.log(chalk.green(`  ✓ ${options.package ?? "package.json"} version → ${nextVersion}`));

      // 2. Prepend CHANGELOG
      if (options.changelog !== false) {
        const changelogPath = join(cwd, "CHANGELOG.md");
        let existing = "";
        try { existing = await readFile(changelogPath, "utf-8"); } catch { /* new file */ }
        const header = "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
        const out = existing.startsWith("# Changelog")
          ? insertAfterHeader(existing, changelogEntry)
          : header + changelogEntry + (existing ? "\n" + existing : "");
        await writeFile(changelogPath, out, "utf-8");
        console.log(chalk.green(`  ✓ CHANGELOG.md updated`));
      }

      // 3. Commit + tag
      try {
        const filesToAdd = [pkgPath];
        if (options.changelog !== false) filesToAdd.push(join(cwd, "CHANGELOG.md"));
        execSync(`git add ${filesToAdd.map((f) => `"${f}"`).join(" ")}`, { cwd, stdio: "inherit" });
        execSync(`git commit -m "Release ${nextVersion}"`, { cwd, stdio: "inherit" });
        console.log(chalk.green(`  ✓ Committed`));

        if (options.tag !== false) {
          const tagName = `v${nextVersion}`;
          execSync(`git tag -a ${tagName} -m "${tagName}"`, { cwd, stdio: "inherit" });
          console.log(chalk.green(`  ✓ Tagged ${tagName}`));
        }
      } catch {
        console.error(chalk.red("\n✖  git commit/tag failed (see output above). package.json / CHANGELOG.md were updated."));
        process.exit(1);
      }

      console.log("");
      console.log(chalk.bold("Next steps:"));
      console.log(chalk.dim(`  git push --follow-tags origin <branch>`));
      if (pkg.name) {
        console.log(chalk.dim(`  npm publish              # if this is a library`));
      }
      console.log();
    });
}

// ─── Bump inference ──────────────────────────────────────────────────────────

function inferBumpKind(commits: Array<{ subject: string; body: string }>): "patch" | "minor" | "major" {
  let hasFeat = false;
  let hasFix = false;

  for (const c of commits) {
    // Breaking change marker — either `feat!:` style or "BREAKING CHANGE" trailer.
    if (/^[a-z]+!:/i.test(c.subject)) return "major";
    if (/^BREAKING[ -]CHANGE/im.test(c.body)) return "major";

    const m = c.subject.match(/^(\w+)/);
    if (!m) continue;
    const type = m[1]!.toLowerCase();
    if (type === "feat" || type === "feature") hasFeat = true;
    else if (type === "fix" || type === "bugfix" || type === "perf") hasFix = true;
  }

  if (hasFeat) return "minor";
  if (hasFix)  return "patch";
  // No recognisable conventional commits — be conservative.
  return "patch";
}

function reasonForBump(commits: Array<{ subject: string; body: string }>, kind: string): string {
  if (kind === "major") return "breaking-change marker";
  if (kind === "minor") return "at least one feat:";
  if (kind === "patch") return "fixes / chores only";
  return "commits";
}

function bumpVersion(v: string, kind: "patch" | "minor" | "major"): string {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) throw new Error(`Unrecognised version "${v}" — expected semver.`);
  const [, majorS, minorS, patchS] = m;
  const major = parseInt(majorS!, 10);
  const minor = parseInt(minorS!, 10);
  const patch = parseInt(patchS!, 10);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mostRecentTag(cwd: string): string | undefined {
  try {
    const tag = execSync("git describe --tags --abbrev=0", { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
    return tag || undefined;
  } catch {
    return undefined;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function insertAfterHeader(existing: string, entry: string): string {
  const lines = existing.split("\n");
  const firstSection = lines.findIndex((l) => /^##\s/.test(l));
  if (firstSection === -1) return existing.replace(/\n*$/, "\n\n") + entry;
  const head = lines.slice(0, firstSection).join("\n");
  const rest = lines.slice(firstSection).join("\n");
  return head + (head.endsWith("\n") ? "" : "\n") + "\n" + entry + "\n" + rest;
}
