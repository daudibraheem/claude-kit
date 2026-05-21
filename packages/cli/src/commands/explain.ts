import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { askClaude } from "@claude-scout/ai-generator";

export function registerExplain(program: Command): void {
  program
    .command("explain <target>")
    .description("Plain-English explanation of a file or directory: what it does, key logic, where it's used, watch-outs")
    .option("--path <dir>", "Project root (for context)", process.cwd())
    .option("--short",      "Return a 2-3 sentence summary instead of the full breakdown")
    .action(async (target: string, options) => {
      const cwd: string = options.path;
      const absolute = join(cwd, target);

      console.log(chalk.bold(`\n🔎 Explaining ${target}...\n`));
      const spinner = ora("Reading source").start();

      let content: string;
      let kind: "file" | "directory";
      try {
        const st = await stat(absolute);
        if (st.isDirectory()) {
          content = await readDirectoryDigest(absolute);
          kind = "directory";
        } else {
          content = await readFileTruncated(absolute);
          kind = "file";
        }
      } catch (err) {
        spinner.fail("Could not read target");
        console.error(chalk.red("\n" + (err as Error).message + "\n"));
        process.exit(1);
      }

      spinner.text = "Asking Claude";
      const prompt = buildPrompt(target, kind, content, options.short === true);

      try {
        const result = await askClaude(prompt, {
          cwd,
          onProgress: (m) => { spinner.text = m; },
          maxTokens: options.short ? 400 : 1500,
        });
        spinner.succeed("Explanation ready");
        console.log("");
        console.log(result);
        console.log();
      } catch (err) {
        spinner.fail("Could not generate explanation");
        console.error(chalk.red("\n" + (err as Error).message + "\n"));
        process.exit(1);
      }
    });
}

async function readFileTruncated(absPath: string): Promise<string> {
  const raw = await readFile(absPath, "utf-8");
  return raw.length > 20_000
    ? raw.slice(0, 20_000) + `\n\n…[truncated — ${raw.length - 20_000} more chars]`
    : raw;
}

/**
 * For a directory, build a digest: list of files + first ~20 lines of each
 * source file. Capped at ~25 files so the prompt stays bounded.
 */
async function readDirectoryDigest(dir: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`# Directory: ${basename(dir)}\n`);

  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).slice(0, 25);
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (subdirs.length > 0) {
    lines.push(`## Sub-directories\n${subdirs.map((s) => `- ${s}/`).join("\n")}\n`);
  }

  lines.push(`## Files (${files.length} shown)\n`);
  for (const f of files) {
    const path = join(dir, f.name);
    try {
      const raw = await readFile(path, "utf-8");
      const head = raw.split("\n").slice(0, 20).join("\n");
      lines.push(`### ${f.name}\n\`\`\`\n${head}\n${raw.split("\n").length > 20 ? `…[${raw.split("\n").length - 20} more lines]` : ""}\n\`\`\``);
    } catch {
      // binary or unreadable
    }
  }
  return lines.join("\n");
}

function buildPrompt(target: string, kind: "file" | "directory", content: string, short: boolean): string {
  if (short) {
    return `Explain in 2-3 sentences what this ${kind} does and why it exists.

## ${target}
${content}

Return only the explanation — no preamble, no markdown header.`;
  }

  return `Explain this ${kind} to someone who just joined the project.

## Cover, in order:
1. **Purpose** — what is this ${kind} responsible for, in one paragraph
2. **Key pieces** — the most important functions/classes/exports (or sub-folders for a directory). One line each.
3. **How it works** — the main flow, in plain language. Use bullet points.
4. **Where it's used** — who calls into this ${kind}? (If unclear from the file alone, say so.)
5. **Watch out for** — gotchas, side effects, hidden invariants, things that surprised you.

Use level-2 markdown headings for each section. Be concrete: name real symbols, not "various functions". Don't pad — terse beats thorough.

## ${target}
${content}

Return only the explanation. No preamble.`;
}
