import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { maxCostUsd, runCompare } from "../src/commands/compareCommand.js";
import { initProject, validateProject } from "../src/commands/project.js";
import { AgentError, type AgentRequest } from "../src/extract/AgentRunner.js";
import { FakeAgentRunner } from "./fakes/FakeAgentRunner.js";
import { FakeLlmClient } from "./fakes/FakeLlmClient.js";
import { finding } from "./helpers/specs.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "driftcheck-compare-"));
  await initProject(root);
  await mkdir(path.join(root, "android"));
  await mkdir(path.join(root, "ios"));
  await writeFile(path.join(root, "android", "Search.kt"), "x\nval debounce = 200\n");
  await writeFile(path.join(root, "ios", "Search.swift"), "x\nlet debounce = 100\n");
});

/** Answers like an agent would, based on which platform root it was started in. */
const agentOutput = (request: AgentRequest) => {
  const platform = request.cwd.endsWith("android") ? "android" : "ios";
  const [file, value] = platform === "android" ? ["Search.kt", "200"] : ["Search.swift", "100"];
  return {
    feature: "search",
    platform,
    summary: `Search on ${platform}`,
    items: [
      {
        key: "input_handling.debounce_ms",
        section: "input_handling",
        description: "Delay",
        value,
        evidence: [{ file, line: 2, quote: `debounce = ${value}` }],
      },
    ],
  };
};

const deps = (runner: FakeAgentRunner, logs: string[] = []) => ({
  backend: "api" as const,
  runner,
  llm: new FakeLlmClient(() => ({ findings: [finding({ android: { summary: "200 ms", evidence: [{ file: "Search.kt", line: 2 }] }, ios: { summary: "100 ms", evidence: [{ file: "Search.swift", line: 2 }] } })] })),
  now: () => new Date("2026-10-02T10:00:00Z"),
  log: (m: string) => logs.push(m),
});

describe("runCompare", () => {
  it("describes both platforms, verifies, compares and writes specs, findings and report", async () => {
    const config = await validateProject(root);
    const runner = new FakeAgentRunner(agentOutput);
    const logs: string[] = [];
    const result = await runCompare(config, "search", deps(runner, logs));

    expect(runner.requests.map((r) => path.basename(r.cwd)).sort()).toEqual(["android", "ios"]);
    const androidSpec = JSON.parse(await readFile(path.join(root, ".driftcheck/specs/search/android.json"), "utf8"));
    expect(androidSpec.items[0].verified).toBe(true);
    const findings = JSON.parse(await readFile(path.join(root, ".driftcheck/findings/search.json"), "utf8"));
    expect(findings[0].title).toBe("Different debounce");

    const report = await readFile(result.reportFile, "utf8");
    expect(result.reportFile).toBe(path.join(root, ".driftcheck/reports/search.md"));
    expect(report).toContain("| 1 | high | Different debounce | 200 ms (`Search.kt:2`) | 100 ms (`Search.swift:2`) |");
    // Two agent runs (0.01 each) plus the comparison (0.004)
    expect(result.usage.costUsd).toBeCloseTo(0.024);
    expect(logs[0]).toContain(`at most about $${maxCostUsd(config).toFixed(2)}`);
    expect(logs.some((l) => l.includes("android: 1 items, 1 verified"))).toBe(true);
  });

  it("reports what a failed run cost and does not compare", async () => {
    const config = await validateProject(root);
    const runner = new FakeAgentRunner((request) => {
      if (request.cwd.endsWith("ios")) throw new AgentError("budget reached", { inputTokens: 1, outputTokens: 1, costUsd: 1.5 });
      return agentOutput(request);
    });
    const d = deps(runner);
    await expect(runCompare(config, "search", d)).rejects.toThrowError(/budget reached \(this run cost about \$1\.51\)/);
    expect((d.llm as FakeLlmClient).requests).toHaveLength(0);
  });

  it("fails fast on an unknown feature without calling the agent", async () => {
    const config = await validateProject(root);
    const runner = new FakeAgentRunner(agentOutput);
    await expect(runCompare(config, "login", deps(runner))).rejects.toThrowError(/Unknown feature "login"/);
    expect(runner.requests).toHaveLength(0);
  });
});
