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

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
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
