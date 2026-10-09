import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { AgentError, READ_ONLY_TOOLS, type AgentRequest } from "../src/extract/AgentRunner.js";
import { buildAgentOptions, toAgentResult } from "../src/extract/ClaudeAgentRunner.js";

const request: AgentRequest = {
  cwd: "/repo/android",
  systemPrompt: "system",
  prompt: "describe search",
  outputSchema: { type: "object" },
  model: "claude-sonnet-5-5",
  maxTurns: 30,
  maxBudgetUsd: 1.5,
};

describe("buildAgentOptions", () => {
  const options = buildAgentOptions(request, "driftcheck/test");

  it("gives the agent read-only tools and nothing else", () => {
    expect(READ_ONLY_TOOLS).toEqual(["Read", "Grep", "Glob"]);
    expect(options.tools).toEqual(READ_ONLY_TOOLS);
    expect(options.allowedTools).toEqual(READ_ONLY_TOOLS);
    expect(options.permissionMode).toBe("dontAsk");
  });

  it("never loads the analyzed repository's settings or keeps a session", () => {
    expect(options.settingSources).toEqual([]);
    expect(options.persistSession).toBe(false);
  });

  it("confines the agent to the platform root with the configured limits and schema", () => {
    expect(options).toMatchObject({
      cwd: "/repo/android",
      systemPrompt: "system",
      model: "claude-sonnet-5-5",
      maxTurns: 30,
      maxBudgetUsd: 1.5,
      outputFormat: { type: "json_schema", schema: { type: "object" } },
    });
    expect(options.env?.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("driftcheck/test");
  });
});

const baseResult = {
  type: "result",
  total_cost_usd: 0.42,
  modelUsage: {
    "claude-sonnet-5-5": { inputTokens: 1000, outputTokens: 200 },
    "claude-haiku-4-5": { inputTokens: 50, outputTokens: 10 },
  },
  errors: [],
  is_error: false,
} as unknown as SDKResultMessage;

describe("toAgentResult", () => {
  it("returns the structured output with summed usage and the reported cost", () => {
    const message = { ...baseResult, subtype: "success", result: "", structured_output: { ok: true } } as SDKResultMessage;
    expect(toAgentResult(message, "/repo")).toEqual({
      output: { ok: true },
      usage: { inputTokens: 1050, outputTokens: 210, costUsd: 0.42 },
    });
  });

  it("explains budget and turn limits and keeps the cost on the error", () => {
    const budget = { ...baseResult, subtype: "error_max_budget_usd" } as SDKResultMessage;
    try {
      toAgentResult(budget, "/repo");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError);
      expect((e as AgentError).message).toMatch(/budget limit.*maxBudgetUsd/);
      expect((e as AgentError).usage.costUsd).toBe(0.42);
    }
    const turns = { ...baseResult, subtype: "error_max_turns" } as SDKResultMessage;
    expect(() => toAgentResult(turns, "/repo")).toThrowError(/turn limit/);
  });

  it("fails when the run errored or produced no structured output", () => {
    const apiError = { ...baseResult, subtype: "success", is_error: true, result: "overloaded" } as SDKResultMessage;
    expect(() => toAgentResult(apiError, "/repo")).toThrowError(/failed: overloaded/);
    const empty = { ...baseResult, subtype: "success", result: "done" } as SDKResultMessage;
    expect(() => toAgentResult(empty, "/repo")).toThrowError(/without structured output/);
  });
});
