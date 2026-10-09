import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AgentError, type Usage } from "../extract/AgentRunner.js";
import { fromApiError } from "./apiErrors.js";
import { estimateCostUsd } from "./pricing.js";

/** A single model call without tools that must return JSON matching a schema. */
export interface LlmClient {
  parse<T>(request: LlmRequest<T>): Promise<{ output: T; usage: Usage }>;
}

export interface LlmRequest<T> {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  /** What the call does, for error messages, e.g. "comparison" or "feature matching". */
  task: string;
  /** Extra advice when the answer is cut off at maxTokens, specific to the task. */
  cutOffHint?: string;
}

export class AnthropicLlmClient implements LlmClient {
  // The SDK reads ANTHROPIC_API_KEY from the environment
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async parse<T>(request: LlmRequest<T>): Promise<{ output: T; usage: Usage }> {
    const response = await this.client.beta.messages
      .parse({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: { format: betaZodOutputFormat(request.schema) },
        // If the model declines, let the API retry on a suitable fallback model instead of failing the run
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      })
      .catch((e: unknown) => {
        throw fromApiError(e, request.task, request.model);
      });

    // A failed call was still billed, so every error below carries the usage
    const { input_tokens, output_tokens } = response.usage;
    const usage: Usage = {
      inputTokens: input_tokens,
      outputTokens: output_tokens,
      costUsd: estimateCostUsd(request.model, input_tokens, output_tokens) ?? 0,
    };
    if (response.stop_reason === "refusal") {
      throw new AgentError(`The model declined the ${request.task}.`, usage);
    }
    if (response.stop_reason === "max_tokens") {
      const hint = request.cutOffHint ? ` ${request.cutOffHint}` : "";
      throw new AgentError(`The ${request.task} was cut off at ${request.maxTokens} output tokens.${hint}`, usage);
    }
    if (response.parsed_output == null) {
      throw new AgentError(`The ${request.task} did not return output matching the expected schema.`, usage);
    }
    return { output: response.parsed_output as T, usage };
  }
}
