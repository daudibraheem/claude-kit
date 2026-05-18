import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@claude-kit/core";

const KNOWN_CRATES: Record<string, { name: string; category: DetectedTech["category"] }> = {
  // Web frameworks
  actix: { name: "Actix", category: "framework" },
  "actix-web": { name: "Actix Web", category: "framework" },
  axum: { name: "Axum", category: "framework" },
  rocket: { name: "Rocket", category: "framework" },
  warp: { name: "Warp", category: "framework" },
  poem: { name: "Poem", category: "framework" },
  tide: { name: "Tide", category: "framework" },

  // Async runtime
  tokio: { name: "Tokio", category: "framework" },
  "async-std": { name: "async-std", category: "framework" },
  smol: { name: "smol", category: "framework" },

  // Serialization
  serde: { name: "Serde", category: "framework" },
  "serde_json": { name: "serde_json", category: "framework" },

  // DB / ORM
  diesel: { name: "Diesel", category: "orm" },
  sqlx: { name: "sqlx", category: "orm" },
  "sea-orm": { name: "SeaORM", category: "orm" },
  rusqlite: { name: "SQLite (rusqlite)", category: "database" },
  "tokio-postgres": { name: "PostgreSQL (tokio-postgres)", category: "database" },
  mongodb: { name: "MongoDB", category: "database" },
  redis: { name: "Redis", category: "cache" },

  // Testing
  mockall: { name: "mockall", category: "testing" },
  proptest: { name: "proptest", category: "testing" },

  // gRPC
  tonic: { name: "Tonic (gRPC)", category: "api" },
  prost: { name: "Prost (Protobuf)", category: "api" },

  // CLI
  clap: { name: "Clap", category: "framework" },
};

/** Very simple TOML [dependencies] parser — no full TOML library needed. */
function parseCargoDeps(content: string): string[] {
  const deps: string[] = [];
  const inDepsSection = /^\[(?:dev-)?dependencies\]/m;
  const sections = content.split(/^\[/m);

  for (const section of sections) {
    if (!/^(?:dev-)?dependencies\]/.test(section)) continue;
    for (const line of section.split("\n").slice(1)) {
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*=/);
      if (m?.[1]) deps.push(m[1]);
      if (line.startsWith("[")) break;
    }
  }
  return deps;
}

export const rustDetector: Detector = {
  name: "rust",
  filePatterns: ["Cargo.toml"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];

    try {
      const raw = await readFile(join(projectPath, "Cargo.toml"), "utf-8");

      // Package name and edition
      const nameMatch = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
      const editionMatch = raw.match(/^\s*edition\s*=\s*"([^"]+)"/m);
      const versionMatch = raw.match(/^\s*version\s*=\s*"([^"]+)"/m);

      detected.push({
        name: "Rust",
        category: "language",
        version: versionMatch?.[1],
        confidence: 1.0,
        detectedFrom: "Cargo.toml",
        metadata: {
          crate: nameMatch?.[1],
          edition: editionMatch?.[1],
        },
      });

      const deps = parseCargoDeps(raw);
      for (const dep of deps) {
        const known = KNOWN_CRATES[dep];
        if (known && !detected.some((d) => d.name === known.name)) {
          detected.push({
            name: known.name,
            category: known.category,
            confidence: 1.0,
            detectedFrom: "Cargo.toml",
          });
        }
      }
    } catch {
      return [];
    }

    return detected;
  },
};
