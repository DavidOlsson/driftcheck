#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { ConfigError } from "./config/config.js";
import { AgentError } from "./extract/AgentRunner.js";
import { initProject, validateProject } from "./commands/project.js";
import { formatSummary, verifySpecFile } from "./commands/verifyCommand.js";
import { createRequire } from "node:module";

// Read at runtime so it works both from src/ (tests) and dist/ (published package)
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command()
  .name("driftcheck")
  .description("Keeps native Android and iOS apps in sync by comparing how each feature is implemented on both platforms.")
  .version(version)
  .option("-C, --project <dir>", "project root that contains .driftcheck/", ".");

const projectRoot = () => path.resolve(program.opts<{ project: string }>().project);

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
    const config = await validateProject(projectRoot());
    console.log(`Config OK. android: ${config.platforms.android}`);
    console.log(`           ios: ${config.platforms.ios}`);
    console.log(`Features: ${config.features.map((f) => f.id).join(", ") || "none"} · model: ${config.model}`);
  });

program
  .command("verify <spec>")
  .description("verify a feature description's evidence (file, line, quote) against the source")
  .action(async (spec: string) => {
    const config = await validateProject(projectRoot());
    const result = await verifySpecFile(config, path.resolve(spec));
    console.log(formatSummary(result.spec, result.summary));
  });

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
