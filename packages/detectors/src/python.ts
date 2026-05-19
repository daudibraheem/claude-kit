import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@claude-scout/core";

const KNOWN_PACKAGES: Record<string, { name: string; category: DetectedTech["category"] }> = {
  // Frameworks
  fastapi: { name: "FastAPI", category: "framework" },
  django: { name: "Django", category: "framework" },
  flask: { name: "Flask", category: "framework" },
  starlette: { name: "Starlette", category: "framework" },
  tornado: { name: "Tornado", category: "framework" },
  aiohttp: { name: "aiohttp", category: "framework" },
  sanic: { name: "Sanic", category: "framework" },
  litestar: { name: "Litestar", category: "framework" },

  // ORMs / databases
  sqlalchemy: { name: "SQLAlchemy", category: "orm" },
  "django.db": { name: "Django ORM", category: "orm" },
  tortoise: { name: "Tortoise ORM", category: "orm" },
  peewee: { name: "Peewee", category: "orm" },
  alembic: { name: "Alembic", category: "orm" },
  psycopg2: { name: "PostgreSQL (psycopg2)", category: "database" },
  "psycopg2-binary": { name: "PostgreSQL (psycopg2)", category: "database" },
  pymongo: { name: "MongoDB (pymongo)", category: "database" },
  redis: { name: "Redis", category: "cache" },
  celery: { name: "Celery", category: "framework" },

  // Testing
  pytest: { name: "pytest", category: "testing" },
  unittest: { name: "unittest", category: "testing" },
  hypothesis: { name: "Hypothesis", category: "testing" },

  // Data / ML
  numpy: { name: "NumPy", category: "framework" },
  pandas: { name: "Pandas", category: "framework" },
  "scikit-learn": { name: "scikit-learn", category: "framework" },
  torch: { name: "PyTorch", category: "framework" },
  tensorflow: { name: "TensorFlow", category: "framework" },
};

/** Parse a requirements.txt and return package names (lowercased, no version). */
function parseRequirements(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
    .map((l) => (l.split(/[=<>!~\[;\s]/)[0] ?? "").toLowerCase())
    .filter(Boolean);
}

/** Parse [project.dependencies] from pyproject.toml (simple regex, no full TOML parser needed). */
function parsePyproject(content: string): string[] {
  const deps: string[] = [];
  // PEP 621: dependencies = ["pkg>=1.0", ...]
  const arrayMatch = content.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (arrayMatch?.[1]) {
    const items = arrayMatch[1].matchAll(/"([^"]+)"/g);
    for (const m of items) {
      const part = m[1]?.split(/[=<>!~\[;\s]/)[0];
      if (part) deps.push(part.toLowerCase());
    }
  }
  // Poetry: [tool.poetry.dependencies]
  const poetrySection = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=\[|$)/);
  if (poetrySection?.[1]) {
    const lines = poetrySection[1].split("\n");
    for (const line of lines) {
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*=/);
      if (m?.[1] && m[1].toLowerCase() !== "python") {
        deps.push(m[1].toLowerCase());
      }
    }
  }
  return deps;
}

export const pythonDetector: Detector = {
  name: "python",
  filePatterns: ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];
    let pythonFound = false;
    let pythonVersion: string | undefined;

    // --- pyproject.toml ---
    try {
      const raw = await readFile(join(projectPath, "pyproject.toml"), "utf-8");
      pythonFound = true;

      // Extract python version constraint
      const pyVer = raw.match(/python\s*=\s*["']([^"']+)["']/);
      if (pyVer?.[1]) pythonVersion = pyVer[1].replace(/^[\^~>=<]+/, "");

      const deps = parsePyproject(raw);
      pushKnown(deps, "pyproject.toml", detected);
    } catch {
      // not found
    }

    // --- requirements.txt ---
    for (const reqFile of ["requirements.txt", "requirements-dev.txt", "requirements/base.txt"]) {
      try {
        const raw = await readFile(join(projectPath, reqFile), "utf-8");
        pythonFound = true;
        const deps = parseRequirements(raw);
        pushKnown(deps, reqFile, detected);
      } catch {
        // not found
      }
    }

    // --- Pipfile ---
    try {
      const raw = await readFile(join(projectPath, "Pipfile"), "utf-8");
      pythonFound = true;
      const deps = parseRequirements(raw.replace(/\[.*?\]/g, ""));
      pushKnown(deps, "Pipfile", detected);
    } catch {
      // not found
    }

    // --- setup.py presence ---
    try {
      await access(join(projectPath, "setup.py"));
      pythonFound = true;
    } catch {
      // not found
    }

    // --- .python-version ---
    try {
      const raw = await readFile(join(projectPath, ".python-version"), "utf-8");
      pythonFound = true;
      if (!pythonVersion) pythonVersion = raw.trim();
    } catch {
      // not found
    }

    if (pythonFound) {
      detected.unshift({
        name: "Python",
        category: "language",
        version: pythonVersion,
        confidence: 1.0,
        detectedFrom: "pyproject.toml / requirements.txt",
      });
    }

    return detected;
  },
};

function pushKnown(deps: string[], source: string, detected: DetectedTech[]): void {
  for (const dep of deps) {
    const known = KNOWN_PACKAGES[dep];
    if (known && !detected.some((d) => d.name === known.name)) {
      detected.push({
        name: known.name,
        category: known.category,
        confidence: 1.0,
        detectedFrom: source,
      });
    }
  }
}
