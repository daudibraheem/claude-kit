import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, extname, basename, dirname } from "node:path";
import type { ScanResult, DetectedTech } from "@claude-scout/core";

export interface UntestedFile {
  /** Path to the source file, relative to project root */
  source: string;
  /** Where the companion test should live, relative to project root */
  test: string;
}

export interface TestStub {
  /** Where to write the test, relative to project root */
  path: string;
  /** Skeleton content (import + describe + one TODO test) */
  content: string;
}

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv",
  "target", "vendor", ".gradle", "bin", "obj", ".idea", ".vscode",
]);

/**
 * Walk the project looking for source files that lack a companion test.
 *
 * For JS/TS: `foo.ts` is "untested" if neither `foo.test.ts` nor `foo.spec.ts`
 *            (nor `__tests__/foo.ts`) exists.
 * For Python: `foo.py` is "untested" if `test_foo.py` doesn't exist somewhere
 *             under `tests/` or alongside the source.
 *
 * Returns files in stable path order. Caller can filter by `restrictTo`
 * (e.g. only files changed on the current branch).
 */
export async function findUntested(
  scan: ScanResult,
  restrictTo?: Set<string>,
): Promise<UntestedFile[]> {
  const root = scan.projectPath;
  const allFiles = await walk(root, root);

  // First pass: index every test file so we can answer "is X tested" in O(1).
  const testIndex = new Set<string>();
  for (const f of allFiles) {
    if (looksLikeTestFile(f)) testIndex.add(basename(f).toLowerCase());
  }

  const out: UntestedFile[] = [];
  for (const f of allFiles) {
    if (looksLikeTestFile(f)) continue;
    if (!isSourceLike(f, scan)) continue;
    if (restrictTo && !restrictTo.has(f)) continue;

    const testCandidates = candidateTestNames(f);
    const hasTest = testCandidates.some((c) => testIndex.has(c.toLowerCase()));
    if (hasTest) continue;

    out.push({ source: f, test: preferredTestPath(f) });
  }

  return out.sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Build a minimal test stub for a source file. Picks the right framework
 * from the scan (Vitest > Jest > pytest > Go test > generic).
 */
export function generateTestStub(scan: ScanResult, source: string): TestStub {
  const t = scan.technologies;
  const ext = extname(source);
  const base = basename(source, ext);
  const testPath = preferredTestPath(source);

  if (ext === ".py") {
    return { path: testPath, content: pyStub(base, source) };
  }
  if (ext === ".go") {
    return { path: testPath, content: goStub(base, source) };
  }

  // JS/TS: pick a framework based on the scan.
  if (has(t, "Vitest")) return { path: testPath, content: vitestStub(base, source) };
  if (has(t, "Jest"))   return { path: testPath, content: jestStub(base, source) };
  // Default to Vitest-shaped stub since it works in many projects without ceremony.
  return { path: testPath, content: vitestStub(base, source) };
}

// ─── Source/test classification ──────────────────────────────────────────────

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".py", ".go"]);
const SKIP_NAMES = /(\.config\.|\.d\.ts$|^index\.(t|j)sx?$|^next\.config|^tsup\.config|^vite\.config|^jest\.config|^vitest\.config|^eslint\.config)/;

function isSourceLike(path: string, scan: ScanResult): boolean {
  if (!SOURCE_EXTS.has(extname(path))) return false;
  const name = basename(path);
  if (SKIP_NAMES.test(name)) return false;
  // Skip files in dist-y directories that slipped past the walk filter.
  if (path.startsWith("dist/") || path.startsWith("build/")) return false;
  // Stub files / barrels are usually not worth testing in isolation.
  if (name === "index.ts" || name === "index.js") return false;
  void scan;
  return true;
}

function looksLikeTestFile(path: string): boolean {
  const name = basename(path);
  if (/\.(test|spec)\.(t|j)sx?$/.test(name)) return true;
  if (/^test_.*\.py$/.test(name)) return true;
  if (/.*_test\.py$/.test(name)) return true;
  if (/.*_test\.go$/.test(name)) return true;
  if (path.includes("__tests__/")) return true;
  if (path.includes("/tests/") && /\.(py|ts|js)$/.test(name)) return true;
  return false;
}

/**
 * For a given source path, list every filename a companion test might use.
 * (Filenames only — we already indexed by basename.)
 */
function candidateTestNames(source: string): string[] {
  const ext = extname(source);
  const base = basename(source, ext);

  if (ext === ".py") return [`test_${base}.py`, `${base}_test.py`];
  if (ext === ".go") return [`${base}_test.go`];

  const jsExts = [".ts", ".tsx", ".js", ".jsx"];
  const out: string[] = [];
  for (const e of jsExts) {
    out.push(`${base}.test${e}`);
    out.push(`${base}.spec${e}`);
  }
  return out;
}

function preferredTestPath(source: string): string {
  const ext = extname(source);
  const dir = dirname(source);
  const base = basename(source, ext);

  if (ext === ".py") return join(dir, `test_${base}.py`);
  if (ext === ".go") return join(dir, `${base}_test.go`);
  // JS/TS: colocated `.test.<ext>` is the common convention these days.
  return join(dir, `${base}.test${ext}`);
}

// ─── Stub templates ──────────────────────────────────────────────────────────

function vitestStub(base: string, source: string): string {
  return `import { describe, it, expect } from "vitest";
// Adjust the import to whatever ${base} actually exports.
// import { /* … */ } from "./${base}.js";

describe("${base}", () => {
  it.todo("describe the first behaviour you want to lock in");

  // Example skeleton — delete once you have a real test:
  //
  // it("returns X when given Y", () => {
  //   const result = subjectUnderTest(/* args */);
  //   expect(result).toBe(/* expected */);
  // });
});

// Source: ${source}
`;
}

function jestStub(base: string, source: string): string {
  return `// Adjust the import to whatever ${base} actually exports.
// import { /* … */ } from "./${base}";

describe("${base}", () => {
  it.todo("describe the first behaviour you want to lock in");

  // Example skeleton — delete once you have a real test:
  //
  // it("returns X when given Y", () => {
  //   const result = subjectUnderTest(/* args */);
  //   expect(result).toBe(/* expected */);
  // });
});

// Source: ${source}
`;
}

function pyStub(base: string, source: string): string {
  return `# Tests for ${base}
# Source: ${source}

import pytest


def test_todo_describe_first_behaviour() -> None:
    pytest.skip("TODO: write this test")
`;
}

function goStub(base: string, source: string): string {
  const pkgGuess = base.split(/[._-]/)[0] ?? "main";
  return `package ${pkgGuess}

import "testing"

// Source: ${source}

func Test${pascalCase(base)}_TODO(t *testing.T) {
\tt.Skip("TODO: write this test")
}
`;
}

function pascalCase(s: string): string {
  return s.split(/[_-]/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
}

function has(t: DetectedTech[], name: string): boolean {
  return t.some((x) => x.name === name);
}

// ─── walk (local copy — keeps tests package self-contained) ──────────────────

async function walk(root: string, dir: string): Promise<string[]> {
  const paths: string[] = [];
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return paths;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walk(root, full)));
    } else if (entry.isFile()) {
      try {
        const s = await stat(full);
        if (s.size > 500_000) continue;
      } catch { continue; }
      paths.push(relative(root, full));
    }
  }
  return paths;
}
