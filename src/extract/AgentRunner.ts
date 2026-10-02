/**
 * Runs an agent that explores one platform's source tree read-only and returns structured output.
 * Behind an interface so everything above it can be tested without the real API (see CLAUDE.md).
 */
export interface AgentRunner {
  run(request: AgentRequest): Promise<AgentResult>;
}

export interface AgentRequest {
  /** Absolute path the agent is confined to. */
  cwd: string;
  systemPrompt: string;
  prompt: string;
  /** JSON schema the final output must conform to. */
  outputSchema: Record<string, unknown>;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
}

export interface AgentResult {
  /** The structured output as returned by the agent; validated by the caller. */
  output: unknown;
  usage: Usage;
}

/** One claude.ai plan rate-limit window, as last reported by Claude Code. */
export interface PlanWindow {
  /** Percentage of the window used, 0–100. */
  usedPercent?: number;
  /** ISO 8601 timestamp when the window resets. */
  resetsAt?: string;
}

/** Subscription limits; only reported by the Claude Code backend, and only when Claude Code sends them. */
export interface PlanUsage {
  fiveHour?: PlanWindow;
  weekly?: PlanWindow;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  plan?: PlanUsage;
}

/** Usage within a window only grows, so when runs overlap the highest reading is the most recent. */
function latestWindow(a?: PlanWindow, b?: PlanWindow): PlanWindow | undefined {
  if (!a || !b) return a ?? b;
  return (b.usedPercent ?? -1) >= (a.usedPercent ?? -1) ? b : a;
}

function mergePlan(a?: PlanUsage, b?: PlanUsage): PlanUsage | undefined {
  if (!a || !b) return a ?? b;
  const fiveHour = latestWindow(a.fiveHour, b.fiveHour);
  const weekly = latestWindow(a.weekly, b.weekly);
  return { ...(fiveHour && { fiveHour }), ...(weekly && { weekly }) };
}

export function addUsage(a: Usage, b: Usage): Usage {
  const plan = mergePlan(a.plan, b.plan);
  return {
    ...(plan && { plan }),
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

export class AgentError extends Error {
  override name = "AgentError";

  /** What the failed run cost, so it can still be reported to the user. */
  constructor(message: string, readonly usage: Usage = NO_USAGE) {
    super(message);
  }
}
