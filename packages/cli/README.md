# claude-scout

Auto-generate a project-aware `.claude/` configuration for [Claude Code](https://claude.ai/code).

Scans your repository — detects the tech stack, reads `README`, `package.json`, `.env.example`, schema files, and folder structure — then produces a complete `.claude/` folder grounded in your actual code:

- `CLAUDE.md` — project overview, architecture, real commands, conventions
- `.claude/settings.json` — sensible permission allowlist for your stack
- `.claude/commands/*.md` — slash commands for every real script
- `.claude/rules/*.md` — coding rules per concern (TypeScript, database, frontend, API…)
- `.claude/skills/*/SKILL.md` — reusable workflows (add-feature, debug, write-tests, refactor)

## Quick start

```bash
npx claude-scout init
```

That runs in the current directory, scans it, and writes the `.claude/` folder.

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
