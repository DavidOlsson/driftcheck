import os from "node:os";
import { AgentError, type Usage } from "../extract/AgentRunner.js";
import { runClaudeCli } from "../extract/claudeCli.js";
import type { CommandRunner } from "../io/process.js";
import { toOutputJsonSchema } from "../model/jsonSchema.js";
import type { LlmClient, LlmRequest } from "./LlmClient.js";

/** Budget for a single tool-less comparison call. */
const COMPARE_BUDGET_USD = 1;

/** Tool-less structured call through the user's Claude Code CLI (their Claude subscription). */
export class ClaudeCliLlmClient implements LlmClient {
  constructor(private readonly commands: CommandRunner) {}

  async parse<T>(request: LlmRequest<T>): Promise<{ output: T; usage: Usage }> {
    const { output, usage } = await runClaudeCli(this.commands, {
      // No tools are enabled, but run outside any project so nothing project-specific is picked up
      cwd: os.tmpdir(),
      systemPrompt: request.system,
      prompt: request.prompt,
      jsonSchema: toOutputJsonSchema(request.schema),
      model: request.model,
      maxBudgetUsd: COMPARE_BUDGET_USD,
      tools: "",
    });
    const parsed = request.schema.safeParse(output);
    if (!parsed.success) {
      throw new AgentError("The comparison did not return output matching the expected schema.", usage);
    }
    return { output: parsed.data, usage };
  }
}
