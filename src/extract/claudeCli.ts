import { z } from "zod";
import { AgentError, type Usage } from "./AgentRunner.js";
import type { CommandRunner } from "../io/process.js";

/**
 * Shared plumbing for running the user's installed Claude Code CLI in headless mode (`claude -p`).
 * This uses whatever the user is logged in with, typically their Claude subscription.
 */
export const CLAUDE_COMMAND = "claude";

export const READ_ONLY_TOOLS = "Read,Grep,Glob";

/** Tools that could change files, run code or reach the network. Explicitly denied as a second layer. */
const DENIED_TOOLS = "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task,Agent";

export interface CliRunOptions {
  cwd: string;
  systemPrompt: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  model: string;
  maxBudgetUsd: number;
  /** Comma-separated built-in tools, or "" for none. */
  tools: string;
}

/** Pure, so every security-relevant flag can be asserted in tests. */
export function buildCliArgs(options: CliRunOptions): string[] {
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(options.jsonSchema),
    "--system-prompt", options.systemPrompt,
    "--model", options.model,
    "--max-budget-usd", String(options.maxBudgetUsd),
    // Restricted mode removes command/code-running tools and WebFetch, ignores the repo's settings files
    // and confines file tools to the working directory
    "--restricted",
    "--strict-mcp-config",
    "--tools", options.tools,
    "--disallowedTools", DENIED_TOOLS,
    "--permission-mode", "dontAsk",
    "--no-session-persistence",
  ];
  if (options.tools) args.push("--allowedTools", options.tools);
  return args;
}

/**
 * The CLI must use the user's Claude Code login. If ANTHROPIC_API_KEY were passed through, it would
 * silently bill the API instead, which is exactly what this backend exists to avoid.
 */
export function cliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _ignored, ...rest } = env;
  return rest;
}

const CliResult = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).partial().optional(),
});

const ERROR_HINTS: Record<string, string> = {
  error_max_budget_usd: "it reached the budget limit. Raise maxBudgetUsd in .driftcheck/config.yml or add hints for the feature",
  error_max_turns: "it reached the turn limit. Add hints for the feature",
  error_max_structured_output_retries: "it could not produce output matching the schema",
  error_during_execution: "an error occurred while it was running",
};

export function parseCliOutput(stdout: string, stderr: string, exitCode: number, cwd: string): { output: unknown; usage: Usage } {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    const detail = (stderr || stdout).trim().split("\n").slice(-3).join(" ").slice(0, 300);
    throw new AgentError(`Claude Code in ${cwd} did not return JSON (exit code ${exitCode})${detail ? `: ${detail}` : ""}`);
  }
  const parsed = CliResult.safeParse(json);
  if (!parsed.success) throw new AgentError(`Claude Code in ${cwd} returned an unexpected result format`);
  const r = parsed.data;
  const usage: Usage = {
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    costUsd: r.total_cost_usd ?? 0,
  };
  if (r.subtype !== "success") {
    throw new AgentError(`Claude Code in ${cwd} stopped early: ${ERROR_HINTS[r.subtype] ?? r.subtype}`, usage);
  }
  if (r.is_error) throw new AgentError(`Claude Code in ${cwd} failed: ${r.result ?? "unknown error"}`, usage);
  if (r.structured_output === undefined) throw new AgentError(`Claude Code in ${cwd} finished without structured output`, usage);
  return { output: r.structured_output, usage };
}

export async function runClaudeCli(runner: CommandRunner, options: CliRunOptions): Promise<{ output: unknown; usage: Usage }> {
  const result = await runner.run(CLAUDE_COMMAND, buildCliArgs(options), {
    cwd: options.cwd,
    input: options.prompt,
    env: cliEnv(process.env),
  });
  return parseCliOutput(result.stdout, result.stderr, result.exitCode, options.cwd);
}
