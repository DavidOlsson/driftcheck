#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { ConfigError, parseModel } from "./config/config.js";
import { AgentError } from "./extract/AgentRunner.js";
import { initProject, validateProject } from "./commands/project.js";
import { formatSummary, verifySpecFile } from "./commands/verifyCommand.js";
import { runCompare } from "./commands/compareCommand.js";
import { ClaudeAgentRunner } from "./extract/ClaudeAgentRunner.js";
import { AnthropicLlmClient } from "./llm/LlmClient.js";
import { ClaudeCliAgentRunner } from "./extract/ClaudeCliAgentRunner.js";
import { ClaudeCliLlmClient } from "./llm/ClaudeCliLlmClient.js";
import { NodeCommandRunner } from "./io/process.js";
import { BACKENDS, type Backend, type BackendChoice } from "./model/backend.js";
import { selectBackend } from "./selectBackend.js";
import { rerenderOverview, runOverview } from "./commands/overviewCommand.js";
import type { MatrixGroup } from "./inventory/presence.js";
import type { Usage } from "./extract/AgentRunner.js";
import { groupMatches } from "./report/overviewData.js";
import { usageLabel } from "./report/shared.js";
import { createRequire } from "node:module";

// Read at runtime so it works both from src/ (tests) and dist/ (published package)
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command()
  .name("driftcheck")
  .description("Keeps native Android and iOS apps in sync by comparing how each feature is implemented on both platforms.")
  .version(version)
  .option("-C, --project <dir>", "project root that contains .driftcheck/", ".")
  .option("--allow-external-paths", "allow platform paths in the config to point outside the project root");

const projectRoot = () => path.resolve(program.opts<{ project: string }>().project);

/** The external-paths opt-in exists only on the command line, so a config from a pull request cannot grant it. */
const loadProject = () =>
  validateProject(projectRoot(), { allowExternalPaths: program.opts<{ allowExternalPaths?: boolean }>().allowExternalPaths });

program
  .command("init")
  .description("create .driftcheck/config.yml")
  .option("-f, --force", "overwrite an existing config")
  .action(async (options: { force?: boolean }) => {
    const file = await initProject(projectRoot(), options.force);
    console.log(`Created ${path.relative(process.cwd(), file)}. Edit the platform paths and features, then run "driftcheck validate".`);
  });

program
  .command("validate")
  .description("check the config and that both platform paths exist")
  .action(async () => {
    const config = await loadProject();
    console.log(`Config OK. android: ${config.platforms.android}`);
    console.log(`           ios: ${config.platforms.ios}`);
    console.log(`Features: ${config.features.map((f) => f.id).join(", ") || "none"} · model: ${config.model}`);
  });

program
  .command("verify <spec>")
  .description("verify a feature description's evidence (file, line, quote) against the source")
  .action(async (spec: string) => {
    const config = await loadProject();
    const result = await verifySpecFile(config, path.resolve(spec));
    console.log(formatSummary(result.spec, result.summary));
  });

interface ClaudeOptions {
  model?: string;
  backend?: string;
}

/** Shared by every command that calls Claude: config, backend choice and the matching clients. */
async function setupClaude(options: ClaudeOptions) {
  const loaded = await loadProject();
  const config = options.model ? { ...loaded, model: parseModel(options.model) } : loaded;
  const commands = new NodeCommandRunner();
  const backend = await selectBackend(parseBackendChoice(options.backend ?? config.backend), process.env, commands);
  const deps = {
    backend,
    ...(backend === "api"
      ? { runner: new ClaudeAgentRunner(`driftcheck/${version}`), llm: new AnthropicLlmClient() }
      : { runner: new ClaudeCliAgentRunner(commands), llm: new ClaudeCliLlmClient(commands) }),
    now: () => new Date(),
    log: (message: string) => console.log(message),
  };
  return { config, deps };
}

function printReportAndUsage(reportFile: string, deps: { backend: Backend }, usage: Usage): void {
  console.log(`Report: ${path.relative(process.cwd(), reportFile)}`);
  // Local time in the terminal; reports use UTC so they read the same for everyone
  const localTime = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  console.log(usageLabel(deps.backend, usage, localTime).replace(/\*\*/g, ""));
}

const withClaudeOptions = (command: Command) =>
  command
    .option("-m, --model <model>", "Claude model to use instead of the configured one")
    .option("-b, --backend <backend>", `how to reach Claude: ${BACKENDS.join(", ")} (default: from config, else auto)`);

withClaudeOptions(
  program.command("overview").description("map the features of both apps with Claude and report a feature matrix"),
).action(async (options: ClaudeOptions) => {
  const { config, deps } = await setupClaude(options);
  const result = await runOverview(config, deps);
  // Same grouping as the report, i.e. after the presence check
  const groups = groupMatches(result.matches);
  const count = (group: MatrixGroup) => groups[group].length;
  console.log(
    `Features: ${count("both")} on both platforms, ${count("different_structure")} structured differently, ` +
      `${count("android_only")} Android only, ${count("ios_only")} iOS only, ${count("uncertain")} uncertain`,
  );
  console.log(`HTML report: ${path.relative(process.cwd(), result.htmlFile)}`);
  printReportAndUsage(result.reportFile, deps, result.usage);
});

program
  .command("report <kind>")
  .description('rebuild reports from stored results without calling Claude (kind: "overview")')
  .action(async (kind: string) => {
    if (kind !== "overview") throw new ConfigError(`Unknown report "${kind}". Supported: overview`);
    const files = await rerenderOverview(projectRoot());
    console.log(`Report: ${path.relative(process.cwd(), files.report)}`);
    console.log(`HTML report: ${path.relative(process.cwd(), files.html)}`);
  });

withClaudeOptions(
  program.command("compare <feature>").description("describe a feature on both platforms with Claude and report the differences"),
).action(async (featureId: string, options: ClaudeOptions) => {
  const { config, deps } = await setupClaude(options);
  const result = await runCompare(config, featureId, deps);
  const counts = Object.entries(
    result.findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.category]: (acc[f.category] ?? 0) + 1 }), {}),
  )
    .map(([category, count]) => `${count} ${category}`)
    .join(", ");
  console.log(`Findings: ${counts || "none"}`);
  printReportAndUsage(result.reportFile, deps, result.usage);
});

function parseBackendChoice(value: string): BackendChoice {
  if (!(BACKENDS as readonly string[]).includes(value)) {
    throw new ConfigError(`Unknown backend "${value}". Use one of: ${BACKENDS.join(", ")}`);
  }
  return value as BackendChoice;
}

try {
  await program.parseAsync();
} catch (e) {
  // Expected problems get a clean message; anything else is a bug and keeps its stack trace
  if (e instanceof ConfigError || e instanceof AgentError) {
    console.error(`driftcheck: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
