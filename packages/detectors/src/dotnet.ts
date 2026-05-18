import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";
import type { Detector, DetectedTech } from "@claude-kit/core";

const KNOWN_PACKAGES: Record<string, { name: string; category: DetectedTech["category"] }> = {
  // ASP.NET
  "Microsoft.AspNetCore.App": { name: "ASP.NET Core", category: "framework" },
  "Microsoft.AspNetCore.Mvc": { name: "ASP.NET Core MVC", category: "framework" },
  "Microsoft.AspNetCore.OpenApi": { name: "ASP.NET OpenAPI", category: "api" },
  "Swashbuckle.AspNetCore": { name: "Swagger / Swashbuckle", category: "api" },

  // ORM / DB
  "Microsoft.EntityFrameworkCore": { name: "Entity Framework Core", category: "orm" },
  "Microsoft.EntityFrameworkCore.SqlServer": { name: "SQL Server (EF Core)", category: "database" },
  "Npgsql.EntityFrameworkCore.PostgreSQL": { name: "PostgreSQL (Npgsql)", category: "database" },
  "Pomelo.EntityFrameworkCore.MySql": { name: "MySQL (Pomelo)", category: "database" },
  Dapper: { name: "Dapper", category: "orm" },

  // Testing
  "Microsoft.NET.Test.Sdk": { name: "MSTest", category: "testing" },
  xunit: { name: "xUnit", category: "testing" },
  "NUnit3TestAdapter": { name: "NUnit", category: "testing" },
  "FluentAssertions": { name: "FluentAssertions", category: "testing" },
  Moq: { name: "Moq", category: "testing" },

  // Messaging
  MassTransit: { name: "MassTransit", category: "framework" },
  "MediatR": { name: "MediatR", category: "framework" },
  "Hangfire": { name: "Hangfire", category: "framework" },

  // Caching
  "Microsoft.Extensions.Caching.StackExchangeRedis": { name: "Redis", category: "cache" },

  // gRPC
  "Grpc.AspNetCore": { name: "gRPC", category: "api" },
};

export const dotnetDetector: Detector = {
  name: "dotnet",
  filePatterns: ["*.csproj", "*.fsproj", "*.vbproj", "*.sln"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];

    // Find all .csproj / .fsproj files
    const projFiles = await glob("**/*.{csproj,fsproj,vbproj}", {
      cwd: projectPath,
      ignore: ["**/node_modules/**", "**/bin/**", "**/obj/**"],
      absolute: false,
      maxDepth: 4,
    });

    if (projFiles.length === 0) return [];

    let targetFramework: string | undefined;

    for (const relPath of projFiles) {
      try {
        const raw = await readFile(join(projectPath, relPath), "utf-8");

        if (!targetFramework) {
          targetFramework =
            raw.match(/<TargetFramework[s]?>([\w;.]+)<\/TargetFramework[s]?>/)?.[1]?.split(";")[0];
        }

        // Detect language from extension
        const lang = relPath.endsWith(".fsproj") ? "F#" : relPath.endsWith(".vbproj") ? "VB.NET" : "C#";
        if (!detected.some((d) => d.name === lang)) {
          detected.unshift({
            name: lang,
            category: "language",
            version: targetFramework,
            confidence: 1.0,
            detectedFrom: relPath,
            metadata: { framework: targetFramework },
          });
        }

        // Find PackageReference entries
        const pkgRefs = [...raw.matchAll(/<PackageReference\s+Include="([^"]+)"/g)];
        for (const [, pkgName] of pkgRefs) {
          if (!pkgName) continue;
          const known = KNOWN_PACKAGES[pkgName];
          if (known && !detected.some((d) => d.name === known.name)) {
            const version = raw.match(
              new RegExp(`Include="${pkgName}"[^/]*Version="([^"]+)"`)
            )?.[1];
            detected.push({
              name: known.name,
              category: known.category,
              version,
              confidence: 1.0,
              detectedFrom: relPath,
            });
          }
        }
      } catch {}
    }

    return detected;
  },
};
