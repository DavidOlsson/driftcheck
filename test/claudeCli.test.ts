import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentError } from "../src/extract/AgentRunner.js";
import { ClaudeCliAgentRunner } from "../src/extract/ClaudeCliAgentRunner.js";
import { buildCliArgs, cliEnv, parseCliOutput } from "../src/extract/claudeCli.js";
import { ClaudeCliLlmClient } from "../src/llm/ClaudeCliLlmClient.js";
import { cliSuccess, FakeCommandRunner } from "./fakes/FakeCommandRunner.js";

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("buildCliArgs", () => {
  const args = buildCliArgs({
    cwd: "/repo/ios",
    systemPrompt: "system",
    prompt: "describe search",
    jsonSchema: { type: "object" },
    model: "claude-sonnet-5-5",
    maxBudgetUsd: 1.5,
    tools: "Read,Grep,Glob",
  });

  it("runs headless with structured JSON output", () => {
    expect(args[0]).toBe("-p");
    expect(flag(args, "--output-format")).toBe("json");
    expect(JSON.parse(flag(args, "--json-schema")!)).toEqual({ type: "object" });
    expect(flag(args, "--system-prompt")).toBe("system");
    expect(flag(args, "--model")).toBe("claude-sonnet-5-5");
    expect(flag(args, "--max-budget-usd")).toBe("1.5");
  });

  it("locks the agent down to read-only tools without the repo's settings or MCP servers", () => {
    expect(args).toContain("--restricted");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(flag(args, "--tools")).toBe("Read,Grep,Glob");
    expect(flag(args, "--allowedTools")).toBe("Read,Grep,Glob");
    expect(flag(args, "--permission-mode")).toBe("dontAsk");
    for (const tool of ["Bash", "Edit", "Write", "WebFetch", "WebSearch"]) {
      expect(flag(args, "--disallowedTools")).toContain(tool);
    }
  });

  it("never puts the prompt on the command line, and disables all tools when none are requested", () => {
    expect(args).not.toContain("describe search");
    const noTools = buildCliArgs({ cwd: "/", systemPrompt: "s", prompt: "p", jsonSchema: {}, model: "m", maxBudgetUsd: 1, tools: "" });
    expect(flag(noTools, "--tools")).toBe("");
    expect(noTools).not.toContain("--allowedTools");
  });
});

describe("cliEnv", () => {
  it("removes ANTHROPIC_API_KEY so the CLI uses the Claude Code login, not API billing", () => {
    const env = cliEnv({ ANTHROPIC_API_KEY: "sk-ant-secret", PATH: "/bin", HOME: "/home/me" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/home/me" });
  });
});

describe("parseCliOutput", () => {
  it("returns structured output, tokens and cost", () => {
    const { stdout, stderr, exitCode } = cliSuccess({ ok: true }, 0.33);
    expect(parseCliOutput(stdout, stderr, exitCode, "/repo")).toEqual({
      output: { ok: true },
      usage: { inputTokens: 2000, outputTokens: 300, costUsd: 0.33 },
    });
  });

  it("explains non-JSON output, such as a CLI that is not logged in", () => {
    expect(() => parseCliOutput("", "Invalid API key · Please run /login", 1, "/repo")).toThrowError(
      /did not return JSON \(exit code 1\): Invalid API key · Please run \/login/,
    );
  });

  it("maps budget errors and keeps the cost", () => {
    const stdout = JSON.stringify({ type: "result", subtype: "error_max_budget_usd", total_cost_usd: 1.6, usage: {} });
    try {
      parseCliOutput(stdout, "", 1, "/repo");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError);
      expect((e as AgentError).message).toMatch(/budget limit/);
      expect((e as AgentError).usage.costUsd).toBe(1.6);
    }
  });

  it("fails on errors, unexpected formats and missing structured output", () => {
    const err = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "rate limited" });
    expect(() => parseCliOutput(err, "", 1, "/repo")).toThrowError(/failed: rate limited/);
    expect(() => parseCliOutput('{"hello":1}', "", 0, "/repo")).toThrowError(/unexpected result format/);
    const empty = JSON.stringify({ type: "result", subtype: "success", result: "done" });
    expect(() => parseCliOutput(empty, "", 0, "/repo")).toThrowError(/without structured output/);
  });
});

describe("ClaudeCliAgentRunner", () => {
  it("runs claude in the platform root with the prompt on stdin and without an API key", async () => {
    const commands = new FakeCommandRunner(() => cliSuccess({ feature: "search" }));
    const result = await new ClaudeCliAgentRunner(commands).run({
      cwd: "/repo/android",
      systemPrompt: "system",
      prompt: "describe search",
      outputSchema: { type: "object" },
      model: "claude-sonnet-5-5",
      maxTurns: 40,
      maxBudgetUsd: 2,
    });
    const call = commands.calls[0]!;
    expect(call.command).toBe("claude");
    expect(call.options.cwd).toBe("/repo/android");
    expect(call.options.input).toBe("describe search");
    expect(call.options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.output).toEqual({ feature: "search" });
  });
});

describe("ClaudeCliLlmClient", () => {
  const schema = z.object({ findings: z.array(z.string()) });

  it("calls claude without tools and validates the output against the schema", async () => {
    const commands = new FakeCommandRunner(() => cliSuccess({ findings: ["a"] }));
    const result = await new ClaudeCliLlmClient(commands).parse({ model: "m", system: "s", prompt: "p", schema, maxTokens: 100 });
    expect(result.output).toEqual({ findings: ["a"] });
    expect(flag(commands.calls[0]!.args, "--tools")).toBe("");
  });

  it("rejects output that does not match the schema", async () => {
    const commands = new FakeCommandRunner(() => cliSuccess({ findings: "not a list" }));
    await expect(
      new ClaudeCliLlmClient(commands).parse({ model: "m", system: "s", prompt: "p", schema, maxTokens: 100 }),
    ).rejects.toThrowError(AgentError);
  });
});
