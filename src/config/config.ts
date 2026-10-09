import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Platform } from "../model/spec.js";
import { BACKENDS, type BackendChoice } from "../model/backend.js";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_MAX_TURNS = 40;
export const DEFAULT_MAX_BUDGET_USD = 2;
/**
 * Upper limits, because the config lives in the analyzed repository and may come from an untrusted
 * pull request: it must not be able to make a run arbitrarily expensive.
 */
export const MAX_TURNS_LIMIT = 200;
export const MAX_BUDGET_USD_LIMIT = 20;
export const CONFIG_DIR = ".driftcheck";
export const CONFIG_FILE = "config.yml";

/**
 * Model ids are passed to the `claude` CLI as an argument, so a value starting with "-" could be read as a
 * flag. Allows API ids, aliases and Bedrock/Vertex ids such as "claude-opus-5-5[1m]" or "...-v1:0".
 */
export const ModelName = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]*$/, "model must be a model id such as claude-sonnet-5-5");

const PlatformConfig = z.object({
  /** Path to the platform's source root, relative to the config file's project root. */
  path: z.string().min(1),
});

const FeatureConfig = z.object({
  /** Stable id used in file names and on the command line, e.g. "search". */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "feature id must be lowercase letters, digits and dashes"),
  name: z.string().min(1),
  /** Optional pointers that help the agent find the feature faster (class names, folders, screen names). */
  hints: z.array(z.string()).default([]),
});

const RawConfig = z.object({
  version: z.literal(1),
  platforms: z.object({ android: PlatformConfig, ios: PlatformConfig }),
  features: z.array(FeatureConfig).default([]),
  model: ModelName.default(DEFAULT_MODEL),
  /** How Claude is reached: "auto" uses ANTHROPIC_API_KEY if set, otherwise the Claude Code CLI. */
  backend: z.enum(BACKENDS).default("auto"),
  maxTurns: z.number().int().positive().max(MAX_TURNS_LIMIT, `maxTurns can be at most ${MAX_TURNS_LIMIT}`).default(DEFAULT_MAX_TURNS),
  maxBudgetUsd: z
    .number()
    .positive()
    .max(MAX_BUDGET_USD_LIMIT, `maxBudgetUsd can be at most ${MAX_BUDGET_USD_LIMIT} per agent run`)
    .default(DEFAULT_MAX_BUDGET_USD),
});

export type FeatureConfig = z.infer<typeof FeatureConfig>;

export interface Config {
  /** Directory that contains `.driftcheck/`; platform paths are resolved against it. */
  projectRoot: string;
  /** Absolute platform source roots. */
  platforms: Record<Platform, string>;
  features: FeatureConfig[];
  model: string;
  backend: BackendChoice;
  maxTurns: number;
  maxBudgetUsd: number;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Parses and validates a config file's contents. Pure: the caller does the file I/O, which keeps
 * this testable and lets the CLI decide how to report a missing file.
 */
export function parseConfig(yamlText: string, projectRoot: string): Config {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    throw new ConfigError(`${CONFIG_DIR}/${CONFIG_FILE} is not valid YAML: ${(e as Error).message}`);
  }
  const result = RawConfig.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new ConfigError(`${CONFIG_DIR}/${CONFIG_FILE} is invalid:\n${problems}`);
  }
  const c = result.data;
  const ids = c.features.map((f) => f.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new ConfigError(`Duplicate feature ids in ${CONFIG_DIR}/${CONFIG_FILE}: ${[...new Set(duplicates)].join(", ")}`);
  }
  return {
    projectRoot,
    platforms: {
      android: path.resolve(projectRoot, c.platforms.android.path),
      ios: path.resolve(projectRoot, c.platforms.ios.path),
    },
    features: c.features,
    model: c.model,
    backend: c.backend,
    maxTurns: c.maxTurns,
    maxBudgetUsd: c.maxBudgetUsd,
  };
}

/** Validates a model given on the command line the same way as one in the config. */
export function parseModel(value: string): string {
  const result = ModelName.safeParse(value);
  if (!result.success) throw new ConfigError(`Invalid --model "${value}": ${result.error.issues[0]?.message}`);
  return result.data;
}

export function findFeature(config: Config, id: string): FeatureConfig {
  const feature = config.features.find((f) => f.id === id);
  if (!feature) {
    const known = config.features.map((f) => f.id).join(", ") || "none";
    throw new ConfigError(`Unknown feature "${id}". Configured features: ${known}`);
  }
  return feature;
}

export const CONFIG_TEMPLATE = `# driftcheck configuration
version: 1

# Source roots of the two apps, relative to this project's root.
platforms:
  android:
    path: android
  ios:
    path: ios

# Features to compare. Hints are optional pointers (class names, folders, screens)
# that help the agent find the feature faster.
features:
  - id: search
    name: Search
    hints: []

# How Claude is reached: auto (API key if ANTHROPIC_API_KEY is set, otherwise the
# Claude Code CLI with your Claude subscription), api or claude-code.
# backend: auto

# Optional overrides:
# model: ${DEFAULT_MODEL}
# maxTurns: ${DEFAULT_MAX_TURNS}  # at most ${MAX_TURNS_LIMIT}
# maxBudgetUsd: ${DEFAULT_MAX_BUDGET_USD}  # USD per agent run, at most ${MAX_BUDGET_USD_LIMIT}
`;
