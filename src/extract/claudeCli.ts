import { z } from "zod";
import { AgentError, READ_ONLY_TOOLS, type PlanUsage, type PlanWindow, type Usage } from "./AgentRunner.js";
import { CommandNotFoundError, CommandTimeoutError, type CommandRunner } from "../io/process.js";

/**
 * Shared plumbing for running the user's installed Claude Code CLI in headless mode (`claude -p`).
 * This uses whatever the user is logged in with, typically their Claude subscription.
 */
export const CLAUDE_COMMAND = "claude";

/** The shared read-only tool list in the CLI's comma-separated form. */
export const READ_ONLY_TOOLS_ARG = READ_ONLY_TOOLS.join(",");

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
  /** Wall-clock limit for the whole run; the budget limit does not help when the CLI hangs. */
  timeoutMs: number;
}

/** Agent runs read a lot of code; a healthy one finishes well within this. */
export const AGENT_TIMEOUT_MS = 30 * 60_000;

/** A single tool-less call. */
export const TOOLLESS_TIMEOUT_MS = 10 * 60_000;

/** Pure, so every security-relevant flag can be asserted in tests. */
export function buildCliArgs(options: CliRunOptions): string[] {
  const args = [
    "-p",
    // stream-json (which requires --verbose with -p) also carries the plan rate-limit events
    "--output-format", "stream-json",
    "--verbose",
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
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number(),
      cache_read_input_tokens: z.number(),
    })
    .partial()
    .optional(),
});

const ERROR_HINTS: Record<string, string> = {
  error_max_budget_usd: "it reached the budget limit. Raise maxBudgetUsd in .driftcheck/config.yml or add hints for the feature",
  error_max_turns: "it reached the turn limit. Add hints for the feature",
  error_max_structured_output_retries: "it could not produce output matching the schema",
  error_during_execution: "an error occurred while it was running",
};

/** Login problems are the most common first-run failure, so they get a concrete next step. */
export function withLoginHint(message: string): string {
  return /401|authenticat|log ?in|oauth/i.test(message)
    ? `${message} Run "claude" in a terminal and log in (/login), then try again.`
    : message;
}

const RateLimitEvent = z.object({
  type: z.literal("rate_limit_event"),
  rate_limit_info: z
    .object({
      status: z.enum(["allowed", "allowed_warning", "rejected"]),
      rateLimitType: z.string(),
      utilization: z.number(),
      surpassedThreshold: z.number(),
      resetsAt: z.number(),
    })
    .partial(),
});

/** Claude Code reports utilization either as a fraction or as a percentage; normalize to 0–100. */
function toPercent(utilization: number | undefined): number | undefined {
  if (utilization === undefined) return undefined;
  return Math.round(utilization <= 1 ? utilization * 100 : utilization);
}

/** resetsAt is a Unix timestamp; accept seconds or milliseconds. */
function toIso(resetsAt: number | undefined): string | undefined {
  if (resetsAt === undefined) return undefined;
  return new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString();
}

/** Keeps the last reported state of the 5-hour and weekly windows from a stream of events. */
export function planUsageFromEvents(events: unknown[]): PlanUsage | undefined {
  const plan: PlanUsage = {};
  for (const event of events) {
    const parsed = RateLimitEvent.safeParse(event);
    if (!parsed.success) continue;
    const info = parsed.data.rate_limit_info;
    const window: PlanWindow = {
      ...(info.status !== undefined && { status: info.status }),
      ...(info.utilization !== undefined && { usedPercent: toPercent(info.utilization) }),
      ...(info.surpassedThreshold !== undefined && { thresholdPercent: toPercent(info.surpassedThreshold) }),
      ...(info.resetsAt !== undefined && { resetsAt: toIso(info.resetsAt) }),
    };
    // Later events may omit fields an earlier one had (e.g. the percentage), so update instead of replace
    if (info.rateLimitType === "five_hour") plan.fiveHour = { ...plan.fiveHour, ...window };
    if (info.rateLimitType === "seven_day") plan.weekly = { ...plan.weekly, ...window };
  }
  return plan.fiveHour || plan.weekly ? plan : undefined;
}

/** Parses newline-delimited JSON, ignoring lines that are not JSON (e.g. stray log output). */
function parseLines(stdout: string): unknown[] {
  return stdout.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

export function parseCliOutput(stdout: string, stderr: string, exitCode: number, cwd: string): { output: unknown; usage: Usage } {
  const events = parseLines(stdout);
  const json = events.findLast((e) => typeof e === "object" && e !== null && (e as { type?: unknown }).type === "result");
  if (json === undefined) {
    const detail = (stderr || stdout).trim().split("\n").slice(-3).join(" ").slice(0, 300);
    throw new AgentError(withLoginHint(`Claude Code in ${cwd} did not return a result (exit code ${exitCode})${detail ? `: ${detail}` : ""}`));
  }
  const parsed = CliResult.safeParse(json);
  if (!parsed.success) throw new AgentError(`Claude Code in ${cwd} returned an unexpected result format`);
  const r = parsed.data;
  // input_tokens excludes cached prompt tokens, which are most of an agent run's input
  const usage: Usage = {
    inputTokens: (r.usage?.input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0),
    outputTokens: r.usage?.output_tokens ?? 0,
    costUsd: r.total_cost_usd ?? 0,
  };
  const plan = planUsageFromEvents(events);
  if (plan) usage.plan = plan;
  if (r.subtype !== "success") {
    throw new AgentError(`Claude Code in ${cwd} stopped early: ${ERROR_HINTS[r.subtype] ?? r.subtype}`, usage);
  }
  if (r.is_error) throw new AgentError(withLoginHint(`Claude Code in ${cwd} failed: ${r.result ?? "unknown error"}`), usage);
  if (r.structured_output === undefined) throw new AgentError(`Claude Code in ${cwd} finished without structured output`, usage);
  return { output: r.structured_output, usage };
}

export async function runClaudeCli(runner: CommandRunner, options: CliRunOptions): Promise<{ output: unknown; usage: Usage }> {
  const result = await runner
    .run(CLAUDE_COMMAND, buildCliArgs(options), {
      cwd: options.cwd,
      input: options.prompt,
      env: cliEnv(process.env),
      timeoutMs: options.timeoutMs,
    })
    .catch((e: unknown) => {
      throw fromCommandError(e, options.cwd);
    });
  return parseCliOutput(result.stdout, result.stderr, result.exitCode, options.cwd);
}

/** Problems starting or finishing the CLI get a next step; anything else is a bug and passes through unchanged. */
export function fromCommandError(error: unknown, cwd: string): unknown {
  if (error instanceof CommandTimeoutError) {
    const minutes = Math.round(error.timeoutMs / 60_000);
    return new AgentError(
      `Claude Code in ${cwd} did not finish within ${minutes} minutes and was stopped. ` +
        "Try again, or add hints for the feature so the agent finds it faster.",
      undefined,
      { cause: error },
    );
  }
  if (error instanceof CommandNotFoundError) {
    return new AgentError(
      `${error.message}. Install Claude Code and log in, or set ANTHROPIC_API_KEY to use the Anthropic API.`,
      undefined,
      { cause: error },
    );
  }
  return error;
}
