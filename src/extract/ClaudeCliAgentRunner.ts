import type { CommandRunner } from "../io/process.js";
import type { AgentRequest, AgentResult, AgentRunner } from "./AgentRunner.js";
import { READ_ONLY_TOOLS_ARG, runClaudeCli } from "./claudeCli.js";

/**
 * Runs the read-only agent through the user's Claude Code CLI, so it uses their Claude subscription.
 * The CLI has no turn limit flag, so `maxTurns` is not enforced here; the budget limit still applies.
 */
export class ClaudeCliAgentRunner implements AgentRunner {
  constructor(private readonly commands: CommandRunner) {}

  run(request: AgentRequest): Promise<AgentResult> {
    return runClaudeCli(this.commands, {
      cwd: request.cwd,
      systemPrompt: request.systemPrompt,
      prompt: request.prompt,
      jsonSchema: request.outputSchema,
      model: request.model,
      maxBudgetUsd: request.maxBudgetUsd,
      tools: READ_ONLY_TOOLS_ARG,
    });
  }
}
