import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@claude-kit/core";

export const dockerDetector: Detector = {
  name: "docker",
  filePatterns: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];

    // Check Dockerfile variants
    const dockerfiles = ["Dockerfile", "Dockerfile.dev", "Dockerfile.prod", "Dockerfile.staging"];
    let hasDockerfile = false;
    let detectedFrom = "Dockerfile";
    for (const df of dockerfiles) {
      try {
        await access(join(projectPath, df));
        hasDockerfile = true;
        detectedFrom = df;
        break;
      } catch {
        // not found
      }
    }

    if (hasDockerfile) {
      detected.push({
        name: "Docker",
        category: "container",
        confidence: 1.0,
        detectedFrom,
      });
    }

    // Check docker-compose variants
    const composeFiles = [
      "docker-compose.yml",
      "docker-compose.yaml",
      "compose.yml",
      "compose.yaml",
      "docker-compose.dev.yml",
      "docker-compose.prod.yml",
    ];

    for (const cf of composeFiles) {
      try {
        const raw = await readFile(join(projectPath, cf), "utf-8");
        // Count services as a rough metadata signal
        const serviceCount = (raw.match(/^\s{2}\w[\w-]+:/gm) ?? []).length;
        const alreadyHasCompose = detected.some((d) => d.name === "Docker Compose");
        if (!alreadyHasCompose) {
          detected.push({
            name: "Docker Compose",
            category: "container",
            confidence: 1.0,
            detectedFrom: cf,
            metadata: { serviceCount: serviceCount > 0 ? serviceCount : undefined },
          });
        }
        break;
      } catch {
        // not found
      }
    }

    return detected;
  },
};
