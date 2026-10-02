import type { Platform } from "../../src/model/spec.js";
import type { VerifiedFeatureSpec } from "../../src/verify/verify.js";

/** A small verified description with a debounce item, used across tests. */
export function verifiedSpec(platform: Platform, debounce: string, file: string): VerifiedFeatureSpec {
  return {
    feature: "search",
    platform,
    summary: `Search on ${platform}`,
    notFound: platform === "ios" ? ["voice search"] : [],
    coverage: [
      { section: "input_handling", status: "covered", filesRead: [file] },
      { section: "presentation", status: platform === "android" ? "not_inspected" : "covered", filesRead: [] },
    ],
    items: [
      {
        key: "input_handling.debounce_ms",
        section: "input_handling",
        description: "Delay before searching",
        value: debounce,
        verified: true,
        evidence: [{ file, line: 10, quote: `debounce = ${debounce}`, status: "verified" }],
      },
    ],
  };
}

export const finding = (overrides: Record<string, unknown> = {}) => ({
  feature: "search",
  category: "behavior",
  severity: "high",
  title: "Different debounce",
  keys: ["input_handling.debounce_ms"],
  android: { summary: "200 ms", evidence: [{ file: "Search.kt", line: 10 }] },
  ios: { summary: "100 ms", evidence: [{ file: "Search.swift", line: 10 }] },
  question: "Is the difference intentional?",
  ...overrides,
});
