import { z } from "zod";
import type { Config, FeatureConfig } from "../config/config.js";
import { FeatureSpec, type Platform } from "../model/spec.js";
import { AgentError, type AgentRunner, type Usage } from "./AgentRunner.js";
import { featurePrompt, SYSTEM_PROMPT } from "./prompts.js";

export const FEATURE_SPEC_JSON_SCHEMA = z.toJSONSchema(FeatureSpec, { io: "input" }) as Record<string, unknown>;

export interface ExtractResult {
  spec: FeatureSpec;
  usage: Usage;
}

/** Lets one platform's agent describe a feature, and validates what comes back. */
export async function extractFeature(
  runner: AgentRunner,
  config: Config,
  feature: FeatureConfig,
  platform: Platform,
): Promise<ExtractResult> {
  const result = await runner.run({
    cwd: config.platforms[platform],
    systemPrompt: SYSTEM_PROMPT,
    prompt: featurePrompt(platform, feature),
    outputSchema: FEATURE_SPEC_JSON_SCHEMA,
    model: config.model,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
  });

  const parsed = FeatureSpec.safeParse(result.output);
  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AgentError(`The ${platform} agent returned output that does not match the feature schema (${problems})`);
  }
  // The agent is told which feature and platform to use, but the caller is the source of truth
  if (parsed.data.feature !== feature.id || parsed.data.platform !== platform) {
    throw new AgentError(
      `The ${platform} agent described "${parsed.data.feature}"/${parsed.data.platform} instead of "${feature.id}"/${platform}`,
    );
  }
  return { spec: parsed.data, usage: result.usage };
}
