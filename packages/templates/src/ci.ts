import type { ScanResult, DetectedTech } from "@claude-scout/core";
import { enrichProject } from "./enrich.js";

export interface GeneratedCi {
  /** Path relative to project root, e.g. ".github/workflows/ci.yml" */
  path: string;
  content: string;
}

/**
 * Generate a GitHub Actions CI workflow tailored to the detected stack.
 *
 * Design choice: stay conservative. One workflow with one job that runs the
 * project's real scripts in order. No matrices, no caching cleverness beyond
 * the official setup-actions. A baseline most teams can extend.
 */
export async function generateCi(scan: ScanResult): Promise<GeneratedCi> {
  const enr = await enrichProject(scan);
  const t = scan.technologies;
  const f = stackFlags(t);
  const hasJsPm = scan.packageManager !== "unknown";
  const pm = hasJsPm ? scan.packageManager : "npm";
  const scripts = new Set(Object.keys(enr.scripts));

  const lines: string[] = [];
  lines.push("name: CI");
  lines.push("");
  lines.push("on:");
  lines.push("  push:");
  lines.push("    branches: [main, master]");
  lines.push("  pull_request:");
  lines.push("");
  lines.push("jobs:");
  lines.push("  ci:");
  lines.push("    runs-on: ubuntu-latest");

  // ── Services ──────────────────────────────────────────────────────────────
  const services = pickServices(t);
  if (services.length > 0) {
    lines.push("    services:");
    for (const svc of services) {
      lines.push(`      ${svc.name}:`);
      lines.push(`        image: ${svc.image}`);
      if (svc.env.length > 0) {
        lines.push("        env:");
        for (const [k, v] of svc.env) lines.push(`          ${k}: ${v}`);
      }
      if (svc.ports.length > 0) {
        lines.push("        ports:");
        for (const p of svc.ports) lines.push(`          - ${p}`);
      }
      if (svc.optionsHealth) {
        lines.push(`        options: >-`);
        lines.push(`          ${svc.optionsHealth}`);
      }
    }
  }

  // ── Steps ─────────────────────────────────────────────────────────────────
  lines.push("    steps:");
  lines.push("      - uses: actions/checkout@v4");

  if (hasJsPm || scan.hasTypeScript || f.hasNextJs) {
    if (pm === "pnpm") {
      lines.push("      - uses: pnpm/action-setup@v4");
    }
    lines.push("      - uses: actions/setup-node@v4");
    lines.push("        with:");
    lines.push(enr.hasNvmrc ? "          node-version-file: .nvmrc" : "          node-version: 20");
    if (pm === "npm" || pm === "yarn" || pm === "pnpm") {
      lines.push(`          cache: ${pm}`);
    }
    lines.push(`      - run: ${pm} install${pm === "npm" ? " --no-audit --no-fund" : pm === "pnpm" ? " --frozen-lockfile" : ""}`);
  }

  if (f.hasPython) {
    lines.push("      - uses: actions/setup-python@v5");
    lines.push("        with:");
    lines.push("          python-version: '3.11'");
    if (has(t, "Poetry")) {
      lines.push("      - run: pipx install poetry");
      lines.push("      - run: poetry install --no-interaction");
    } else {
      lines.push("      - run: pip install -r requirements.txt");
    }
  }

  if (f.hasGo) {
    lines.push("      - uses: actions/setup-go@v5");
    lines.push("        with:");
    lines.push("          go-version: '1.22'");
    lines.push("          cache: true");
    lines.push("      - run: go mod download");
  }

  if (f.hasRust) {
    lines.push("      - uses: dtolnay/rust-toolchain@stable");
    lines.push("      - uses: Swatinem/rust-cache@v2");
  }

  if (f.hasJava) {
    lines.push("      - uses: actions/setup-java@v4");
    lines.push("        with:");
    lines.push("          distribution: temurin");
    lines.push("          java-version: '17'");
    lines.push("          cache: " + (has(t, "Gradle") ? "gradle" : "maven"));
  }

  // ── Real scripts in a sensible order ──────────────────────────────────────
  const stepsToRun: Array<{ label: string; cmd: string }> = [];

  if (scripts.has("lint")) stepsToRun.push({ label: "Lint", cmd: `${pm} run lint` });
  if (scripts.has("typecheck")) stepsToRun.push({ label: "Typecheck", cmd: `${pm} run typecheck` });
  if (scripts.has("build")) stepsToRun.push({ label: "Build", cmd: `${pm} run build` });
  else if (f.hasGo) stepsToRun.push({ label: "Build", cmd: "go build ./..." });
  else if (f.hasRust) stepsToRun.push({ label: "Build", cmd: "cargo build --release" });
  else if (f.hasJava) stepsToRun.push({ label: "Build", cmd: has(t, "Gradle") ? "./gradlew build -x test" : "./mvnw -B package -DskipTests" });

  if (scripts.has("test")) stepsToRun.push({ label: "Test", cmd: `${pm} test` });
  else if (has(t, "pytest")) stepsToRun.push({ label: "Test", cmd: "pytest -v" });
  else if (f.hasGo) stepsToRun.push({ label: "Test", cmd: "go test ./... -v" });
  else if (f.hasRust) stepsToRun.push({ label: "Test", cmd: "cargo test" });
  else if (f.hasJava) stepsToRun.push({ label: "Test", cmd: has(t, "Gradle") ? "./gradlew test" : "./mvnw test" });

  for (const step of stepsToRun) {
    lines.push(`      - name: ${step.label}`);
    lines.push(`        run: ${step.cmd}`);
  }

  if (stepsToRun.length === 0) {
    lines.push("      - name: Nothing to run yet");
    lines.push("        run: echo \"No test/build/lint script detected — fill in steps for this stack.\"");
  }

  return {
    path: ".github/workflows/ci.yml",
    content: lines.join("\n") + "\n",
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

interface ServiceSpec {
  name: string;
  image: string;
  env: Array<[string, string]>;
  ports: string[];
  optionsHealth?: string;
}

function pickServices(t: DetectedTech[]): ServiceSpec[] {
  const out: ServiceSpec[] = [];
  for (const tech of t) {
    if (tech.category !== "database") continue;
    const n = tech.name.toLowerCase();
    if (n.includes("postgres")) {
      out.push({
        name: "postgres",
        image: "postgres:16",
        env: [["POSTGRES_USER", "postgres"], ["POSTGRES_PASSWORD", "postgres"], ["POSTGRES_DB", "test"]],
        ports: ["5432:5432"],
        optionsHealth: "--health-cmd=\"pg_isready\" --health-interval=10s --health-timeout=5s --health-retries=5",
      });
    } else if (n.includes("mysql") || n.includes("mariadb")) {
      out.push({
        name: "mysql",
        image: "mysql:8",
        env: [["MYSQL_ROOT_PASSWORD", "root"], ["MYSQL_DATABASE", "test"]],
        ports: ["3306:3306"],
        optionsHealth: "--health-cmd=\"mysqladmin ping -h 127.0.0.1\" --health-interval=10s --health-timeout=5s --health-retries=5",
      });
    } else if (n.includes("redis")) {
      out.push({
        name: "redis",
        image: "redis:7",
        env: [],
        ports: ["6379:6379"],
        optionsHealth: "--health-cmd=\"redis-cli ping\" --health-interval=10s --health-timeout=5s --health-retries=5",
      });
    }
  }
  return out;
}

interface StackFlags {
  hasNextJs: boolean; hasPython: boolean; hasGo: boolean;
  hasRust: boolean; hasJava: boolean; hasDotnet: boolean;
}

function stackFlags(t: DetectedTech[]): StackFlags {
  return {
    hasNextJs: has(t, "Next.js"),
    hasPython: has(t, "Python"),
    hasGo:     has(t, "Go"),
    hasRust:   has(t, "Rust"),
    hasJava:   has(t, "Java") || has(t, "Spring Boot"),
    hasDotnet: has(t, "C#") || has(t, "F#"),
  };
}

function has(t: DetectedTech[], name: string): boolean {
  return t.some((x) => x.name === name);
}
