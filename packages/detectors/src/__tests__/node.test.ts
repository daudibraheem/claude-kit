import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nodeDetector } from "../node.js";

describe("nodeDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-node-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects version from .nvmrc", async () => {
    await writeFile(join(dir, ".nvmrc"), "20.11.0\n");
    const [r] = await nodeDetector.detect(dir);
    expect(r!.name).toBe("Node.js");
    expect(r!.version).toBe("20.11.0");
    expect(r!.detectedFrom).toBe(".nvmrc");
    expect(r!.confidence).toBe(1.0);
  });

  it("strips leading v from .nvmrc", async () => {
    await writeFile(join(dir, ".nvmrc"), "v18.20.2\n");
    const [r] = await nodeDetector.detect(dir);
    expect(r!.version).toBe("18.20.2");
  });

  it("detects version from .node-version", async () => {
    await writeFile(join(dir, ".node-version"), "v20.0.0\n");
    const [r] = await nodeDetector.detect(dir);
    expect(r!.name).toBe("Node.js");
    expect(r!.version).toBe("20.0.0");
    expect(r!.detectedFrom).toBe(".node-version");
  });

  it("prefers .nvmrc over .node-version", async () => {
    await writeFile(join(dir, ".nvmrc"), "20.0.0");
    await writeFile(join(dir, ".node-version"), "18.0.0");
    const [r] = await nodeDetector.detect(dir);
    expect(r!.detectedFrom).toBe(".nvmrc");
    expect(r!.version).toBe("20.0.0");
  });

  it("detects version from package.json engines.node", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ engines: { node: ">=20.0.0" } }));
    const [r] = await nodeDetector.detect(dir);
    expect(r!.name).toBe("Node.js");
    expect(r!.version).toBe("20.0.0");
    expect(r!.detectedFrom).toBe("package.json#engines");
  });

  it("detects Node.js at lower confidence from bare package.json", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "my-app" }));
    const [r] = await nodeDetector.detect(dir);
    expect(r!.name).toBe("Node.js");
    expect(r!.version).toBeUndefined();
    expect(r!.confidence).toBe(0.8);
  });

  it("returns empty when no node files", async () => {
    expect(await nodeDetector.detect(dir)).toEqual([]);
  });
});
