import { execSync } from "node:child_process";

export interface GitContext {
  /** Current branch name, e.g. "feat/onboard" */
  branch: string;
  /** Best-guess base branch (main / master / develop) */
  baseBranch: string;
  /** Commit messages from base..HEAD, oldest first */
  branchCommits: string[];
  /** Last N commits on the current branch — used to learn message style */
  styleSamples: string[];
}

/**
 * Run a git command in `cwd` and return stdout. Returns "" on failure rather
 * than throwing — callers decide whether emptiness is fatal.
 */
function git(cwd: string, args: string): string {
  try {
    return execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

export function isGitRepo(cwd: string): boolean {
  return git(cwd, "rev-parse --is-inside-work-tree") === "true";
}

export function currentBranch(cwd: string): string {
  return git(cwd, "rev-parse --abbrev-ref HEAD") || "HEAD";
}

/**
 * Pick the most likely base branch. Order of preference:
 *   1. origin/HEAD's tracked branch (whatever the remote considers default)
 *   2. main
 *   3. master
 *   4. develop
 *
 * Falls back to "main" if none exist locally.
 */
export function detectBaseBranch(cwd: string): string {
  const remoteHead = git(cwd, "symbolic-ref --quiet --short refs/remotes/origin/HEAD");
  if (remoteHead) {
    const short = remoteHead.replace(/^origin\//, "");
    if (short) return short;
  }
  for (const candidate of ["main", "master", "develop"]) {
    if (git(cwd, `rev-parse --verify --quiet ${candidate}`)) return candidate;
  }
  return "main";
}

export function stagedDiff(cwd: string): string {
  return git(cwd, "diff --staged --no-color");
}

export function stagedFiles(cwd: string): string[] {
  const raw = git(cwd, "diff --staged --name-only");
  return raw ? raw.split("\n").filter(Boolean) : [];
}

export function branchDiff(cwd: string, base: string): string {
  return git(cwd, `diff --no-color ${base}...HEAD`);
}

export function branchCommits(cwd: string, base: string): string[] {
  const raw = git(cwd, `log --no-merges --pretty=format:%s ${base}..HEAD`);
  return raw ? raw.split("\n").reverse() : [];
}

export function recentCommitSubjects(cwd: string, count = 10): string[] {
  const raw = git(cwd, `log --no-merges --pretty=format:%s -n ${count}`);
  return raw ? raw.split("\n") : [];
}

/**
 * Files added or modified on the current branch vs. base. Useful for
 * "test --new" — we only want to inspect what this branch introduced.
 */
export function changedFiles(cwd: string, base: string): string[] {
  const raw = git(cwd, `diff --name-only --diff-filter=AM ${base}...HEAD`);
  return raw ? raw.split("\n").filter(Boolean) : [];
}

export function buildContext(cwd: string): GitContext {
  const base = detectBaseBranch(cwd);
  return {
    branch: currentBranch(cwd),
    baseBranch: base,
    branchCommits: branchCommits(cwd, base),
    styleSamples: recentCommitSubjects(cwd, 10),
  };
}
