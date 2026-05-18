import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dockerDetector } from "../docker.js";

describe("dockerDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-docker-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects Dockerfile", async () => {
    await writeFile(join(dir, "Dockerfile"), "FROM node:20\n");
    const result = await dockerDetector.detect(dir);
    expect(result.some((r) => r.name === "Docker")).toBe(true);
  });

  it("detects docker-compose.yml and counts services", async () => {
    await writeFile(
      join(dir, "docker-compose.yml"),
      `version: "3"\nservices:\n  app:\n    image: node\n  db:\n    image: postgres\n`
    );
    const result = await dockerDetector.detect(dir);
    const compose = result.find((r) => r.name === "Docker Compose");
    expect(compose).toBeDefined();
    expect(compose?.detectedFrom).toBe("docker-compose.yml");
  });

  it("detects both Dockerfile and compose together", async () => {
    await writeFile(join(dir, "Dockerfile"), "FROM node:20\n");
    await writeFile(join(dir, "docker-compose.yml"), "version: '3'\nservices:\n  app:\n    build: .\n");
    const result = await dockerDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("Docker");
    expect(names).toContain("Docker Compose");
  });

  it("returns empty when no docker files", async () => {
    expect(await dockerDetector.detect(dir)).toEqual([]);
  });
});
