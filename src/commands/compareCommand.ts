import { BACKEND_DESCRIPTIONS } from "../model/backend.js";
import { compareSpecs } from "../compare/compare.js";
import { findFeature, type Config } from "../config/config.js";
import { addUsage, type Usage } from "../extract/AgentRunner.js";
import { extractFeature } from "../extract/extract.js";
import { FsSourceReader } from "../io/fileReader.js";
import type { VerifiedFinding } from "../model/finding.js";
import { renderCompareReport } from "../report/markdown.js";
import { storePaths, writeJson, writeText } from "../store/store.js";
import { verifySpec, type VerifiedFeatureSpec } from "../verify/verify.js";
import type { ClaudeDeps } from "./deps.js";
import { afterPaidRuns, apiCost, maxCostUsd, runPerPlatform } from "./perPlatform.js";

interface Extracted {
  verified: VerifiedFeatureSpec;
  usage: Usage;
}

export interface CompareResult {
  findings: VerifiedFinding[];
  reportFile: string;
  usage: Usage;
}

export async function runCompare(config: Config, featureId: string, deps: ClaudeDeps): Promise<CompareResult> {
  const feature = findFeature(config, featureId);
  const paths = storePaths(config.projectRoot, feature.id);
  const limit = apiCost(deps.backend, ` (at most about $${maxCostUsd(config).toFixed(2)})`);
  deps.log(`Comparing "${feature.name}" with ${config.model} via ${BACKEND_DESCRIPTIONS[deps.backend]}${limit}…`);

  const extracted = await runPerPlatform(deps.backend, async (platform): Promise<Extracted> => {
    const { spec, usage } = await extractFeature(deps.runner, config, feature, platform);
    const verified = await verifySpec(spec, new FsSourceReader(config.platforms[platform]));
    const ok = verified.items.filter((i) => i.verified).length;
    const cost = apiCost(deps.backend, ` ($${usage.costUsd.toFixed(2)})`);
    deps.log(`  ${platform}: ${verified.items.length} items, ${ok} verified against the source${cost}`);
    return { verified, usage };
  });
  const android = extracted.android.verified;
  const ios = extracted.ios.verified;
  let usage = extracted.usage;

  const compared = await afterPaidRuns(deps.backend, usage, () => compareSpecs(deps.llm, config.model, android, ios));
  usage = addUsage(usage, compared.usage);

  // Written only after every step succeeded, so the stored specs and findings always belong to the same run
  await writeJson(config.projectRoot, paths.spec("android"), android);
  await writeJson(config.projectRoot, paths.spec("ios"), ios);
  await writeJson(config.projectRoot, paths.findings, compared.findings);
  await writeText(
    config.projectRoot,
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
