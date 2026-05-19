import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@claude-scout/core";

export const nodeDetector: Detector = {
  name: "node",
  filePatterns: [".nvmrc", ".node-version", "package.json"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    let version: string | undefined;
    let detectedFrom: string | undefined;

    // .nvmrc — highest specificity
    try {
      const raw = await readFile(join(projectPath, ".nvmrc"), "utf-8");
      version = raw.trim().replace(/^v/, "");
      detectedFrom = ".nvmrc";
    } catch {}

    // .node-version (used by asdf, volta, etc.)
    if (!detectedFrom) {
      try {
        const raw = await readFile(join(projectPath, ".node-version"), "utf-8");
        version = raw.trim().replace(/^v/, "");
        detectedFrom = ".node-version";
      } catch {}
    }

    // engines.node in package.json
    if (!detectedFrom) {
      try {
        const raw = await readFile(join(projectPath, "package.json"), "utf-8");
        const pkg = JSON.parse(raw) as { engines?: { node?: string } };
        if (pkg.engines?.node) {
          version = cleanVersion(pkg.engines.node);
          detectedFrom = "package.json#engines";
        }
      } catch {}
    }

    // package.json existing at all means it's a Node project
    if (!detectedFrom) {
      try {
        await readFile(join(projectPath, "package.json"), "utf-8");
        detectedFrom = "package.json";
      } catch {}
    }

    if (!detectedFrom) return [];

    return [
      {
        name: "Node.js",
        category: "language",
        version,
        // Full confidence when version is pinned, lower when inferred from package.json alone
        confidence: version ? 1.0 : 0.8,
        detectedFrom,
        metadata: { runtime: "node" },
      },
    ];
  },
};

function cleanVersion(v: string): string {
  return v.replace(/^[v^~>=<]+/, "");
}
