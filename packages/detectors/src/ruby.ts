import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@claude-kit/core";

const KNOWN_GEMS: Record<string, { name: string; category: DetectedTech["category"] }> = {
  // Frameworks
  rails: { name: "Ruby on Rails", category: "framework" },
  sinatra: { name: "Sinatra", category: "framework" },
  hanami: { name: "Hanami", category: "framework" },
  roda: { name: "Roda", category: "framework" },
  grape: { name: "Grape", category: "api" },

  // ORM / DB
  activerecord: { name: "ActiveRecord", category: "orm" },
  sequel: { name: "Sequel", category: "orm" },
  mongoid: { name: "Mongoid", category: "orm" },
  pg: { name: "PostgreSQL (pg)", category: "database" },
  mysql2: { name: "MySQL", category: "database" },
  sqlite3: { name: "SQLite", category: "database" },
  redis: { name: "Redis", category: "cache" },

  // Background jobs
  sidekiq: { name: "Sidekiq", category: "framework" },
  delayed_job: { name: "Delayed Job", category: "framework" },
  resque: { name: "Resque", category: "framework" },

  // Testing
  rspec: { name: "RSpec", category: "testing" },
  minitest: { name: "Minitest", category: "testing" },
  cucumber: { name: "Cucumber", category: "testing" },
  capybara: { name: "Capybara", category: "testing" },
  factory_bot: { name: "FactoryBot", category: "testing" },

  // API
  graphql: { name: "GraphQL Ruby", category: "api" },
  "grape-swagger": { name: "Grape Swagger", category: "api" },
};

/** Parse gem names from a Gemfile (strips version constraints). */
function parseGemfile(content: string): string[] {
  const gems: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*gem\s+['"]([^'"]+)['"]/);
    if (m?.[1]) gems.push(m[1].toLowerCase().replace(/-/g, "_"));
  }
  return gems;
}

export const rubyDetector: Detector = {
  name: "ruby",
  filePatterns: ["Gemfile", ".ruby-version"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];
    let rubyVersion: string | undefined;

    // .ruby-version
    try {
      const raw = await readFile(join(projectPath, ".ruby-version"), "utf-8");
      rubyVersion = raw.trim().replace(/^ruby-/, "");
    } catch {}

    // Gemfile
    try {
      const raw = await readFile(join(projectPath, "Gemfile"), "utf-8");

      // ruby version declaration inside Gemfile
      if (!rubyVersion) {
        rubyVersion = raw.match(/^\s*ruby\s+['"]([^'"]+)['"]/m)?.[1];
      }

      detected.push({
        name: "Ruby",
        category: "language",
        version: rubyVersion,
        confidence: 1.0,
        detectedFrom: "Gemfile",
      });

      const gems = parseGemfile(raw);
      for (const gem of gems) {
        const known = KNOWN_GEMS[gem];
        if (known && !detected.some((d) => d.name === known.name)) {
          detected.push({
            name: known.name,
            category: known.category,
            confidence: 1.0,
            detectedFrom: "Gemfile",
          });
        }
      }

      return detected;
    } catch {}

    // Gemfile not found but .ruby-version exists
    if (rubyVersion) {
      detected.push({
        name: "Ruby",
        category: "language",
        version: rubyVersion,
        confidence: 0.85,
        detectedFrom: ".ruby-version",
      });
    }

    return detected;
  },
};
