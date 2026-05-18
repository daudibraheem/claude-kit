import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rustDetector } from "../rust.js";

const cargoToml = (deps: Record<string, string>) => `[package]
name = "my-app"
version = "0.1.0"
edition = "2021"

[dependencies]
${Object.entries(deps).map(([k, v]) => `${k} = "${v}"`).join("\n")}
`;

describe("rustDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-rust-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects Rust language and edition", async () => {
    await writeFile(join(dir, "Cargo.toml"), cargoToml({}));
    const result = await rustDetector.detect(dir);
    const rust = result.find((r) => r.name === "Rust");
    expect(rust).toBeDefined();
    expect(rust?.metadata?.edition).toBe("2021");
    expect(rust?.metadata?.crate).toBe("my-app");
  });

  it("detects Axum + Tokio stack", async () => {
    await writeFile(join(dir, "Cargo.toml"), cargoToml({ axum: "0.7", tokio: "1" }));
    const names = (await rustDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Axum");
    expect(names).toContain("Tokio");
  });

  it("detects Actix Web", async () => {
    await writeFile(join(dir, "Cargo.toml"), cargoToml({ "actix-web": "4" }));
    const names = (await rustDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Actix Web");
  });

  it("detects Diesel ORM", async () => {
    await writeFile(join(dir, "Cargo.toml"), cargoToml({ diesel: "2", serde: "1" }));
    const names = (await rustDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Diesel");
    expect(names).toContain("Serde");
  });

  it("returns empty when no Cargo.toml", async () => {
    expect(await rustDetector.detect(dir)).toEqual([]);
  });
});
