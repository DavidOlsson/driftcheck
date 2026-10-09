import { readFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, ConfigError, type Config } from "../config/config.js";
import { addUsage, AgentError, NO_USAGE, type Usage } from "../extract/AgentRunner.js";
import { FsSourceReader } from "../io/fileReader.js";
import { extractInventory, matchInventories, verifyInventory, type VerifiedInventory } from "../inventory/inventory.js";
import { applyChecks, candidatesFor, runPresenceCheck } from "../inventory/presence.js";
import { BACKEND_DESCRIPTIONS } from "../model/backend.js";
import { StoredInventory, type FeatureMatch, type RunDetails } from "../model/inventory.js";
import { renderOverviewHtml } from "../report/overviewHtml.js";
import { renderOverviewReport, type OverviewReportInput } from "../report/overviewMarkdown.js";
import { writeJson, writeText } from "../store/store.js";
import type { ClaudeDeps } from "./deps.js";
import { apiCost, maxCostUsd, runPerPlatform } from "./perPlatform.js";

export const overviewPaths = (projectRoot: string) => ({
  inventory: path.join(projectRoot, CONFIG_DIR, "inventory.json"),
  report: path.join(projectRoot, CONFIG_DIR, "reports", "overview.md"),
  html: path.join(projectRoot, CONFIG_DIR, "reports", "overview.html"),
});

/** Writes both report formats from the same data, so they never disagree. */
export async function writeOverviewReports(projectRoot: string, input: OverviewReportInput): Promise<{ report: string; html: string }> {
  const paths = overviewPaths(projectRoot);
  await writeText(paths.report, renderOverviewReport(input));
  await writeText(paths.html, renderOverviewHtml(input));
  return { report: paths.report, html: paths.html };
}

/** Rebuilds the reports from the stored inventory without calling Claude, e.g. after a report format change. */
export async function rerenderOverview(projectRoot: string): Promise<{ report: string; html: string }> {
  const file = overviewPaths(projectRoot).inventory;
  const name = path.relative(projectRoot, file);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new ConfigError(`No readable ${name}. Run "driftcheck overview" first.`);
  }
  const parsed = StoredInventory.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ConfigError(`${name} does not look like a driftcheck inventory (${problems}). Run "driftcheck overview" again.`);
  }
  const { android, ios, matches, meta } = parsed.data;
  return writeOverviewReports(projectRoot, { android, ios, matches, run: meta });
}

interface Inventoried {
  verified: VerifiedInventory;
  usage: Usage;
}

export interface OverviewResult {
  matches: FeatureMatch[];
  reportFile: string;
  htmlFile: string;
  usage: Usage;
}

export async function runOverview(config: Config, deps: ClaudeDeps): Promise<OverviewResult> {
  const paths = overviewPaths(config.projectRoot);
  const limit = apiCost(deps.backend, ` (at most about $${maxCostUsd(config).toFixed(2)})`);
  deps.log(`Mapping features with ${config.model} via ${BACKEND_DESCRIPTIONS[deps.backend]}${limit}…`);

  const inventoried = await runPerPlatform(deps.backend, async (platform): Promise<Inventoried> => {
    const { inventory, usage } = await extractInventory(deps.runner, config, platform);
    const verified = await verifyInventory(inventory, new FsSourceReader(config.platforms[platform]));
    const ok = verified.features.filter((f) => f.verified).length;
    deps.log(`  ${platform}: ${verified.features.length} features, ${ok} with a verified entry point`);
    return { verified, usage };
  });
  const android = inventoried.android.verified;
  const ios = inventoried.ios.verified;
  let usage = inventoried.usage;

  const matched = await matchInventories(deps.llm, config.model, android, ios);
  usage = addUsage(usage, matched.usage);

  // Look for each platform-only feature on the other platform before calling it missing
  const describe = (inventory: VerifiedInventory, id: string | null) =>
    inventory.features.find((f) => f.id === id)?.description ?? "";
  const checkResults = await Promise.allSettled(
    (["android", "ios"] as const).map(async (platform) => {
      const candidates = candidatesFor(platform, matched.matches, (row) =>
        platform === "android" ? describe(ios, row.ios) : describe(android, row.android),
      );
      if (candidates.length === 0) return { checks: new Map(), usage: NO_USAGE };
      deps.log(`  checking ${candidates.length} features that ${platform} seems to lack…`);
      return runPresenceCheck(deps.runner, config, platform, candidates, new FsSourceReader(config.platforms[platform]));
    }),
  );
  let matches = matched.matches;
  for (const [i, r] of checkResults.entries()) {
    const platform = i === 0 ? "android" : "ios";
    if (r.status === "fulfilled") {
      usage = addUsage(usage, r.value.usage);
      matches = applyChecks(matches, r.value.checks);
    } else {
      // A failed check leaves those rows as "uncertain" instead of failing the whole overview
      if (r.reason instanceof AgentError) usage = addUsage(usage, r.reason.usage);
      deps.log(`  ${platform} presence check failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  }

  const meta: RunDetails = { model: config.model, backend: deps.backend, usage, generatedAt: deps.now().toISOString() };
  // Stored so `check` can map changed files to features later, and so reports can be rebuilt for free
  const stored: StoredInventory = { android, ios, matches, meta };
  await writeJson(paths.inventory, stored);
  const files = await writeOverviewReports(config.projectRoot, { android, ios, matches, run: meta });
  return { matches, reportFile: files.report, htmlFile: files.html, usage };
}
