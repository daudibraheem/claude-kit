# claude-scout

Auto-generate a `.claude/` configuration folder for any software project. Scans your stack and produces a tailored [Claude Code](https://claude.ai/code) setup — including `CLAUDE.md`, settings, slash commands, coding rules, and reusable skills.

## Quick start

```bash
npx claude-scout init
```

Or install globally:

```bash
npm install -g claude-scout
claude-scout init
```

## What gets generated

```
your-project/
├── CLAUDE.md                         # Project context loaded by every Claude session
└── .claude/
    ├── settings.json                 # Model, permissions, allowed tools
    ├── settings.local.json           # Local overrides (gitignored automatically)
    ├── commands/
    │   ├── dev.md                    # /dev  — start dev server
    │   ├── test.md                   # /test — run test suite
    │   ├── build.md                  # /build
    │   └── ...                       # stack-specific: migrate, lint, seed, etc.
    ├── rules/
    │   ├── git.md                    # Commit conventions
    │   ├── typescript.md             # TS rules (if detected)
    │   ├── database.md               # Schema & migration rules (if ORM detected)
    │   └── ...
    └── skills/
        ├── add-feature/SKILL.md      # Guided workflow for adding features
        ├── debug/SKILL.md
        ├── write-tests/SKILL.md
        └── refactor/SKILL.md
```

## Commands

### `init` — scan and generate

```bash
claude-scout init [options]
```

| Option | Description |
|--------|-------------|
| `--path <dir>` | Project to scan (default: current directory) |
| `--ai` | Use Claude to deeply analyse source code and generate richer, project-specific config |
| `--force` | Overwrite an existing `.claude/` folder |
| `--dry-run` | Preview files without writing anything |

### `onboard` — generate a developer onboarding guide

```bash
claude-scout onboard [options]
```

Generates two files at the project root so new developers can get a working environment in minutes:

- **`ONBOARDING.md`** — step-by-step walkthrough: prerequisites, install, env vars, services, migrations, run/test/build commands, project layout, and troubleshooting.
- **`setup.sh`** — re-runnable bash script that checks prereqs, installs dependencies, copies `.env.example` → `.env`, starts Docker services, runs migrations, and verifies the build.

```bash
# Generate from the detected stack (fast, offline)
claude-scout onboard

# Use Claude to read your project and produce a richer, project-specific guide
claude-scout onboard --ai
```

| Option | Description |
|--------|-------------|
| `--path <dir>` | Project to scan (default: current directory) |
| `--ai` | Use Claude to read source files and produce a project-specific guide |
| `--force` | Overwrite existing `ONBOARDING.md` / `setup.sh` |
| `--dry-run` | Preview what would be written, no files touched |

A new developer can then onboard with a single command:

```bash
git clone <repo> && cd <repo> && ./setup.sh
```

### Productivity commands (0.3.0+)

| Command | What it does |
|---|---|
| `claude-scout commit` | Generate a commit message from your staged diff in the repo's style (`--yes` commits immediately) |
| `claude-scout pr` | Generate a PR title + body from `<base>...HEAD` (`--gh` runs `gh pr create`) |
| `claude-scout test [--new\|<file>] [--ai]` | Scaffold test files for source files that don't have one |
| `claude-scout ci` | Generate `.github/workflows/ci.yml` for the detected stack (includes service containers for detected databases) |
| `claude-scout migration "<intent>"` | Scaffold a migration file in the right place for the detected ORM |
| `claude-scout install-hooks` | Install non-blocking git hooks: pre-fill empty commit messages, flag new source files without tests |

All commands are template-mode by default. `test`, `commit`, and `pr` use Claude — either via your existing Claude Code login (preferred, no API key) or via `ANTHROPIC_API_KEY`.

### `scan` — inspect detected stack

```bash
claude-scout scan --path /your/project
```

Prints detected technologies grouped by category, with versions and confidence scores. Useful for verifying what the tool sees before running `init`.

## Template mode (default)

Without `--ai`, the tool uses your detected tech stack to fill pre-built templates — fast and offline, no API key needed.

```bash
claude-scout init --path /your/project
```

## AI mode (`--ai`)

With `--ai`, the tool reads your actual source files and asks Claude to generate deeply project-specific config: real table names in rules, real script names in commands, real folder conventions in skills.

```bash
claude-scout init --ai
```

**No API key required if you have Claude Code installed** — it uses your existing login.

If Claude Code CLI is not installed, set `ANTHROPIC_API_KEY` as a fallback:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
claude-scout init --ai
```

### Authentication options (AI mode)

| Method | How |
|--------|-----|
| Claude Code CLI (preferred) | Install [Claude Code](https://claude.ai/code), run `claude login` |
| Anthropic API key | `export ANTHROPIC_API_KEY=sk-ant-...` |

### Cost estimate

AI mode reads up to ~80 000 characters of your project files and sends them to Claude Opus. Typical cost: **$0.02–$0.15 per run** depending on project size. The Claude Code CLI method uses your existing Claude plan — no additional API charges.

### Template mode vs AI mode

| | Template | AI (`--ai`) |
|---|---|---|
| Speed | < 1 s | 30–90 s |
| API key | Not needed | Optional (CLI login works) |
| Config quality | Stack-aware from templates | Project-specific from source code |
| Table/model names | Generic | Real names from your schema |
| Command scripts | Inferred from stack | Exact scripts from your package.json |

## Detected ecosystems

| Category | Technologies |
|----------|-------------|
| Languages | TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, F#, Ruby |
| Frameworks | Next.js, React, Vue, Angular, Express, FastAPI, Django, Flask, Spring Boot, Rails, Axum, Gin, Fiber |
| Databases / ORMs | Prisma, Drizzle, Sequelize, TypeORM, SQLAlchemy, Diesel, sqlx, Hibernate, ActiveRecord |
| Testing | Vitest, Jest, Pytest, Go test, Cargo test, RSpec, xUnit |
| CI/CD | GitHub Actions, CircleCI, GitLab CI, Jenkins, Travis CI, Azure DevOps |
| Infrastructure | Docker, docker-compose |
| Monorepos | Turborepo, Nx, Lerna, pnpm workspaces, Rush |
| Package managers | pnpm, yarn, npm, bun, pip, Poetry, Cargo, Go modules, Bundler, Maven, Gradle |

## Monorepo support

The tool detects monorepo setups (Turborepo, Nx, pnpm workspaces, etc.) and sets `monorepo: true` in the scan result. Generated config references the detected workspace tooling.

## Development

```bash
pnpm install
pnpm build        # build all packages
pnpm test         # run all tests
```

### Package structure

```
packages/
├── core/          # Shared types (ScanResult, GeneratedConfig, ProjectContext, ...)
├── detectors/     # Tech-stack detectors + context builder
├── templates/     # Project-aware config generation (reads README, scripts, .env, schema)
├── ai-generator/  # Claude-powered config generation (CLI + API strategies)
└── cli/           # Commander.js CLI entrypoint
```

## License

MIT
