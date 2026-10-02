import path from "node:path";
import { CONFIG_DIR, type Config } from "../config/config.js";
import { addUsage, AgentError, NO_USAGE, type Usage } from "../extract/AgentRunner.js";
import { FsSourceReader } from "../io/fileReader.js";
import { extractInventory, matchInventories, verifyInventory, type VerifiedInventory } from "../inventory/inventory.js";
import { BACKEND_DESCRIPTIONS } from "../model/backend.js";
import type { FeatureMatch } from "../model/inventory.js";
import { renderOverviewReport } from "../report/overviewMarkdown.js";
import { writeJson, writeText } from "../store/store.js";
import type { CompareDeps } from "./compareCommand.js";

export const overviewPaths = (projectRoot: string) => ({
  inventory: path.join(projectRoot, CONFIG_DIR, "inventory.json"),
  report: path.join(projectRoot, CONFIG_DIR, "reports", "overview.md"),
});

interface Inventoried {
  verified: VerifiedInventory;
  usage: Usage;
}

export interface OverviewResult {
  matches: FeatureMatch[];
  reportFile: string;
  usage: Usage;
}

export async function runOverview(config: Config, deps: CompareDeps): Promise<OverviewResult> {
  const paths = overviewPaths(config.projectRoot);
  const limit = deps.backend === "api" ? ` (at most about $${(2 * config.maxBudgetUsd + 0.5).toFixed(2)})` : "";
  deps.log(`Mapping features with ${config.model} via ${BACKEND_DESCRIPTIONS[deps.backend]}${limit}…`);

  const results = await Promise.allSettled(
    (["android", "ios"] as const).map(async (platform): Promise<Inventoried> => {
      const { inventory, usage } = await extractInventory(deps.runner, config, platform);
      const verified = await verifyInventory(inventory, new FsSourceReader(config.platforms[platform]));
      const ok = verified.features.filter((f) => f.verified).length;
      deps.log(`  ${platform}: ${verified.features.length} features, ${ok} with a verified entry point`);
      return { verified, usage };
    }),
  );
  const usageOf = (r: PromiseSettledResult<Inventoried>): Usage =>
    r.status === "fulfilled" ? r.value.usage : r.reason instanceof AgentError ? r.reason.usage : NO_USAGE;
  let usage = results.map(usageOf).reduce(addUsage, NO_USAGE);

  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) {
    if (failure.reason instanceof AgentError) {
      const cost = deps.backend === "api" ? ` (this run cost about $${usage.costUsd.toFixed(2)})` : "";
      throw new AgentError(`${failure.reason.message}${cost}`, usage);
    }
    throw failure.reason;
  }
  const [android, ios] = results.map((r) => (r as PromiseFulfilledResult<Inventoried>).value.verified) as [
    VerifiedInventory,
    VerifiedInventory,
  ];

  const matched = await matchInventories(deps.llm, config.model, android, ios);
  usage = addUsage(usage, matched.usage);

  // Stored so `check` can map changed files to features later
  await writeJson(paths.inventory, { android, ios, matches: matched.matches });
  await writeText(
    paths.report,
    renderOverviewReport({
      android,
      ios,
      matches: matched.matches,
      model: config.model,
      backend: deps.backend,
      usage,
      generatedAt: deps.now().toISOString(),
    }),
  );
  return { matches: matched.matches, reportFile: paths.report, usage };
}
