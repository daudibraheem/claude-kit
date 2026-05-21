import { execSync } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { askClaude } from "@claude-scout/ai-generator";
import { isGitRepo } from "../git.js";

export interface ChangelogOptions {
  cwd: string;
  from?: string;
  to?: string;
  ai?: boolean;
}

export function registerChangelog(program: Command): void {
  program
    .command("changelog")
    .description("Generate a CHANGELOG.md entry from commits since the last tag")
    .option("--path <dir>",  "Project root", process.cwd())
    .option("--from <ref>",  "Start ref (default: most recent tag, or root commit if no tags)")
    .option("--to <ref>",    "End ref (default: HEAD)")
    .option("--ai",          "Use Claude to group + summarise instead of parsing conventional commits")
    .option("--write",       "Prepend the entry to CHANGELOG.md instead of printing")
    .option("--version <v>", "Version label for the entry header (default: \"Unreleased\")")
    .action(async (options) => {
      const cwd: string = options.path;
      if (!isGitRepo(cwd)) {
        console.error(chalk.red("\n✖  Not a git repository.\n"));
        process.exit(1);
      }

      const from = options.from ?? mostRecentTag(cwd);
      const to = options.to ?? "HEAD";
      const range = from ? `${from}..${to}` : to;
      const versionLabel = options.version ?? "Unreleased";

      console.log(chalk.bold(`\n📓 Building changelog for ${range}...\n`));
      const spinner = ora("Reading commits").start();

      const commits = readCommits(cwd, range);
      if (commits.length === 0) {
        spinner.fail(`No commits in ${range}`);
        process.exit(1);
      }
      spinner.succeed(`Found ${commits.length} commit${commits.length === 1 ? "" : "s"}`);

      let body: string;
      if (options.ai) {
        spinner.start("Asking Claude to group + summarise");
        try {
          body = await askClaude(buildAiPrompt(commits), {
            cwd,
            onProgress: (m) => { spinner.text = m; },
            maxTokens: 2000,
          });
          body = stripFences(body);
          spinner.succeed("Grouped by Claude");
        } catch (err) {
          spinner.fail("AI mode failed");
          console.error(chalk.red("\n" + (err as Error).message + "\n"));
          process.exit(1);
        }
      } else {
        body = groupConventional(commits);
      }

      const entry = `## ${versionLabel} — ${todayIso()}\n\n${body.trim()}\n`;

      if (!options.write) {
        console.log("");
        console.log(entry);
        console.log(chalk.gray("Run with --write to prepend this to CHANGELOG.md.\n"));
        return;
      }

      const target = join(cwd, "CHANGELOG.md");
      let existing = "";
      try { existing = await readFile(target, "utf-8"); } catch { /* new file */ }

      const header = "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
      const out = existing.startsWith("# Changelog")
        ? insertAfterHeader(existing, entry)
        : header + entry + (existing ? "\n" + existing : "");

      await writeFile(target, out, "utf-8");
      console.log(chalk.green("\n✅ Prepended entry to CHANGELOG.md\n"));
    });
}

// ─── Commit reading ──────────────────────────────────────────────────────────

interface Commit {
  hash: string;
  subject: string;
  body: string;
  author: string;
}

export function readCommits(cwd: string, range: string): Commit[] {
  // Use a control character as the field separator so subjects with commas
  // or pipes don't confuse the parser.
  const FS = "\x1F";
  const RS = "\x1E";
  let raw: string;
  try {
    raw = execSync(
      `git log --no-merges --reverse --pretty=format:%H${FS}%an${FS}%s${FS}%b${RS} ${range}`,
      { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" },
    );
  } catch {
    return [];
  }
  if (!raw.trim()) return [];

  const out: Commit[] = [];
  for (const record of raw.split(RS)) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const [hash, author, subject, body] = trimmed.split(FS);
    if (!hash || !subject) continue;
    out.push({
      hash: hash.slice(0, 7),
      author: author ?? "",
      subject: subject.trim(),
      body: (body ?? "").trim(),
    });
  }
  return out;
}

function mostRecentTag(cwd: string): string | undefined {
  try {
    const tag = execSync("git describe --tags --abbrev=0", { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
    return tag || undefined;
  } catch {
    return undefined;
  }
}

// ─── Conventional-commit grouping ────────────────────────────────────────────

interface Group {
  label: string;
  prefixes: string[];
  items: Commit[];
}

export function groupConventional(commits: Commit[]): string {
  const groups: Group[] = [
    { label: "Breaking changes", prefixes: ["BREAKING"], items: [] },
    { label: "Features",         prefixes: ["feat", "feature"], items: [] },
    { label: "Bug fixes",        prefixes: ["fix", "bugfix"], items: [] },
    { label: "Performance",      prefixes: ["perf"], items: [] },
    { label: "Refactoring",      prefixes: ["refactor"], items: [] },
    { label: "Documentation",    prefixes: ["docs"], items: [] },
    { label: "Tests",            prefixes: ["test"], items: [] },
    { label: "Build / CI",       prefixes: ["build", "ci"], items: [] },
    { label: "Chores",           prefixes: ["chore", "style"], items: [] },
    { label: "Other",            prefixes: [], items: [] },
  ];

  let anyConventional = false;
  for (const c of commits) {
    const m = c.subject.match(/^(\w+)(\(.+?\))?(!)?:\s+(.+)$/);
    if (m) {
      anyConventional = true;
      const type = m[1]!.toLowerCase();
      const breaking = m[3] === "!" || /^BREAKING[ -]CHANGE/i.test(c.body);
      const message = m[4]!;
      const item: Commit = { ...c, subject: message };
      if (breaking) {
        // Breaking changes go to their own group only, to avoid double-listing.
        groups[0]!.items.push(item);
      } else {
        const matched = groups.find((g) => g.prefixes.includes(type));
        (matched ?? groups[groups.length - 1]!).items.push(item);
      }
    } else {
      groups[groups.length - 1]!.items.push(c);
    }
  }

  // Fallback: nothing looks conventional — emit a flat bullet list.
  if (!anyConventional) {
    return commits.map((c) => `- ${c.subject} (${c.hash})`).join("\n");
  }

  const sections: string[] = [];
  for (const g of groups) {
    if (g.items.length === 0) continue;
    sections.push(`### ${g.label}`);
    for (const item of g.items) sections.push(`- ${item.subject} (${item.hash})`);
    sections.push("");
  }
  return sections.join("\n").trim();
}

// ─── AI prompt ───────────────────────────────────────────────────────────────

function buildAiPrompt(commits: Commit[]): string {
  const list = commits.map((c) => `- ${c.hash} — ${c.subject}${c.body ? `\n  ${c.body.replace(/\n/g, "\n  ")}` : ""}`).join("\n");
  return `Group and summarise the commits below into a CHANGELOG.md entry.

## Rules
- Use level-3 markdown headings for groups: Features, Bug fixes, Performance, Refactoring, Documentation, Tests, Build / CI, Other.
- Skip empty groups.
- Combine related commits into one bullet when reasonable (e.g. three small "fix typo" commits → "Various typo fixes").
- Keep each bullet short — under one line — and reference the short hash in parentheses.
- Do NOT invent functionality. Only summarise what the commits actually say.

## Output format
Just the grouped markdown body. No top-level heading, no preamble, no "Here is the changelog".

## Commits (oldest first)
${list}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  return out.trim();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function insertAfterHeader(existing: string, entry: string): string {
  // Find the first ## line and insert `entry` before it.
  const lines = existing.split("\n");
  const firstSection = lines.findIndex((l) => /^##\s/.test(l));
  if (firstSection === -1) return existing.replace(/\n*$/, "\n\n") + entry;
  const head = lines.slice(0, firstSection).join("\n");
  const rest = lines.slice(firstSection).join("\n");
  return head + (head.endsWith("\n") ? "" : "\n") + "\n" + entry + "\n" + rest;
}

export async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
