# claude-scout

Auto-generate a project-aware `.claude/` configuration **and** a new-developer onboarding kit for [Claude Code](https://claude.ai/code).

Scans your repository — detects the tech stack, reads `README`, `package.json`, `.env.example`, schema files, `.nvmrc`, `migrations/`, and folder structure — then produces a complete `.claude/` folder grounded in your actual code:

- `CLAUDE.md` — project overview, architecture, real commands, conventions
- `.claude/settings.json` — sensible permission allowlist for your stack
- `.claude/commands/*.md` — slash commands for every real script
- `.claude/rules/*.md` — coding rules per concern (TypeScript, database, frontend, API…)
- `.claude/skills/*/SKILL.md` — reusable workflows (add-feature, debug, write-tests, refactor)

…and, with `claude-scout onboard`, a human-readable onboarding guide:

- `ONBOARDING.md` — step-by-step setup walkthrough (prereqs, env vars, services, migrations, run/test/build, troubleshooting)
- `setup.sh` — re-runnable bash script that gets a new dev from clone to running app

## Quick start

```bash
# Generate .claude/ config for Claude Code
npx claude-scout init

# Generate ONBOARDING.md + setup.sh for new developers
npx claude-scout onboard
```

Each command runs in the current directory and writes its outputs to the project root.

## Modes

### Template mode (default)

```bash
npx claude-scout init
```

Fast, fully local, no AI. Reads your `README`, `package.json` scripts, `.env.example`, schema files, and top-level folders, and produces a config grounded in those real values.

### AI mode

```bash
npx claude-scout init --ai
```

Uses Claude to autonomously scan your project and generate a deeper, more project-specific config. Requires **one of**:

- **Claude Code CLI** installed and logged in (`claude --version`) — uses your existing login, no API key needed
- **`ANTHROPIC_API_KEY`** environment variable set

Takes 30–90 seconds. Produces richer content because Claude reads the actual code, not just the metadata.

## Options

| Flag | Description |
|---|---|
| `--path <dir>` | Target a project other than the current directory |
| `--ai` | Use Claude to generate the config (see AI mode above) |
| `--dry-run` | Print the files that would be written without writing them |
| `--force` | Overwrite an existing `.claude/` folder |

## Onboard a new developer

```bash
npx claude-scout onboard           # template mode (fast, offline)
npx claude-scout onboard --ai      # richer, project-specific guide via Claude
```

Generates `ONBOARDING.md` and an executable `setup.sh` at the project root. A new dev can then run:

```bash
git clone <repo> && cd <repo> && ./setup.sh
```

…and `setup.sh` checks prerequisites, installs dependencies, copies `.env.example` → `.env`, starts Docker services (if any), runs migrations, and verifies the build.

## Day-to-day productivity commands (new in 0.3.0)

### `commit` — generate a commit message from your staged diff

```bash
git add <files>
npx claude-scout commit            # preview the message
npx claude-scout commit --yes      # commit immediately
```

Reads recent commits to match your repo's style. Won't invent ticket numbers or co-authors.

### `pr` — generate a PR title + body from your branch diff

```bash
npx claude-scout pr                # print title + body
npx claude-scout pr --gh           # also run `gh pr create`
```

Reads `<base>...HEAD` and the branch's commits, produces a title + Summary / Notable changes / Test plan.

### `test` — scaffold tests for source files that don't have one

```bash
npx claude-scout test              # scaffold stubs for every untested file
npx claude-scout test --new        # only files added/modified on this branch
npx claude-scout test src/foo.ts   # target a single file
npx claude-scout test --ai         # let Claude write real tests instead of stubs
```

Detects Vitest/Jest/pytest/Go test from your scan and emits the right shape.

### `ci` — generate a GitHub Actions workflow for the detected stack

```bash
npx claude-scout ci                # writes .github/workflows/ci.yml
npx claude-scout ci --dry-run      # preview without writing
```

Includes service containers (Postgres / MySQL / Redis) when those databases are detected.

### `migration "<intent>"` — scaffold a migration file

```bash
npx claude-scout migration "add user deleted_at column"
```

Detects Prisma / Drizzle / TypeORM / Alembic / Sequelize / graphile-migrate and writes the file in the right place with the right shape.

### `install-hooks` — auto-suggest commit messages, flag missing tests

```bash
npx claude-scout install-hooks            # install
npx claude-scout install-hooks --uninstall
```

Installs two non-blocking git hooks: `prepare-commit-msg` pre-fills the buffer with a Claude-generated suggestion if you leave it empty, `pre-commit` warns when new source files lack a companion test.

## Scan a project without writing

```bash
npx claude-scout scan
```

Prints the detected tech stack and exits. Useful for checking what the tool sees before generating.

## Requirements

- **Node.js ≥ 20**
- For `--ai` mode: Claude Code installed *or* `ANTHROPIC_API_KEY` set

## License

MIT © Daud Ibraheem Saleem
