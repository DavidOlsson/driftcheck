import type { AgentRequest, AgentResult, AgentRunner } from "../../src/extract/AgentRunner.js";

/** Returns canned output and records every request, so tests can assert what would be sent to the API. */
export class FakeAgentRunner implements AgentRunner {
  readonly requests: AgentRequest[] = [];

  constructor(private readonly respond: (request: AgentRequest) => unknown) {}

  async run(request: AgentRequest): Promise<AgentResult> {
    this.requests.push(request);
    return {
      output: this.respond(request),
      usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.01 },
    };
  }
}
