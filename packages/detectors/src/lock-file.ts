import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@ccc/core";

const LOCK_FILES: Array<{
  file: string;
  manager: string;
}> = [
  { file: "bun.lockb", manager: "Bun" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "Yarn" },
  { file: "package-lock.json", manager: "npm" },
];

export const lockFileDetector: Detector = {
  name: "lock-file",
  filePatterns: ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    for (const { file, manager } of LOCK_FILES) {
      try {
        await access(join(projectPath, file));
        return [
          {
            name: manager,
            category: "bundler",
            confidence: 1.0,
            detectedFrom: file,
            metadata: { role: "package-manager" },
          },
        ];
      } catch {
        // file not present, try next
      }
    }
    return [];
  },
};
