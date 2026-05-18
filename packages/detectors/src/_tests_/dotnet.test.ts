import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dotnetDetector } from "../dotnet.js";

const csproj = (framework: string, packages: string[]) => `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>${framework}</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    ${packages.map((p) => `<PackageReference Include="${p}" Version="8.0.0" />`).join("\n    ")}
  </ItemGroup>
</Project>`;

describe("dotnetDetector", () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ccc-dotnet-")); });
  afterEach(async () => { await rm(dir, { recursive: true }); });

  it("detects C# and ASP.NET Core", async () => {
    await writeFile(join(dir, "MyApp.csproj"), csproj("net8.0", ["Microsoft.AspNetCore.App"]));
    const result = await dotnetDetector.detect(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("C#");
    expect(names).toContain("ASP.NET Core");
    expect(result.find((r) => r.name === "C#")?.version).toBe("net8.0");
  });

  it("detects Entity Framework Core", async () => {
    await writeFile(
      join(dir, "App.csproj"),
      csproj("net8.0", ["Microsoft.EntityFrameworkCore", "Npgsql.EntityFrameworkCore.PostgreSQL"])
    );
    const names = (await dotnetDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("Entity Framework Core");
    expect(names).toContain("PostgreSQL (Npgsql)");
  });

  it("detects xUnit testing", async () => {
    await writeFile(join(dir, "Tests.csproj"), csproj("net8.0", ["xunit", "Microsoft.NET.Test.Sdk"]));
    const names = (await dotnetDetector.detect(dir)).map((r) => r.name);
    expect(names).toContain("xUnit");
  });

  it("detects F# from .fsproj", async () => {
    await writeFile(
      join(dir, "App.fsproj"),
      `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`
    );
    const result = await dotnetDetector.detect(dir);
    expect(result.some((r) => r.name === "F#")).toBe(true);
  });

  it("returns empty when no .csproj files", async () => {
    expect(await dotnetDetector.detect(dir)).toEqual([]);
  });
});
