import Anthropic from "@anthropic-ai/sdk";
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

/** Fails like the SDK does after its own retries, without any request leaving the machine. */
const clientThrowing = (error: Error) =>
  ({ beta: { messages: { parse: () => Promise.reject(error) } } }) as unknown as Anthropic;

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

  it("turns API errors into messages that say what to do, without usage since nothing was billed", async () => {
    const headers = new Headers();
    const cases: [Error, RegExp][] = [
      [new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", headers), /ANTHROPIC_API_KEY was rejected.*unset it to use Claude Code/],
      [new Anthropic.PermissionDeniedError(403, {}, "forbidden", headers), /not allowed to use claude-sonnet-5-5/],
      [new Anthropic.NotFoundError(404, {}, "model not found", headers), /model "claude-sonnet-5-5" was not found\. Check --model/],
      [new Anthropic.RateLimitError(429, {}, "rate limited", headers), /rate limit was reached\. Wait a minute/],
      [Anthropic.APIError.generate(529, {}, "Overloaded", headers), /overloaded or unavailable \(status 529\)/],
      [new Anthropic.APIConnectionError({ message: "Connection error." }), /could not reach the Anthropic API \(Connection error\.\)\. Check your network/],
      [
        new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "prompt is too long" } }, undefined, headers),
        /returned an error \(status 400\): prompt is too long$/,
      ],
    ];
    for (const [cause, message] of cases) {
      const error = await new AnthropicLlmClient(clientThrowing(cause)).parse(request()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AgentError);
      expect((error as AgentError).message).toMatch(/^The feature matching failed: /);
      expect((error as AgentError).message).toMatch(message);
      expect((error as AgentError).cause).toBe(cause);
      expect((error as AgentError).usage.costUsd).toBe(0);
    }
  });

  it("passes errors that are not API errors through unchanged", async () => {
    const bug = new TypeError("not an API problem");
    await expect(new AnthropicLlmClient(clientThrowing(bug)).parse(request())).rejects.toBe(bug);
  });
});
