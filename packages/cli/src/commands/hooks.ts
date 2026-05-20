import { writeFile, chmod, access, mkdir, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import { isGitRepo } from "../git.js";

/**
 * Install lightweight git hooks that delegate to claude-scout subcommands.
 *
 * We install:
 *   - prepare-commit-msg → suggest a commit message when the buffer is empty
 *   - pre-commit         → warn (don't block) if there are new source files
 *                          without a companion test
 *
 * Hooks are marked with a sentinel comment so the uninstaller can recognise
 * its own hooks and refuse to delete user-written ones.
 */
const SENTINEL = "# managed-by: claude-scout";

const PREPARE_COMMIT_MSG = `#!/usr/bin/env bash
${SENTINEL}
# Suggest a commit message when the buffer is empty.
# Stays out of your way for amends, merges, squashes, and templates.

MSG_FILE="$1"
SOURCE="$2"

# Skip for non-default commit sources (merges, amends, templates, squash, etc.)
if [ -n "$SOURCE" ]; then exit 0; fi

# Skip if the user already typed something.
if [ -s "$MSG_FILE" ] && grep -vqE '^(#|$)' "$MSG_FILE"; then exit 0; fi

# Don't block the commit if claude-scout isn't installed.
command -v claude-scout >/dev/null 2>&1 || exit 0

# Generate a suggestion; on any failure, leave the buffer untouched.
SUGGESTION="$(claude-scout commit --dry-run 2>/dev/null | awk '/^──── suggested commit message ────$/{f=1;next} /^──────────────────────────────────$/{f=0} f' || true)"

if [ -n "$SUGGESTION" ]; then
  # Prepend the suggestion so the user can keep or edit it.
  {
    echo "$SUGGESTION"
    echo
    cat "$MSG_FILE"
  } > "$MSG_FILE.tmp" && mv "$MSG_FILE.tmp" "$MSG_FILE"
fi
`;

const PRE_COMMIT = `#!/usr/bin/env bash
${SENTINEL}
# Warn when new source files lack a companion test. Non-blocking — exit 0
# always — so the hook never gets in the way of an emergency commit.

command -v claude-scout >/dev/null 2>&1 || exit 0

OUT="$(claude-scout test --new --dry-run 2>/dev/null || true)"
if printf "%s" "$OUT" | grep -q "Found"; then
  echo
  echo "claude-scout: heads up — some new source files don't have a companion test."
  printf "%s\\n" "$OUT" | grep "→" || true
  echo "Run 'claude-scout test --new' to scaffold them."
fi
exit 0
`;

export function registerHooks(program: Command): void {
  program
    .command("install-hooks")
    .description("Install git hooks that auto-suggest commit messages and flag missing tests")
    .option("--path <dir>", "Project path", process.cwd())
    .option("--uninstall",  "Remove the claude-scout hooks (leaves user-written hooks alone)")
    .option("--force",      "Overwrite existing hooks (only needed if you've edited them by hand)")
    .action(async (options) => {
      const cwd: string = options.path;
      if (!isGitRepo(cwd)) {
        console.error(chalk.red("\n✖  Not a git repository.\n"));
        process.exit(1);
      }
      const hooksDir = join(cwd, ".git", "hooks");
      await mkdir(hooksDir, { recursive: true });

      const targets = [
        { name: "prepare-commit-msg", content: PREPARE_COMMIT_MSG },
        { name: "pre-commit",         content: PRE_COMMIT },
      ];

      if (options.uninstall) {
        for (const t of targets) {
          const path = join(hooksDir, t.name);
          if (await ownedHook(path)) {
            await unlink(path);
            console.log(chalk.gray(`  removed ${t.name}`));
          } else if (await exists(path)) {
            console.log(chalk.yellow(`  skip ${t.name} — not managed by claude-scout`));
          }
        }
        console.log(chalk.green("\n✅ Hooks uninstalled.\n"));
        return;
      }

      for (const t of targets) {
        const path = join(hooksDir, t.name);
        if (await exists(path) && !options.force && !(await ownedHook(path))) {
          console.error(chalk.red(`\n✖  ${t.name} already exists and isn't managed by claude-scout. Use --force to overwrite (it'll be saved as ${t.name}.bak).\n`));
          process.exit(1);
        }
        if (await exists(path) && options.force && !(await ownedHook(path))) {
          // Preserve the user's existing hook as a backup.
          const backup = path + ".bak";
          const original = await readFile(path, "utf-8");
          await writeFile(backup, original, "utf-8");
          console.log(chalk.yellow(`  saved existing ${t.name} → ${t.name}.bak`));
        }
        await writeFile(path, t.content, "utf-8");
        await chmod(path, 0o755);
        console.log(chalk.green(`  ✓ installed ${t.name}`));
      }
      console.log(chalk.green("\n✅ Hooks installed.\n"));
      console.log(chalk.gray("- An empty commit message buffer will be pre-filled with a suggestion."));
      console.log(chalk.gray("- New source files without tests will trigger a non-blocking warning on commit.\n"));
    });
}

async function ownedHook(path: string): Promise<boolean> {
  try {
    const content = await readFile(path, "utf-8");
    return content.includes(SENTINEL);
  } catch {
    return false;
  }
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
