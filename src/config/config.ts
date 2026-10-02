import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Platform } from "../model/spec.js";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_MAX_TURNS = 40;
export const DEFAULT_MAX_BUDGET_USD = 2;
export const CONFIG_DIR = ".driftcheck";
export const CONFIG_FILE = "config.yml";

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
  model: z.string().min(1).default(DEFAULT_MODEL),
  maxTurns: z.number().int().positive().default(DEFAULT_MAX_TURNS),
  maxBudgetUsd: z.number().positive().default(DEFAULT_MAX_BUDGET_USD),
});

export type FeatureConfig = z.infer<typeof FeatureConfig>;

export interface Config {
  /** Directory that contains `.driftcheck/`; platform paths are resolved against it. */
  projectRoot: string;
  /** Absolute platform source roots. */
  platforms: Record<Platform, string>;
  features: FeatureConfig[];
  model: string;
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
    maxTurns: c.maxTurns,
    maxBudgetUsd: c.maxBudgetUsd,
  };
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

# Optional overrides:
# model: ${DEFAULT_MODEL}
# maxTurns: ${DEFAULT_MAX_TURNS}
# maxBudgetUsd: ${DEFAULT_MAX_BUDGET_USD}
`;
