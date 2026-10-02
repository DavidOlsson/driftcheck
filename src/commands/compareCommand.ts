import { BACKEND_DESCRIPTIONS, type Backend } from "../model/backend.js";
import { compareSpecs } from "../compare/compare.js";
import { findFeature, type Config } from "../config/config.js";
import { addUsage, AgentError, NO_USAGE, type AgentRunner, type Usage } from "../extract/AgentRunner.js";
import { extractFeature } from "../extract/extract.js";
import { FsSourceReader } from "../io/fileReader.js";
import type { LlmClient } from "../llm/LlmClient.js";
import type { Finding } from "../model/finding.js";
import { renderCompareReport } from "../report/markdown.js";
import { storePaths, writeJson, writeText } from "../store/store.js";
import { verifySpec, type VerifiedFeatureSpec } from "../verify/verify.js";

export interface CompareDeps {
  backend: Backend;
  runner: AgentRunner;
  llm: LlmClient;
  now: () => Date;
  log: (message: string) => void;
}

interface Extracted {
  verified: VerifiedFeatureSpec;
  usage: Usage;
}

export interface CompareResult {
  findings: Finding[];
  reportFile: string;
  usage: Usage;
}

/** Upper bound shown before a run: two agent runs at their budget plus a small allowance for the comparison. */
export function maxCostUsd(config: Config): number {
  return 2 * config.maxBudgetUsd + 0.5;
}

export async function runCompare(config: Config, featureId: string, deps: CompareDeps): Promise<CompareResult> {
  const feature = findFeature(config, featureId);
  const paths = storePaths(config.projectRoot, feature.id);
  deps.log(`Comparing "${feature.name}" with ${config.model} via ${BACKEND_DESCRIPTIONS[deps.backend]} (at most about $${maxCostUsd(config).toFixed(2)})…`);

  // Both platforms in parallel; if one fails, the other's cost is still reported
  const results = await Promise.allSettled(
    (["android", "ios"] as const).map(async (platform): Promise<Extracted> => {
      const { spec, usage } = await extractFeature(deps.runner, config, feature, platform);
      const verified = await verifySpec(spec, new FsSourceReader(config.platforms[platform]));
      await writeJson(paths.spec(platform), verified);
      const ok = verified.items.filter((i) => i.verified).length;
      deps.log(`  ${platform}: ${verified.items.length} items, ${ok} verified against the source ($${usage.costUsd.toFixed(2)})`);
      return { verified, usage };
    }),
  );
  const usageOf = (r: PromiseSettledResult<Extracted>): Usage =>
    r.status === "fulfilled" ? r.value.usage : r.reason instanceof AgentError ? r.reason.usage : NO_USAGE;
  let usage = results.map(usageOf).reduce(addUsage, NO_USAGE);

  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) {
    if (failure.reason instanceof AgentError) {
      throw new AgentError(`${failure.reason.message} (this run cost about $${usage.costUsd.toFixed(2)})`, usage);
    }
    throw failure.reason;
  }
  const [android, ios] = results.map((r) => (r as PromiseFulfilledResult<Extracted>).value.verified) as [
    VerifiedFeatureSpec,
    VerifiedFeatureSpec,
  ];

  const compared = await compareSpecs(deps.llm, config.model, android, ios);
  usage = addUsage(usage, compared.usage);

  await writeJson(paths.findings, compared.findings);
  await writeText(
    paths.report,
    renderCompareReport({
      featureName: feature.name,
      android,
      ios,
      findings: compared.findings,
      model: config.model,
      backend: deps.backend,
      usage,
      generatedAt: deps.now().toISOString(),
    }),
  );
  return { findings: compared.findings, reportFile: paths.report, usage };
}
