import type { Config, FeatureConfig } from "../config/config.js";
import { toOutputJsonSchema } from "../model/jsonSchema.js";
import { FeatureSpec, type Platform } from "../model/spec.js";
import { AgentError, type AgentRunner, type Usage } from "./AgentRunner.js";
import { featurePrompt, SYSTEM_PROMPT } from "./prompts.js";
import { runStructuredAgent } from "./structured.js";

export const FEATURE_SPEC_JSON_SCHEMA = toOutputJsonSchema(FeatureSpec);

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
  const { output: spec, usage } = await runStructuredAgent(runner, config, platform, {
    systemPrompt: SYSTEM_PROMPT,
    prompt: featurePrompt(platform, feature),
    schema: FeatureSpec,
    outputSchema: FEATURE_SPEC_JSON_SCHEMA,
    label: "feature description",
  });
  // The agent is told which feature and platform to use, but the caller is the source of truth
  if (spec.feature !== feature.id || spec.platform !== platform) {
    throw new AgentError(`The ${platform} agent described "${spec.feature}"/${spec.platform} instead of "${feature.id}"/${platform}`, usage);
  }
  return { spec, usage };
}
