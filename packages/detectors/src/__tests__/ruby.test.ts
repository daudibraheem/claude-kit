import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rubyDetector } from "../ruby.js";

describe("rubyDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-ruby-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects Ruby on Rails from Gemfile", async () => {
    await writeFile(
      join(dir, "Gemfile"),
      `source "https://rubygems.org"\nruby "3.3.0"\ngem "rails", "~> 7.1"\ngem "pg"\n`
    );
    const result = await rubyDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("Ruby");
    expect(names).toContain("Ruby on Rails");
    expect(names).toContain("PostgreSQL (pg)");
    expect(result.find((r) => r.name === "Ruby")?.version).toBe("3.3.0");
  });

  it("detects Sinatra + Sidekiq", async () => {
    await writeFile(join(dir, "Gemfile"), `gem "sinatra"\ngem "sidekiq"\n`);
    const names = (await rubyDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Sinatra");
    expect(names).toContain("Sidekiq");
  });

  it("detects RSpec", async () => {
    await writeFile(join(dir, "Gemfile"), `gem "rspec"\n`);
    const names = (await rubyDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("RSpec");
  });

  it("reads version from .ruby-version", async () => {
    await writeFile(join(dir, ".ruby-version"), "3.2.4\n");
    await writeFile(join(dir, "Gemfile"), `gem "rails"\n`);
    const result = await rubyDetector.detect(dir);
    expect(result.find((r) => r.name === "Ruby")?.version).toBe("3.2.4");
  });

  it("returns empty when no Gemfile or .ruby-version", async () => {
    expect(await rubyDetector.detect(dir)).toEqual([]);
  });
});
