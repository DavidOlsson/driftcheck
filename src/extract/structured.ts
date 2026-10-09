import type { z } from "zod";
import type { Config } from "../config/config.js";
import type { Platform } from "../model/spec.js";
import { AgentError, type AgentRunner, type Usage } from "./AgentRunner.js";

export interface StructuredAgentTask<T> {
  systemPrompt: string;
  prompt: string;
  /** Validates the output; model output is untrusted until it passes. */
  schema: z.ZodType<T>;
  /** The same schema as JSON schema, for the agent's structured output. */
  outputSchema: Record<string, unknown>;
  /** What the output is, for error messages, e.g. "feature description". */
  label: string;
}

/**
 * Runs a read-only agent in one platform's source root with the configured limits, and validates its
 * output. A failed validation still reports the usage, because the run was paid for.
 */
export async function runStructuredAgent<T>(
  runner: AgentRunner,
  config: Config,
  platform: Platform,
  task: StructuredAgentTask<T>,
): Promise<{ output: T; usage: Usage }> {
  const result = await runner.run({
    cwd: config.platforms[platform],
    systemPrompt: task.systemPrompt,
    prompt: task.prompt,
    outputSchema: task.outputSchema,
    model: config.model,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
  });
  const parsed = task.schema.safeParse(result.output);
  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AgentError(`The ${platform} ${task.label} does not match the expected schema (${problems})`, result.usage);
  }
  return { output: parsed.data, usage: result.usage };
}
