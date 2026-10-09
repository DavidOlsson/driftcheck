import type { Config } from "../config/config.js";
import { addUsage, AgentError, NO_USAGE, type Usage } from "../extract/AgentRunner.js";
import type { Backend } from "../model/backend.js";
import { PLATFORMS, type Platform } from "../model/spec.js";

/** Dollar amounts only mean something for API keys; on a subscription they are noise, so they are left out. */
export function apiCost(backend: Backend, text: string): string {
  return backend === "api" ? text : "";
}

/**
 * Rough allowance for the one tool-less call (comparison or matching) with an API key: it has no budget
 * limit of its own, but is capped at 16,000 output tokens, which costs well under this.
 */
const TOOLLESS_CALL_ALLOWANCE_USD = 0.5;

/** Upper bound shown before a run: every agent run at its budget, plus the tool-less call. */
export function maxCostUsd(config: Config, agentRuns: number): number {
  return agentRuns * config.maxBudgetUsd + TOOLLESS_CALL_ALLOWANCE_USD;
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
    if (r.reason instanceof AgentError) throw withRunCost(backend, r.reason, usage);
    throw r.reason;
  }
  return { android: (android as PromiseFulfilledResult<T>).value, ios: (ios as PromiseFulfilledResult<T>).value, usage };
}

/**
 * Runs a step that follows paid agent runs. If it fails, the error carries what the whole command has
 * cost so far, not just the failed step.
 */
export async function afterPaidRuns<T>(backend: Backend, spent: Usage, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (e instanceof AgentError) throw withRunCost(backend, e, addUsage(spent, e.usage));
    throw e;
  }
}

function withRunCost(backend: Backend, error: AgentError, usage: Usage): AgentError {
  const cost = apiCost(backend, ` (this run cost about $${usage.costUsd.toFixed(2)})`);
  return new AgentError(`${error.message}${cost}`, usage, { cause: error.cause });
}
