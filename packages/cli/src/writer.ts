import { mkdir, writeFile, access, appendFile, readFile, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { GeneratedConfig } from "@claude-scout/core";
import type { GeneratedOnboarding } from "@claude-scout/templates";

/**
 * Write the full .claude/ folder structure.
 *
 *   <project>/CLAUDE.md
 *   <project>/.claude/settings.json
 *   <project>/.claude/settings.local.json     ← gitignored
 *   <project>/.claude/commands/<name>.md
 *   <project>/.claude/rules/<name>.md
 *   <project>/.claude/skills/<name>/SKILL.md
 */
export async function writeConfig(
  projectPath: string,
  config: GeneratedConfig,
  force: boolean,
): Promise<WriteSummary> {
  const claudeDir = join(projectPath, ".claude");

  if (!force && (await exists(claudeDir))) {
    throw new Error(
      `.claude/ already exists at ${projectPath}. Use --force to overwrite.`,
    );
  }

  const written: string[] = [];

  // CLAUDE.md — project root
  await writeUtf8(join(projectPath, "CLAUDE.md"), config.claudeMd);
  written.push("CLAUDE.md");

  // .claude/settings.json
  await writeUtf8(join(claudeDir, "settings.json"), JSON.stringify(config.settingsJson, null, 2));
  written.push(".claude/settings.json");

  // .claude/settings.local.json
  await writeUtf8(join(claudeDir, "settings.local.json"), JSON.stringify(config.settingsLocalJson, null, 2));
  written.push(".claude/settings.local.json");

  // .claude/commands/
  for (const cmd of config.commands) {
    await writeUtf8(join(claudeDir, "commands", cmd.path), cmd.content);
    written.push(`.claude/commands/${cmd.path}`);
  }

  // .claude/rules/
  for (const rule of config.rules) {
    await writeUtf8(join(claudeDir, "rules", rule.path), rule.content);
    written.push(`.claude/rules/${rule.path}`);
  }

  // .claude/skills/<name>/SKILL.md
  for (const skill of config.skills) {
    await writeUtf8(join(claudeDir, "skills", skill.name, "SKILL.md"), skill.content);
    written.push(`.claude/skills/${skill.name}/SKILL.md`);
  }

  await ensureGitignored(projectPath, ".claude/settings.local.json");

  return { written };
}

export interface WriteSummary {
  written: string[];
}

/**
 * Write ONBOARDING.md + setup.sh at the project root.
 * setup.sh is marked executable (chmod 0755).
 */
export async function writeOnboarding(
  projectPath: string,
  onboarding: GeneratedOnboarding,
  force: boolean,
): Promise<WriteSummary> {
  const mdPath = join(projectPath, "ONBOARDING.md");
  const shPath = join(projectPath, "setup.sh");

  if (!force) {
    const existing: string[] = [];
    if (await exists(mdPath)) existing.push("ONBOARDING.md");
    if (await exists(shPath)) existing.push("setup.sh");
    if (existing.length > 0) {
      throw new Error(
        `${existing.join(" and ")} already exist${existing.length > 1 ? "" : "s"} at ${projectPath}. Use --force to overwrite.`,
      );
    }
  }

  await writeUtf8(mdPath, onboarding.markdown);
  await writeUtf8(shPath, onboarding.script);
  await chmod(shPath, 0o755);

  return { written: ["ONBOARDING.md", "setup.sh"] };
}

async function writeUtf8(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function ensureGitignored(projectPath: string, entry: string): Promise<void> {
  const gitignorePath = join(projectPath, ".gitignore");
  try {
    const existing = await readFile(gitignorePath, "utf-8");
    if (existing.split("\n").some((l) => l.trim() === entry)) return;
    await appendFile(gitignorePath, `\n# Claude Code local settings\n${entry}\n`);
  } catch {
    await writeUtf8(gitignorePath, `# Claude Code local settings\n${entry}\n`);
  }
}
