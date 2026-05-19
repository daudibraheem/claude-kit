import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ScanResult, DetectedTech } from "@claude-scout/core";
import { allDetectors } from "./index.js";

export async function scanProject(projectPath: string): Promise<ScanResult> {
  // Run all detectors in parallel
  const results = await Promise.all(
    allDetectors.map((d) => d.detect(projectPath)),
  );

  const technologies = deduplicateTech(results.flat());

  return {
    projectName: await extractProjectName(projectPath),
    projectPath,
    technologies,
    packageManager: resolvePackageManager(technologies),
    hasTypeScript: technologies.some((t) => t.name === "TypeScript"),
    hasDocker: technologies.some((t) => t.category === "container"),
    hasCi: technologies.some((t) => t.category === "ci"),
    monorepo: technologies.some((t) =>
      ["Turborepo", "Nx", "Lerna", "pnpm Workspaces", "Yarn Workspaces", "Rush"].includes(t.name)
    ),
    detectedAt: new Date(),
  };
}

function deduplicateTech(techs: DetectedTech[]): DetectedTech[] {
  const seen = new Map<string, DetectedTech>();
  for (const tech of techs) {
    const existing = seen.get(tech.name);
    if (!existing || tech.confidence > existing.confidence) {
      seen.set(tech.name, tech);
    }
  }
  return Array.from(seen.values());
}

async function extractProjectName(projectPath: string): Promise<string> {
  try {
    const raw = await readFile(join(projectPath, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { name?: string };
    if (pkg.name) return pkg.name;
  } catch {}

  // Fall back to directory name
  return basename(projectPath) || "unknown";
}

const PACKAGE_MANAGER_NAMES: Record<string, ScanResult["packageManager"]> = {
  Bun: "bun",
  pnpm: "pnpm",
  Yarn: "yarn",
  npm: "npm",
};

function resolvePackageManager(technologies: DetectedTech[]): ScanResult["packageManager"] {
  for (const tech of technologies) {
    const pm = PACKAGE_MANAGER_NAMES[tech.name];
    if (pm) return pm;
  }
  return "unknown";
}
