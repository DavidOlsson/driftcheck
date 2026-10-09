import { ConfigError } from "./config/config.js";
import { CLAUDE_COMMAND } from "./extract/claudeCli.js";
import { CommandNotFoundError, CommandTimeoutError, type CommandRunner } from "./io/process.js";

import type { Backend, BackendChoice } from "./model/backend.js";

const VERSION_TIMEOUT_MS = 30_000;

export async function isClaudeCodeInstalled(commands: CommandRunner): Promise<boolean> {
  try {
    return (await commands.run(CLAUDE_COMMAND, ["--version"], { timeoutMs: VERSION_TIMEOUT_MS })).exitCode === 0;
  } catch (e) {
    if (e instanceof CommandNotFoundError) return false;
    if (e instanceof CommandTimeoutError) {
      throw new ConfigError(`"${CLAUDE_COMMAND} --version" did not answer within 30 seconds. Check that Claude Code runs in a terminal.`);
    }
    throw e;
  }
}

/**
 * "auto" prefers an API key when one is set (explicit opt-in to API billing, and what CI usually has),
 * otherwise uses the installed Claude Code CLI. An explicit choice is never second-guessed.
 */
export async function selectBackend(
  choice: BackendChoice,
  env: NodeJS.ProcessEnv,
  commands: CommandRunner,
): Promise<Backend> {
  const hasKey = Boolean(env.ANTHROPIC_API_KEY);
  if (choice === "api") {
    if (!hasKey) throw new ConfigError("Backend \"api\" needs ANTHROPIC_API_KEY. Create a key at https://console.anthropic.com.");
    return "api";
  }
  const installed = await isClaudeCodeInstalled(commands);
  if (choice === "claude-code") {
    if (!installed) throw new ConfigError(`Backend "claude-code" needs the Claude Code CLI ("${CLAUDE_COMMAND}") on PATH.`);
    return "claude-code";
  }
  if (hasKey) return "api";
  if (installed) return "claude-code";
  throw new ConfigError(
    "No way to reach Claude. Either install Claude Code and log in (uses your Claude subscription), " +
      "or set ANTHROPIC_API_KEY (uses the Anthropic API).",
  );
}
