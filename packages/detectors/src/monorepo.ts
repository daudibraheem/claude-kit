import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@claude-scout/core";

export const monorepoDetector: Detector = {
  name: "monorepo",
  filePatterns: [
    "turbo.json",
    "nx.json",
    "lerna.json",
    "pnpm-workspace.yaml",
    "rush.json",
    ".changeset",
  ],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];

    // Turborepo
    try {
      await access(join(projectPath, "turbo.json"));
      detected.push({
        name: "Turborepo",
        category: "bundler",
        confidence: 1.0,
        detectedFrom: "turbo.json",
        metadata: { role: "monorepo-build" },
      });
    } catch {}

    // Nx
    try {
      await access(join(projectPath, "nx.json"));
      detected.push({
        name: "Nx",
        category: "bundler",
        confidence: 1.0,
        detectedFrom: "nx.json",
        metadata: { role: "monorepo-build" },
      });
    } catch {}

    // Lerna
    try {
      const raw = await readFile(join(projectPath, "lerna.json"), "utf-8");
      const lerna = JSON.parse(raw);
      detected.push({
        name: "Lerna",
        category: "bundler",
        confidence: 1.0,
        detectedFrom: "lerna.json",
        version: lerna.version,
        metadata: { role: "monorepo-publish" },
      });
    } catch {}

    // pnpm workspaces
    try {
      await access(join(projectPath, "pnpm-workspace.yaml"));
      detected.push({
        name: "pnpm Workspaces",
        category: "bundler",
        confidence: 1.0,
        detectedFrom: "pnpm-workspace.yaml",
        metadata: { role: "monorepo-workspaces" },
      });
    } catch {}

    // Rush
    try {
      const raw = await readFile(join(projectPath, "rush.json"), "utf-8");
      const stripped = raw.replace(/\/\/[^\n]*/g, "");
      const rush = JSON.parse(stripped);
      detected.push({
        name: "Rush",
        category: "bundler",
        confidence: 1.0,
        detectedFrom: "rush.json",
        version: rush.rushVersion,
        metadata: { role: "monorepo-build" },
      });
    } catch {}

    // Changesets
    try {
      await access(join(projectPath, ".changeset"));
      detected.push({
        name: "Changesets",
        category: "bundler",
        confidence: 1.0,
        detectedFrom: ".changeset",
        metadata: { role: "release-management" },
      });
    } catch {}

    // yarn workspaces — detected from package.json "workspaces" field
    try {
      const raw = await readFile(join(projectPath, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      if (pkg.workspaces) {
        detected.push({
          name: "Yarn Workspaces",
          category: "bundler",
          confidence: 0.9,
          detectedFrom: "package.json",
          metadata: { role: "monorepo-workspaces" },
        });
      }
    } catch {}

    return detected;
  },
};
