import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseConfig } from "../src/config/config.js";
import { AgentError } from "../src/extract/AgentRunner.js";
import { runStructuredAgent } from "../src/extract/structured.js";
import { FakeAgentRunner } from "./fakes/FakeAgentRunner.js";

const root = path.resolve("/projects/app");
const config = parseConfig("version: 1\nplatforms: { android: { path: a }, ios: { path: i } }\nmaxTurns: 7\nmaxBudgetUsd: 1.25\n", root);
const schema = z.object({ names: z.array(z.string()) });
const task = { systemPrompt: "system", prompt: "list names", schema, outputSchema: { type: "object" }, label: "name list" };

describe("runStructuredAgent", () => {
  it("runs the agent in the platform root with the configured model and limits", async () => {
    const runner = new FakeAgentRunner(() => ({ names: ["a"] }));
    await runStructuredAgent(runner, config, "ios", task);
    expect(runner.requests[0]).toEqual({
      cwd: path.join(root, "i"),
      systemPrompt: "system",
      prompt: "list names",
      outputSchema: { type: "object" },
      model: config.model,
      maxTurns: 7,
      maxBudgetUsd: 1.25,
    });
  });

  it("returns validated output and usage", async () => {
    const result = await runStructuredAgent(new FakeAgentRunner(() => ({ names: ["a", "b"] })), config, "android", task);
    expect(result.output.names).toEqual(["a", "b"]);
    expect(result.usage.costUsd).toBe(0.01);
  });

  it("rejects invalid output with the label, at most five problems and the usage", async () => {
    const bad = { names: Array.from({ length: 8 }, (_, i) => i) };
    const error = await runStructuredAgent(new FakeAgentRunner(() => bad), config, "android", task).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    const message = (error as AgentError).message;
    expect(message).toMatch(/^The android name list does not match the expected schema \(names\.0: /);
    expect(message.split("; ")).toHaveLength(5);
    expect((error as AgentError).usage.costUsd).toBe(0.01);
  });
});
