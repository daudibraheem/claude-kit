import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, DetectedTech } from "@ccc/core";

const KNOWN_MODULES: Record<string, { name: string; category: DetectedTech["category"] }> = {
  "github.com/gin-gonic/gin": { name: "Gin", category: "framework" },
  "github.com/labstack/echo": { name: "Echo", category: "framework" },
  "github.com/gofiber/fiber": { name: "Fiber", category: "framework" },
  "github.com/go-chi/chi": { name: "Chi", category: "framework" },
  "github.com/gorilla/mux": { name: "Gorilla Mux", category: "framework" },
  "github.com/beego/beego": { name: "Beego", category: "framework" },
  "github.com/go-kit/kit": { name: "Go Kit", category: "framework" },

  // DB / ORM
  "gorm.io/gorm": { name: "GORM", category: "orm" },
  "github.com/jmoiron/sqlx": { name: "sqlx", category: "orm" },
  "github.com/uptrace/bun": { name: "Bun ORM", category: "orm" },
  "github.com/lib/pq": { name: "PostgreSQL (pq)", category: "database" },
  "github.com/jackc/pgx": { name: "PostgreSQL (pgx)", category: "database" },
  "go.mongodb.org/mongo-driver": { name: "MongoDB", category: "database" },
  "github.com/redis/go-redis": { name: "Redis", category: "cache" },
  "github.com/go-redis/redis": { name: "Redis", category: "cache" },

  // Messaging / async
  "github.com/nats-io/nats.go": { name: "NATS", category: "framework" },
  "github.com/segmentio/kafka-go": { name: "Kafka", category: "framework" },

  // Testing
  "github.com/stretchr/testify": { name: "Testify", category: "testing" },
  "github.com/onsi/ginkgo": { name: "Ginkgo", category: "testing" },

  // gRPC / Protobuf
  "google.golang.org/grpc": { name: "gRPC", category: "api" },
  "google.golang.org/protobuf": { name: "Protobuf", category: "api" },

  // Async / runtime
  "golang.org/x/sync": { name: "Go sync", category: "framework" },
};

export const goDetector: Detector = {
  name: "go",
  filePatterns: ["go.mod"],

  async detect(projectPath: string): Promise<DetectedTech[]> {
    const detected: DetectedTech[] = [];

    try {
      const raw = await readFile(join(projectPath, "go.mod"), "utf-8");

      // Extract module path and Go version
      const moduleMatch = raw.match(/^module\s+(\S+)/m);
      const goVersionMatch = raw.match(/^go\s+(\d+\.\d+(?:\.\d+)?)/m);

      detected.push({
        name: "Go",
        category: "language",
        version: goVersionMatch?.[1],
        confidence: 1.0,
        detectedFrom: "go.mod",
        metadata: { module: moduleMatch?.[1] },
      });

      // Extract require block
      const requireBlock = raw.match(/require\s*\(([\s\S]*?)\)/);
      const singleRequires = [...raw.matchAll(/^require\s+(\S+)\s+/gm)];

      const allDeps: string[] = [];
      if (requireBlock?.[1]) {
        allDeps.push(
          ...requireBlock[1]
            .split("\n")
            .map((l: string) => l.trim().split(/\s+/)[0] ?? "")
            .filter(Boolean)
        );
      }
      for (const m of singleRequires) {
        if (m[1]) allDeps.push(m[1]);
      }

      for (const dep of allDeps) {
        // Match both exact and prefix (e.g. github.com/gofiber/fiber/v2)
        const key = Object.keys(KNOWN_MODULES).find(
          (k) => dep === k || dep.startsWith(k + "/")
        );
        if (key) {
          const known = KNOWN_MODULES[key];
          if (known && !detected.some((d) => d.name === known.name)) {
            detected.push({
              name: known.name,
              category: known.category,
              confidence: 1.0,
              detectedFrom: "go.mod",
            });
          }
        }
      }
    } catch {
      return [];
    }

    return detected;
  },
};
