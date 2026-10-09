import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentError } from "../src/extract/AgentRunner.js";
import { AnthropicLlmClient, type LlmRequest } from "../src/llm/LlmClient.js";

const schema = z.object({ matches: z.array(z.string()) });

/** Stands in for the SDK, so no request ever leaves the machine. */
const clientReturning = (response: { stop_reason: string; parsed_output: unknown }) =>
  ({
    beta: { messages: { parse: async () => ({ ...response, usage: { input_tokens: 1000, output_tokens: 2000 } }) } },
  }) as unknown as Anthropic;

const request = (overrides: Partial<LlmRequest<z.infer<typeof schema>>> = {}): LlmRequest<z.infer<typeof schema>> => ({
  model: "claude-sonnet-5-5",
  system: "s",
  prompt: "p",
  schema,
  maxTokens: 16_000,
  task: "feature matching",
  ...overrides,
});

describe("AnthropicLlmClient", () => {
  it("returns the parsed output with usage and estimated cost", async () => {
    const llm = new AnthropicLlmClient(clientReturning({ stop_reason: "end_turn", parsed_output: { matches: ["a"] } }));
    const result = await llm.parse(request());
    expect(result.output).toEqual({ matches: ["a"] });
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 2000, costUsd: 0.022 });
  });

  it("names the task when the answer is cut off, and only adds the hint the caller gave", async () => {
    const llm = new AnthropicLlmClient(clientReturning({ stop_reason: "max_tokens", parsed_output: null }));
    const matching = await llm.parse(request()).catch((e: unknown) => e);
    expect((matching as AgentError).message).toBe("The feature matching was cut off at 16000 output tokens.");
    expect((matching as AgentError).usage.outputTokens).toBe(2000);

    const comparison = await llm.parse(request({ task: "comparison", cutOffHint: "Try a feature with fewer items." })).catch((e: unknown) => e);
    expect((comparison as AgentError).message).toBe("The comparison was cut off at 16000 output tokens. Try a feature with fewer items.");
  });

  it("names the task when the model declines or returns no valid output", async () => {
    const refused = new AnthropicLlmClient(clientReturning({ stop_reason: "refusal", parsed_output: null }));
    await expect(refused.parse(request())).rejects.toThrowError(/^The model declined the feature matching\.$/);
    const empty = new AnthropicLlmClient(clientReturning({ stop_reason: "end_turn", parsed_output: null }));
    await expect(empty.parse(request())).rejects.toThrowError(AgentError);
    await expect(empty.parse(request())).rejects.toThrowError(/^The feature matching did not return output/);
  });
});
