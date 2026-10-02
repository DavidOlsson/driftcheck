import type { LlmClient, LlmRequest } from "../../src/llm/LlmClient.js";

/** Returns canned output and records requests; never calls the API. */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest<unknown>[] = [];

  constructor(private readonly respond: (request: LlmRequest<unknown>) => unknown) {}

  async parse<T>(request: LlmRequest<T>) {
    this.requests.push(request as LlmRequest<unknown>);
    return { output: this.respond(request as LlmRequest<unknown>) as T, usage: { inputTokens: 500, outputTokens: 300, costUsd: 0.004 } };
  }
}
