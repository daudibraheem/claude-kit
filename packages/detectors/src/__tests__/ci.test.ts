import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ciDetector } from "../ci.js";

describe("ciDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-ci-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects GitHub Actions from .github/workflows dir", async () => {
    await mkdir(join(dir, ".github", "workflows"), { recursive: true });
    await writeFile(join(dir, ".github", "workflows", "ci.yml"), "on: push\n");
    const result = await ciDetector.detect(dir);
    expect(result.some((r) => r.name === "GitHub Actions")).toBe(true);
  });

  it("detects CircleCI", async () => {
    await mkdir(join(dir, ".circleci"), { recursive: true });
    await writeFile(join(dir, ".circleci", "config.yml"), "version: 2.1\n");
    const result = await ciDetector.detect(dir);
    expect(result.some((r) => r.name === "CircleCI")).toBe(true);
  });

  it("detects GitLab CI", async () => {
    await writeFile(join(dir, ".gitlab-ci.yml"), "stages:\n  - test\n");
    const result = await ciDetector.detect(dir);
    expect(result.some((r) => r.name === "GitLab CI")).toBe(true);
  });

  it("detects Jenkinsfile", async () => {
    await writeFile(join(dir, "Jenkinsfile"), "pipeline { agent any }\n");
    const result = await ciDetector.detect(dir);
    expect(result.some((r) => r.name === "Jenkins")).toBe(true);
  });

  it("detects multiple CI systems at once", async () => {
    await mkdir(join(dir, ".github", "workflows"), { recursive: true });
    await writeFile(join(dir, ".github", "workflows", "ci.yml"), "");
    await writeFile(join(dir, ".travis.yml"), "language: node_js\n");
    const result = await ciDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("GitHub Actions");
    expect(names).toContain("Travis CI");
  });

  it("returns empty when no CI config found", async () => {
    expect(await ciDetector.detect(dir)).toEqual([]);
  });
});
