import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@claude-kit/core";

/**
 * Known packages mapped to their technology info.
 * This is the "knowledge base" of the detector.
 *
 * 🧠 PATTERN: Data-driven design. Instead of if/else
 * chains, we use a lookup table. Easy to extend,
 * easy to test, easy to read.
 */
const KNOWN_PACKAGES: Record<
  string,
  {
    name: string;
    category: DetectedTech["category"];
  }
> = {
  // Frameworks
  react: { name: "React", category: "framework" },
  next: { name: "Next.js", category: "framework" },
  express: { name: "Express", category: "framework" },
  fastify: { name: "Fastify", category: "framework" },
  hono: { name: "Hono", category: "framework" },
  "@nestjs/core": { name: "NestJS", category: "framework" },
  vue: { name: "Vue.js", category: "framework" },
  svelte: { name: "Svelte", category: "framework" },
  angular: { name: "Angular", category: "framework" },

  // Databases / ORMs
  prisma: { name: "Prisma", category: "orm" },
  "@prisma/client": { name: "Prisma", category: "orm" },
  knex: { name: "Knex.js", category: "orm" },
  typeorm: { name: "TypeORM", category: "orm" },
  "drizzle-orm": { name: "Drizzle", category: "orm" },
  mongoose: { name: "Mongoose", category: "orm" },
  sequelize: { name: "Sequelize", category: "orm" },
  pg: { name: "PostgreSQL (pg)", category: "database" },
  mysql2: { name: "MySQL", category: "database" },
  mongodb: { name: "MongoDB", category: "database" },
  ioredis: { name: "Redis", category: "cache" },
  redis: { name: "Redis", category: "cache" },

  // GraphQL
  postgraphile: { name: "PostGraphile", category: "api" },
  graphql: { name: "GraphQL", category: "api" },
  "react-relay": { name: "Relay", category: "api" },
  "@apollo/client": { name: "Apollo Client", category: "api" },
  "apollo-server": { name: "Apollo Server", category: "api" },

  // Testing
  vitest: { name: "Vitest", category: "testing" },
  jest: { name: "Jest", category: "testing" },
  mocha: { name: "Mocha", category: "testing" },
  "@playwright/test": { name: "Playwright", category: "testing" },
  cypress: { name: "Cypress", category: "testing" },

  // Queue / Jobs
  bullmq: { name: "BullMQ", category: "framework" },
  bull: { name: "Bull", category: "framework" },

  // UI
  tailwindcss: { name: "Tailwind CSS", category: "ui" },
  "@shadcn/ui": { name: "shadcn/ui", category: "ui" },
  "@mui/material": { name: "Material UI", category: "ui" },
  "styled-components": { name: "styled-components", category: "ui" },

  // Linting
  eslint: { name: "ESLint", category: "linter" },
  biome: { name: "Biome", category: "linter" },
  "@biomejs/biome": { name: "Biome", category: "linter" },
  prettier: { name: "Prettier", category: "linter" },

  // Bundlers
  vite: { name: "Vite", category: "bundler" },
  webpack: { name: "Webpack", category: "bundler" },
  esbuild: { name: "esbuild", category: "bundler" },
  turbo: { name: "Turborepo", category: "bundler" },
};

export const packageJsonDetector: Detector = {
  name: "package.json",
  filePatterns: ["package.json"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const filePath = join(projectPath, "package.json");
    const detected: DetectedTech[] = [];

    try {
      const raw = await readFile(filePath, "utf-8");
      const pkg = JSON.parse(raw);

      // Merge all dependency types
      const allDeps: Record<string, string> = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      // Check each dependency against our knowledge base
      for (const [depName, version] of Object.entries(allDeps)) {
        const known = KNOWN_PACKAGES[depName];
        if (known) {
          // Avoid duplicates (e.g. prisma + @prisma/client)
          const alreadyDetected = detected.some((d) => d.name === known.name);
          if (!alreadyDetected) {
            detected.push({
              name: known.name,
              category: known.category,
              version: cleanVersion(version),
              confidence: 1.0,
              detectedFrom: "package.json",
            });
          }
        }
      }

      // Detect TypeScript
      if (allDeps["typescript"]) {
        detected.push({
          name: "TypeScript",
          category: "language",
          version: cleanVersion(allDeps["typescript"]),
          confidence: 1.0,
          detectedFrom: "package.json",
        });
      }

      // Detect package manager from packageManager field
      // or from lock files (handled by a separate detector)
    } catch (error) {
      // File doesn't exist or isn't valid JSON — that's fine,
      // just return empty. Never throw from a detector.
      return [];
    }

    return detected;
  },
};

/** Remove semver prefixes: ^1.2.3 → 1.2.3 */
function cleanVersion(version: string): string {
  return version.replace(/^[\^~>=<]+/, "");
}
