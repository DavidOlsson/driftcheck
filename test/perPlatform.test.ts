import { describe, expect, it } from "vitest";
import { afterPaidRuns, apiCost, maxCostUsd, runPerPlatform } from "../src/commands/perPlatform.js";
import { parseConfig } from "../src/config/config.js";
import { AgentError } from "../src/extract/AgentRunner.js";

const usage = (costUsd: number) => ({ inputTokens: 10, outputTokens: 5, costUsd });

describe("runPerPlatform", () => {
  it("runs both platforms and sums their usage", async () => {
    const result = await runPerPlatform("api", async (platform) => ({ platform, usage: usage(platform === "android" ? 1 : 2) }));
    expect(result.android.platform).toBe("android");
    expect(result.ios.platform).toBe("ios");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10, costUsd: 3 });
  });

  it("reports what both runs cost when one fails", async () => {
    const run = runPerPlatform("api", async (platform) => {
      if (platform === "ios") throw new AgentError("budget reached", usage(1.5));
      return { usage: usage(0.25) };
    });
    const error = await run.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).message).toBe("budget reached (this run cost about $1.75)");
    expect((error as AgentError).usage.costUsd).toBe(1.75);
  });

  it("leaves dollars out of the error on a subscription", async () => {
    const run = runPerPlatform("claude-code", async () => {
      throw new AgentError("limit reached", usage(1));
    });
    await expect(run).rejects.toThrowError(/^limit reached$/);
  });

  it("rethrows unexpected errors unchanged", async () => {
    const bug = new TypeError("not an agent problem");
    await expect(runPerPlatform("api", async () => Promise.reject(bug))).rejects.toBe(bug);
  });
});

describe("afterPaidRuns", () => {
  it("returns the step's result", async () => {
    expect(await afterPaidRuns("api", usage(1), async () => "done")).toBe("done");
  });

  it("adds what earlier runs cost to a failed step's error", async () => {
    const cause = new Error("429");
    const step = async () => {
      throw new AgentError("The comparison failed: rate limited", usage(0.01), { cause });
    };
    const error = await afterPaidRuns("api", usage(1.5), step).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).message).toBe("The comparison failed: rate limited (this run cost about $1.51)");
    expect((error as AgentError).usage).toEqual({ inputTokens: 20, outputTokens: 10, costUsd: 1.51 });
    expect((error as AgentError).cause).toBe(cause);
  });

  it("leaves dollars out on a subscription and rethrows unexpected errors unchanged", async () => {
    const failing = async () => {
      throw new AgentError("limit reached", usage(0));
    };
    await expect(afterPaidRuns("claude-code", usage(1), failing)).rejects.toThrowError(/^limit reached$/);
    const bug = new TypeError("bug");
    await expect(afterPaidRuns("api", usage(1), () => Promise.reject(bug))).rejects.toBe(bug);
  });
});

describe("apiCost and maxCostUsd", () => {
  it("shows dollar amounts only for the API backend", () => {
    expect(apiCost("api", " ($1.00)")).toBe(" ($1.00)");
    expect(apiCost("claude-code", " ($1.00)")).toBe("");
  });

  it("bounds a run by two agent budgets plus the tool-less step", () => {
    const config = parseConfig("version: 1\nplatforms: {android: {path: a}, ios: {path: i}}\nmaxBudgetUsd: 1.5\n", "/p");
    expect(maxCostUsd(config)).toBe(3.5);
  });
});
