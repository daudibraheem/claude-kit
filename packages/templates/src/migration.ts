import type { ScanResult, DetectedTech } from "@claude-scout/core";

export interface MigrationOptions {
  /** Human-readable description, e.g. "add user deleted_at" */
  intent: string;
}

export interface GeneratedMigration {
  /** What ORM/system this targets, e.g. "Prisma", "Alembic", "graphile-migrate" */
  system: string;
  /** Files to write — usually one, occasionally two (up + down) */
  files: Array<{ path: string; content: string }>;
  /** Optional follow-up command the dev should run (e.g. "pnpm prisma migrate dev") */
  followUp?: string;
}

export function generateMigration(scan: ScanResult, options: MigrationOptions): GeneratedMigration {
  const t = scan.technologies;
  const slug = slugify(options.intent);
  const timestamp = timestampNow();

  if (has(t, "Prisma")) return prismaMigration(timestamp, slug, options.intent);
  if (has(t, "Drizzle")) return drizzleMigration(timestamp, slug, options.intent);
  if (has(t, "TypeORM")) return typeormMigration(timestamp, slug, options.intent);
  if (has(t, "Alembic")) return alembicMigration(timestamp, slug, options.intent);
  if (has(t, "Sequelize")) return sequelizeMigration(timestamp, slug, options.intent);

  // graphile-migrate writes to migrations/current.sql then commits to
  // migrations/committed/. If we see a migrations/ folder but no recognised
  // ORM, prefer the graphile-migrate workflow.
  return graphileOrGenericMigration(slug, options.intent);
}

// ─── Per-ORM generators ──────────────────────────────────────────────────────

function prismaMigration(timestamp: string, slug: string, intent: string): GeneratedMigration {
  const folder = `prisma/migrations/${timestamp}_${slug}`;
  return {
    system: "Prisma",
    files: [{
      path: `${folder}/migration.sql`,
      content:
`-- Migration: ${intent}
-- Created: ${new Date().toISOString()}
--
-- Fill in the SQL below. Prisma normally generates this for you from a
-- schema diff — only hand-write it if you need raw SQL the generator
-- can't produce.

-- TODO: write the schema change here.
`,
    }],
    followUp: "Edit prisma/schema.prisma to match, then run `prisma migrate dev` to verify.",
  };
}

function drizzleMigration(timestamp: string, slug: string, intent: string): GeneratedMigration {
  return {
    system: "Drizzle",
    files: [{
      path: `drizzle/${timestamp}_${slug}.sql`,
      content:
`-- Migration: ${intent}
-- Created: ${new Date().toISOString()}
--
-- Drizzle usually generates SQL from schema.ts via \`drizzle-kit generate\`.
-- Use this hand-written file only when you need raw SQL the generator skips.

-- TODO: write the schema change here.
`,
    }],
    followUp: "Update src/db/schema.ts (or your schema file), then run `drizzle-kit generate` to keep things in sync.",
  };
}

function typeormMigration(timestamp: string, slug: string, intent: string): GeneratedMigration {
  const className = pascalCase(slug) + timestamp;
  return {
    system: "TypeORM",
    files: [{
      path: `src/migrations/${timestamp}-${slug}.ts`,
      content:
`import { MigrationInterface, QueryRunner } from "typeorm";

// ${intent}
export class ${className} implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // TODO: forward migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // TODO: rollback — must restore the prior schema exactly
  }
}
`,
    }],
    followUp: "Run `typeorm migration:run` to apply, or use your project's migrate script.",
  };
}

function alembicMigration(timestamp: string, slug: string, intent: string): GeneratedMigration {
  const revId = timestamp.slice(-12);
  return {
    system: "Alembic",
    files: [{
      path: `alembic/versions/${revId}_${slug}.py`,
      content:
`"""${intent}

Revision ID: ${revId}
Revises:
Create Date: ${new Date().toISOString()}
"""
from alembic import op
import sqlalchemy as sa


revision = "${revId}"
down_revision = None  # TODO: set to the previous revision id
branch_labels = None
depends_on = None


def upgrade() -> None:
    # TODO: forward migration
    pass


def downgrade() -> None:
    # TODO: rollback
    pass
`,
    }],
    followUp: "Set down_revision to the prior revision id, then `alembic upgrade head`.",
  };
}

function sequelizeMigration(timestamp: string, slug: string, intent: string): GeneratedMigration {
  return {
    system: "Sequelize",
    files: [{
      path: `migrations/${timestamp}-${slug}.js`,
      content:
`"use strict";

// ${intent}
module.exports = {
  async up(queryInterface, Sequelize) {
    // TODO: forward migration
  },

  async down(queryInterface, Sequelize) {
    // TODO: rollback
  },
};
`,
    }],
    followUp: "Run `sequelize-cli db:migrate` to apply.",
  };
}

/**
 * graphile-migrate convention: write current SQL to `migrations/current.sql`,
 * then commit it via `graphile-migrate commit` which moves it into
 * `migrations/committed/`. We append a header to current.sql so the dev knows
 * what they were doing if they come back later.
 */
function graphileOrGenericMigration(slug: string, intent: string): GeneratedMigration {
  return {
    system: "graphile-migrate / generic SQL",
    files: [{
      path: "migrations/current.sql",
      content:
`-- Migration: ${intent}
-- Slug: ${slug}
-- Created: ${new Date().toISOString()}
--
-- graphile-migrate convention: write your forward SQL below, run
-- \`graphile-migrate watch\` (or \`pnpm migrate\`) to apply it iteratively,
-- then \`graphile-migrate commit\` to move it into migrations/committed/.

-- TODO: write the schema change here.
`,
    }],
    followUp: "Run your migrate script to apply current.sql, then `graphile-migrate commit` once it's correct.",
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "migration";
}

function pascalCase(s: string): string {
  return s.split(/[_-]/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
}

function timestampNow(): string {
  // Compact UTC timestamp: YYYYMMDDHHMMSS — matches what most ORMs produce.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

function has(t: DetectedTech[], name: string): boolean {
  return t.some((x) => x.name === name);
}
