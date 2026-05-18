import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@claude-kit/core";

const SPRING_STARTERS: Record<string, string> = {
  "spring-boot-starter-web": "Spring Web",
  "spring-boot-starter-data-jpa": "Spring Data JPA",
  "spring-boot-starter-security": "Spring Security",
  "spring-boot-starter-webflux": "Spring WebFlux",
  "spring-boot-starter-data-mongodb": "Spring Data MongoDB",
  "spring-boot-starter-data-redis": "Spring Data Redis",
  "spring-boot-starter-amqp": "Spring AMQP",
  "spring-boot-starter-test": "Spring Test",
};

export const javaDetector: Detector = {
  name: "java",
  filePatterns: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];

    // --- Maven (pom.xml) ---
    try {
      const raw = await readFile(join(projectPath, "pom.xml"), "utf-8");

      // Java version
      const javaVersion =
        raw.match(/<java\.version>([\d.]+)<\/java\.version>/)?.[1] ??
        raw.match(/<maven\.compiler\.source>([\d.]+)<\/maven\.compiler\.source>/)?.[1];

      // Spring Boot version
      const sbVersion = raw.match(
        /<parent>[\s\S]*?<artifactId>spring-boot-starter-parent<\/artifactId>[\s\S]*?<version>([\d.]+)<\/version>/
      )?.[1];

      detected.push({
        name: "Java",
        category: "language",
        version: javaVersion,
        confidence: 1.0,
        detectedFrom: "pom.xml",
        metadata: { build: "Maven" },
      });

      if (sbVersion) {
        detected.push({
          name: "Spring Boot",
          category: "framework",
          version: sbVersion,
          confidence: 1.0,
          detectedFrom: "pom.xml",
        });
      }

      // Spring starters
      for (const [artifactId, label] of Object.entries(SPRING_STARTERS)) {
        if (raw.includes(`<artifactId>${artifactId}</artifactId>`)) {
          detected.push({
            name: label,
            category: "framework",
            confidence: 1.0,
            detectedFrom: "pom.xml",
          });
        }
      }

      // Hibernate
      if (raw.includes("hibernate-core") || raw.includes("spring-boot-starter-data-jpa")) {
        if (!detected.some((d) => d.name === "Hibernate")) {
          detected.push({ name: "Hibernate", category: "orm", confidence: 0.9, detectedFrom: "pom.xml" });
        }
      }

      return detected;
    } catch {}

    // --- Gradle (build.gradle or build.gradle.kts) ---
    for (const gradleFile of ["build.gradle", "build.gradle.kts"]) {
      try {
        const raw = await readFile(join(projectPath, gradleFile), "utf-8");

        detected.push({
          name: "Java",
          category: "language",
          confidence: 0.9,
          detectedFrom: gradleFile,
          metadata: { build: "Gradle" },
        });

        if (raw.includes("org.springframework.boot")) {
          const version = raw.match(/id\s*[\("']org\.springframework\.boot[\)"']\s+version\s+[\'"]([\d.]+)['"]/)?.[1];
          detected.push({
            name: "Spring Boot",
            category: "framework",
            version,
            confidence: 1.0,
            detectedFrom: gradleFile,
          });
        }

        if (raw.includes("kotlin(")) {
          detected.push({ name: "Kotlin", category: "language", confidence: 1.0, detectedFrom: gradleFile });
        }

        return detected;
      } catch {}
    }

    return detected;
  },
};
