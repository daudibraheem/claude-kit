import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pythonDetector } from "../python.js";

describe("pythonDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-py-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects FastAPI from requirements.txt", async () => {
    await writeFile(join(dir, "requirements.txt"), "fastapi==0.111.0\nuvicorn>=0.29.0\npydantic\n");
    const result = await pythonDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("Python");
    expect(names).toContain("FastAPI");
  });

  it("detects Django from requirements.txt", async () => {
    await writeFile(join(dir, "requirements.txt"), "Django>=4.2\npsycopg2-binary\n");
    const result = await pythonDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("Django");
    expect(names).toContain("PostgreSQL (psycopg2)");
  });

  it("detects from pyproject.toml (PEP 621)", async () => {
    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]\nname = "myapp"\ndependencies = [\n  "fastapi>=0.100",\n  "sqlalchemy>=2.0"\n]\n`
    );
    const result = await pythonDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("Python");
    expect(names).toContain("FastAPI");
    expect(names).toContain("SQLAlchemy");
  });

  it("detects Python version from pyproject.toml (Poetry)", async () => {
    await writeFile(
      join(dir, "pyproject.toml"),
      `[tool.poetry]\nname = "app"\n[tool.poetry.dependencies]\npython = "^3.11"\nflask = "^3.0"\n`
    );
    const result = await pythonDetector.detect(dir);
    const python = result.find((r) => r.name === "Python");
    expect(python?.version).toBe("3.11");
    expect(result.some((r) => r.name === "Flask")).toBe(true);
  });

  it("reads Python version from .python-version", async () => {
    await writeFile(join(dir, ".python-version"), "3.12.3\n");
    await writeFile(join(dir, "requirements.txt"), "requests\n");
    const result = await pythonDetector.detect(dir);
    const python = result.find((r) => r.name === "Python");
    expect(python?.version).toBe("3.12.3");
  });

  it("returns empty when no Python files", async () => {
    expect(await pythonDetector.detect(dir)).toEqual([]);
  });
});
