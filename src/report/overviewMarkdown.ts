import { stringify as toYaml } from "yaml";
import type { FeatureMatch, PresenceCheck, RunDetails, VerifiedInventory } from "../model/inventory.js";
import { featuresById, groupMatches, suggestedComparisons, type InventoryFeature } from "./overviewData.js";
import { cell, mdText, runDetailsLine } from "./shared.js";

export interface OverviewReportInput {
  android: VerifiedInventory;
  ios: VerifiedInventory;
  matches: FeatureMatch[];
  /** Missing for inventories stored before run details were recorded. */
  run?: RunDetails;
}

function side(feature: InventoryFeature | undefined): string {
  if (!feature) return "—";
  const entry = feature.entryPoints[0];
  const ref = entry ? ` (\`${entry.file}:${entry.line}\`${feature.verified ? "" : " ⚠️ unverified"})` : "";
  return cell(`✅ ${mdText(feature.name)}${ref}`);
}

/** The side of a platform-only row where the presence check looked for the feature. */
function checkedSide(check: PresenceCheck | undefined): string {
  if (!check) return "— (not checked)";
  const e = check.evidence[0];
  const ref = e ? ` (\`${e.file}:${e.line}\`)` : "";
  switch (check.status) {
    case "found":
      return cell(`✅ ${mdText(check.name || "found")}${ref}, found by the presence check`);
    case "part_of":
      return cell(`↪ part of ${mdText(check.name || "another feature")}${ref}`);
    case "not_found":
      return "— not found";
    case "unverified":
      return cell(`❓ claimed in ${mdText(check.name || "another feature")}${ref}, evidence not verified`);
  }
}

export function renderOverviewReport(input: OverviewReportInput): string {
  const { android, ios, matches, run } = input;
  const byId = featuresById(android, ios);
  const groups = groupMatches(matches);

  const out: string[] = [];
  out.push(`# Feature overview`, "");
  out.push(`| | Android | iOS |`, `|---|---|---|`, `| Summary | ${cell(mdText(android.summary))} | ${cell(mdText(ios.summary))} |`, "");
  out.push(`## Summary`, "", `| | Count |`, `|---|---|`);
  out.push(
    `| On both platforms | ${groups.both.length} |`,
    `| ↪ Structured differently | ${groups.different_structure.length} |`,
    `| 🟢 Android only | ${groups.android_only.length} |`,
    `| 🔵 iOS only | ${groups.ios_only.length} |`,
    `| ❓ Uncertain | ${groups.uncertain.length} |`,
    "",
  );

  const table = (title: string, intro: string, rows: FeatureMatch[]) => {
    if (rows.length === 0) return;
    out.push(`## ${title}`, "");
    if (intro) out.push(intro, "");
    out.push(`| Feature | Android | iOS | Notes |`, `|---|---|---|---|`);
    for (const m of rows) {
      const a = m.android ? side(byId.android.get(m.android)) : checkedSide(m.check);
      const i = m.ios ? side(byId.ios.get(m.ios)) : checkedSide(m.check);
      const notes = [m.note, m.check?.note].filter(Boolean).join(" ");
      const flag = m.deepCompare ? " 🔍" : "";
      out.push(`| ${cell(mdText(m.name))}${flag} | ${a} | ${i} | ${cell(mdText(notes))} |`);
    }
    out.push("");
  };
  table("On both platforms", "", groups.both);
  table("↪ Structured differently", "Exists on both platforms, but inside another feature on one of them.", groups.different_structure);
  table("🟢 Android only", "The iOS app was searched for these and nothing serving the same purpose was found.", groups.android_only);
  table("🔵 iOS only", "The Android app was searched for these and nothing serving the same purpose was found.", groups.ios_only);
  table("❓ Uncertain", "Not checked, or found only with evidence that did not verify. Check by hand.", groups.uncertain);

  const features = suggestedComparisons(matches, byId);
  if (features.length > 0) {
    out.push(`## 🔍 Suggested deep comparisons`, "");
    out.push("These shared features are the most likely to differ in ways users notice. Add them to `.driftcheck/config.yml` and run `driftcheck compare <id>`:", "");
    out.push("```yaml", toYaml({ features }).trimEnd(), "```", "");
  }

  const verified = (inv: VerifiedInventory) => inv.features.filter((f) => f.verified).length;
  out.push(`## How this was checked`, "");
  out.push(
    `- **Android:** ${android.features.length} features, ${verified(android)} with an entry point verified against the source`,
    `- **iOS:** ${ios.features.length} features, ${verified(ios)} with an entry point verified against the source`,
    `- Matching is done by the model from names and descriptions. Every feature listed on one platform only was then searched for on the other platform; only features that were not found are reported as platform-only.`,
  );
  if (run) out.push(runDetailsLine(run.model, run.backend, run.usage), `- **Generated:** ${run.generatedAt} by driftcheck`);
  out.push("");
  return out.join("\n");
}
