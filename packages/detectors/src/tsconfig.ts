import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@ccc/core";

export const tsconfigDetector: Detector = {
  name: "tsconfig.json",
  filePatterns: ["tsconfig.json", "tsconfig.*.json"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const filePath = join(projectPath, "tsconfig.json");

    try {
      const raw = await readFile(filePath, "utf-8");
      // Strip comments before parsing (tsconfig allows them)
      const stripped = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const tsconfig = JSON.parse(stripped);

      const co = tsconfig.compilerOptions ?? {};
      const metadata: Record<string, unknown> = {};

      if (co.target) metadata.target = co.target;
      if (co.module) metadata.module = co.module;
      if (co.strict !== undefined) metadata.strict = co.strict;
      if (co.paths) metadata.hasPaths = true;
      if (co.baseUrl) metadata.baseUrl = co.baseUrl;
      if (co.experimentalDecorators) metadata.decorators = true;
      if (co.jsx) metadata.jsx = co.jsx;

      // Confidence is higher when compilerOptions is present and non-trivial
      const confidence = Object.keys(co).length > 2 ? 1.0 : 0.85;

      return [
        {
          name: "TypeScript",
          category: "language",
          confidence,
          detectedFrom: "tsconfig.json",
          metadata,
        },
      ];
    } catch {
      return [];
    }
  },
};
