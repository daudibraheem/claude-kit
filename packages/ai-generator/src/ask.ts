import { execSync, spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";

export interface AskOptions {
  /** Working directory for the Claude CLI (so it can Read/Glob the project) */
  cwd?: string;
  /** Tools the Claude CLI may use. Defaults to read-only exploration. */
  allowedTools?: string[];
  /** Timeout for the CLI strategy, in ms. Default 5 min. */
  timeoutMs?: number;
  /** Anthropic model id. Default sonnet 4-6 — fast enough, cheap enough. */
  model?: string;
  /** Max tokens for the API fallback. Default 2000. */
  maxTokens?: number;
  /** Progress callback — receives status strings during the call. */
  onProgress?: (msg: string) => void;
}

/**
 * Ask Claude a single prompt and get a plain string back.
 *
 * Strategy:
 *   1. If `claude` is on PATH, use the Claude Code CLI (the user's existing
 *      login — no key needed). It can use read-only tools to explore the
 *      project. This is the fastest, free-to-the-user path.
 *   2. Otherwise, fall back to the Anthropic SDK if ANTHROPIC_API_KEY is set.
 *
 * Throws a single error with both attempts' details if neither works.
 */
export async function askClaude(prompt: string, options: AskOptions = {}): Promise<string> {
  const {
    cwd = process.cwd(),
    allowedTools = ["Read", "Glob", "Grep", "LS"],
    timeoutMs = 5 * 60 * 1000,
    model = "claude-sonnet-4-6",
    maxTokens = 2000,
    onProgress,
  } = options;
  const report = (msg: string) => onProgress?.(msg);

  const claudePath = findCLI();
  let cliError: string | null = null;

  if (claudePath) {
    try {
      report("Asking Claude (CLI)…");
      const out = await askViaCLI(claudePath, prompt, { cwd, allowedTools, timeoutMs, model, onProgress });
      return out.trim();
    } catch (err) {
      cliError = (err as Error).message;
      report("CLI failed — falling back to API…");
    }
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    const cliDetail = cliError
      ? `\nCLI error:\n${cliError}\n`
      : claudePath
        ? "\nClaude Code found but failed.\n"
        : "\nClaude Code CLI not found in PATH.\n";
    throw new Error(
      `No AI strategy available.${cliDetail}\n` +
      "Option 1: Install Claude Code (https://claude.ai/code) and run `claude login`\n" +
      "Option 2: Set ANTHROPIC_API_KEY — export ANTHROPIC_API_KEY=sk-ant-...",
    );
  }

  report("Calling Anthropic API…");
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();
}

function findCLI(): string | null {
  try {
    const p = execSync("which claude", { stdio: "pipe", encoding: "utf-8" }).trim();
    return p || null;
  } catch {
    return null;
  }
}

function askViaCLI(
  claudePath: string,
  prompt: string,
  options: { cwd: string; allowedTools: string[]; timeoutMs: number; model: string; onProgress?: (msg: string) => void },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      claudePath,
      [
        "-p",
        "--dangerously-skip-permissions",
        "--model", options.model,
        "--add-dir", options.cwd,
        "--allowedTools", ...options.allowedTools,
      ],
      {
        env: process.env,
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      options.onProgress?.(`Claude is working (${stdout.length} bytes received)…`);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude CLI timed out after ${options.timeoutMs / 1000} s\nstderr tail: ${stderr.slice(-300)}`));
    }, options.timeoutMs);

    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Claude CLI exited ${code}\nstderr: ${stderr.slice(0, 400)}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt, "utf-8");
    child.stdin.end();
  });
}
