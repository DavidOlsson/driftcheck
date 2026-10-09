import type { Config } from "../config/config.js";
import { addUsage, AgentError, NO_USAGE, type Usage } from "../extract/AgentRunner.js";
import type { Backend } from "../model/backend.js";
import { PLATFORMS, type Platform } from "../model/spec.js";

/** Dollar amounts only mean something for API keys; on a subscription they are noise, so they are left out. */
export function apiCost(backend: Backend, text: string): string {
  return backend === "api" ? text : "";
}

/** Upper bound shown before a run: two agent runs at their budget plus a small allowance for the tool-less step. */
export function maxCostUsd(config: Config): number {
  return 2 * config.maxBudgetUsd + 0.5;
}

/**
 * Runs the same step for Android and iOS in parallel. If either fails, the error still carries what both
 * runs cost, because a failed agent run is billed too.
 */
export async function runPerPlatform<T extends { usage: Usage }>(
  backend: Backend,
  step: (platform: Platform) => Promise<T>,
): Promise<{ android: T; ios: T; usage: Usage }> {
  const [android, ios] = await Promise.allSettled(PLATFORMS.map(step)) as [PromiseSettledResult<T>, PromiseSettledResult<T>];
  const usageOf = (r: PromiseSettledResult<T>): Usage =>
    r.status === "fulfilled" ? r.value.usage : r.reason instanceof AgentError ? r.reason.usage : NO_USAGE;
  const usage = addUsage(usageOf(android), usageOf(ios));

  for (const r of [android, ios]) {
    if (r.status === "fulfilled") continue;
    if (r.reason instanceof AgentError) {
      throw new AgentError(`${r.reason.message}${apiCost(backend, ` (this run cost about $${usage.costUsd.toFixed(2)})`)}`, usage);
    }
    throw r.reason;
  }
  return { android: (android as PromiseFulfilledResult<T>).value, ios: (ios as PromiseFulfilledResult<T>).value, usage };
}
