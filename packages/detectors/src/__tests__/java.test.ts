import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { javaDetector } from "../java.js";

const pomXml = (javaVersion: string, sbVersion: string, extras = "") => `<?xml version="1.0"?>
<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${sbVersion}</version>
  </parent>
  <properties>
    <java.version>${javaVersion}</java.version>
  </properties>
  <dependencies>
    ${extras}
  </dependencies>
</project>`;

describe("javaDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-java-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects Java and Spring Boot from pom.xml", async () => {
    await writeFile(join(dir, "pom.xml"), pomXml("21", "3.2.5"));
    const result = await javaDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("Java");
    expect(names).toContain("Spring Boot");
    expect(result.find((r) => r.name === "Java")?.version).toBe("21");
    expect(result.find((r) => r.name === "Spring Boot")?.version).toBe("3.2.5");
  });

  it("detects Spring Web starter", async () => {
    await writeFile(
      join(dir, "pom.xml"),
      pomXml(
        "17",
        "3.1.0",
        `<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>`
      )
    );
    const names = (await javaDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Spring Web");
  });

  it("detects Java from build.gradle", async () => {
    await writeFile(
      join(dir, "build.gradle"),
      `plugins {\n  id 'org.springframework.boot' version '3.2.0'\n  id 'java'\n}\n`
    );
    const result = await javaDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("Java");
    expect(names).toContain("Spring Boot");
  });

  it("detects Kotlin from build.gradle.kts", async () => {
    await writeFile(
      join(dir, "build.gradle.kts"),
      `plugins {\n  kotlin("jvm") version "1.9.0"\n  id("org.springframework.boot") version "3.2.0"\n}\n`
    );
    const names = (await javaDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Kotlin");
  });

  it("returns empty when no build files", async () => {
    expect(await javaDetector.detect(dir)).toEqual([]);
  });
});
