import type { VerifiedInventory } from "../inventory/inventory.js";
import { groupOf, type MatrixGroup } from "../inventory/presence.js";
import type { FeatureMatch } from "../model/inventory.js";

/** What the Markdown and HTML overview reports both show, derived once so the two can never disagree. */
export type InventoryFeature = VerifiedInventory["features"][number];

export interface FeaturesById {
  android: Map<string, InventoryFeature>;
  ios: Map<string, InventoryFeature>;
}

export function featuresById(android: VerifiedInventory, ios: VerifiedInventory): FeaturesById {
  return {
    android: new Map(android.features.map((f) => [f.id, f])),
    ios: new Map(ios.features.map((f) => [f.id, f])),
  };
}

/** Rows per report group, in input order. Every group is present, possibly empty. */
export function groupMatches(matches: FeatureMatch[]): Record<MatrixGroup, FeatureMatch[]> {
  const groups: Record<MatrixGroup, FeatureMatch[]> = { both: [], different_structure: [], android_only: [], ios_only: [], uncertain: [] };
  for (const m of matches) groups[groupOf(m)].push(m);
  return groups;
}

/** File names without folders or extensions make good hints for the agent in `compare`. */
export function hintsFor(...features: (InventoryFeature | undefined)[]): string[] {
  const names = features.flatMap((f) => [...(f?.entryPoints.map((e) => e.file) ?? []), ...(f?.files ?? [])]);
  const base = names.map((n) => n.split("/").pop()!.replace(/\.[a-z]+$/i, "")).filter(Boolean);
  return [...new Set(base)].slice(0, 6);
}

export interface SuggestedComparison {
  id: string;
  name: string;
  hints: string[];
}

/** Shared features worth a deep comparison, ready to paste into `.driftcheck/config.yml`. */
export function suggestedComparisons(matches: FeatureMatch[], byId: FeaturesById): SuggestedComparison[] {
  return groupMatches(matches)
    .both.filter((m) => m.deepCompare && m.android && m.ios)
    .map((m) => ({
      id: m.id,
      name: m.name,
      hints: hintsFor(m.android ? byId.android.get(m.android) : undefined, m.ios ? byId.ios.get(m.ios) : undefined),
    }));
}
