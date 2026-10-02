import { query, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { AgentError, type AgentRequest, type AgentResult, type AgentRunner } from "./AgentRunner.js";

/** The only tools the agent ever gets: it can look at code but never change, run or send anything. */
export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

/** Pure, so the security-relevant options can be asserted in tests without calling the API. */
export function buildAgentOptions(request: AgentRequest, clientApp: string): Options {
  return {
    cwd: request.cwd,
    systemPrompt: request.systemPrompt,
    model: request.model,
    maxTurns: request.maxTurns,
    maxBudgetUsd: request.maxBudgetUsd,
    // `tools` limits what exists; `allowedTools` lets those run without a prompt
    tools: READ_ONLY_TOOLS,
    allowedTools: READ_ONLY_TOOLS,
    permissionMode: "dontAsk",
    // Never load the analyzed repository's CLAUDE.md, settings or hooks: it must not be able to steer the agent
    settingSources: [],
    persistSession: false,
    outputFormat: { type: "json_schema", schema: request.outputSchema },
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: clientApp },
  };
}

const ERROR_HINTS: Record<string, string> = {
  error_max_budget_usd: "it reached the budget limit. Raise maxBudgetUsd in .driftcheck/config.yml or add hints for the feature",
  error_max_turns: "it reached the turn limit. Raise maxTurns in .driftcheck/config.yml or add hints for the feature",
  error_max_structured_output_retries: "it could not produce output matching the schema",
  error_during_execution: "an error occurred while it was running",
};

export function toAgentResult(message: SDKResultMessage, cwd: string): AgentResult {
  const usage = Object.values(message.modelUsage ?? {}).reduce(
    (sum, u) => ({ inputTokens: sum.inputTokens + u.inputTokens, outputTokens: sum.outputTokens + u.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  );
  const fullUsage = { ...usage, costUsd: message.total_cost_usd };

  if (message.subtype !== "success") {
    const details = message.errors.length > 0 ? ` (${message.errors.join("; ")})` : "";
    throw new AgentError(`The agent in ${cwd} stopped early: ${ERROR_HINTS[message.subtype] ?? message.subtype}${details}`, fullUsage);
  }
  if (message.is_error) {
    throw new AgentError(`The agent in ${cwd} failed: ${message.result}`, fullUsage);
  }
  if (message.structured_output === undefined) {
    throw new AgentError(`The agent in ${cwd} finished without structured output`, fullUsage);
  }
  return { output: message.structured_output, usage: fullUsage };
}

export class ClaudeAgentRunner implements AgentRunner {
  constructor(private readonly clientApp: string) {}

  async run(request: AgentRequest): Promise<AgentResult> {
    let result: SDKResultMessage | undefined;
    for await (const message of query({ prompt: request.prompt, options: buildAgentOptions(request, this.clientApp) })) {
      if (message.type === "result") result = message;
    }
    if (!result) throw new AgentError(`The agent in ${request.cwd} ended without a result`);
    return toAgentResult(result, request.cwd);
  }
}
