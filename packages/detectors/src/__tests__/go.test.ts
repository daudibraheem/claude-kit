import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { goDetector } from "../go.js";

const goMod = (deps: string[]) => `module github.com/example/app

go 1.22.0

require (
${deps.map((d) => `\t${d} v0.0.0`).join("\n")}
)
`;

describe("goDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-go-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects Go language and version", async () => {
    await writeFile(join(dir, "go.mod"), goMod([]));
    const result = await goDetector.detect(dir);
    const go = result.find((r) => r.name === "Go");
    expect(go).toBeDefined();
    expect(go?.version).toBe("1.22.0");
    expect(go?.metadata?.module).toBe("github.com/example/app");
  });

  it("detects Gin framework", async () => {
    await writeFile(join(dir, "go.mod"), goMod(["github.com/gin-gonic/gin"]));
    const names = (await goDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Gin");
  });

  it("detects Fiber (versioned module path)", async () => {
    await writeFile(join(dir, "go.mod"), goMod(["github.com/gofiber/fiber/v2"]));
    const names = (await goDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Fiber");
  });

  it("detects GORM + PostgreSQL", async () => {
    await writeFile(
      join(dir, "go.mod"),
      goMod(["gorm.io/gorm", "github.com/jackc/pgx/v5"])
    );
    const names = (await goDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("GORM");
    expect(names).toContain("PostgreSQL (pgx)");
  });

  it("returns empty when no go.mod", async () => {
    expect(await goDetector.detect(dir)).toEqual([]);
  });
});
