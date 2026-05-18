import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@ccc/core";

const CI_SIGNALS: Array<{
  path: string;
  name: string;
  isDir?: boolean;
}> = [
  { path: ".github/workflows", name: "GitHub Actions", isDir: true },
  { path: ".circleci/config.yml", name: "CircleCI" },
  { path: ".gitlab-ci.yml", name: "GitLab CI" },
  { path: "Jenkinsfile", name: "Jenkins" },
  { path: ".travis.yml", name: "Travis CI" },
  { path: "azure-pipelines.yml", name: "Azure DevOps" },
  { path: "bitbucket-pipelines.yml", name: "Bitbucket Pipelines" },
  { path: ".buildkite/pipeline.yml", name: "Buildkite" },
  { path: ".drone.yml", name: "Drone CI" },
  { path: "codeship-services.yml", name: "CodeShip" },
];

export const ciDetector: Detector = {
  name: "ci",
  filePatterns: [
    ".github/workflows",
    ".circleci/config.yml",
    ".gitlab-ci.yml",
    "Jenkinsfile",
    ".travis.yml",
    "azure-pipelines.yml",
  ],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];

    for (const signal of CI_SIGNALS) {
      try {
        await access(join(projectPath, signal.path));
        detected.push({
          name: signal.name,
          category: "ci",
          confidence: 1.0,
          detectedFrom: signal.path,
        });
      } catch {
        // not present
      }
    }

    return detected;
  },
};
