import { stringify as toYaml } from "yaml";
import type { Usage } from "../extract/AgentRunner.js";
import type { VerifiedInventory } from "../inventory/inventory.js";
import { BACKEND_DESCRIPTIONS, type Backend } from "../model/backend.js";
import type { FeatureMatch } from "../model/inventory.js";
import { usageLabel } from "./markdown.js";

export interface OverviewReportInput {
  android: VerifiedInventory;
  ios: VerifiedInventory;
  matches: FeatureMatch[];
  model: string;
  backend: Backend;
  usage: Usage;
  generatedAt: string;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

type InventoryFeature = VerifiedInventory["features"][number];

function side(feature: InventoryFeature | undefined): string {
  if (!feature) return "—";
  const entry = feature.entryPoints[0];
  const ref = entry ? ` (\`${entry.file}:${entry.line}\`${feature.verified ? "" : " ⚠️ unverified"})` : "";
  return cell(`✅ ${feature.name}${ref}`);
}

/** File names without folders or extensions make good hints for the agent in `compare`. */
function hintsFor(...features: (InventoryFeature | undefined)[]): string[] {
  const names = features.flatMap((f) => [...(f?.entryPoints.map((e) => e.file) ?? []), ...(f?.files ?? [])]);
  const base = names.map((n) => n.split("/").pop()!.replace(/\.[a-z]+$/i, "")).filter(Boolean);
  return [...new Set(base)].slice(0, 6);
}

export function renderOverviewReport(input: OverviewReportInput): string {
  const { android, ios, matches, model, backend, usage, generatedAt } = input;
  const byId = {
    android: new Map(android.features.map((f) => [f.id, f])),
    ios: new Map(ios.features.map((f) => [f.id, f])),
  };
  const both = matches.filter((m) => m.android && m.ios);
  const androidOnly = matches.filter((m) => m.android && !m.ios);
  const iosOnly = matches.filter((m) => !m.android && m.ios);

  const out: string[] = [];
  out.push(`# Feature overview`, "");
  out.push(`| | Android | iOS |`, `|---|---|---|`, `| Summary | ${cell(android.summary)} | ${cell(ios.summary)} |`, "");
  out.push(`## Summary`, "", `| | Count |`, `|---|---|`);
  out.push(`| On both platforms | ${both.length} |`, `| 🟢 Android only | ${androidOnly.length} |`, `| 🔵 iOS only | ${iosOnly.length} |`, "");

  const table = (title: string, rows: FeatureMatch[]) => {
    if (rows.length === 0) return;
    out.push(`## ${title}`, "", `| Feature | Android | iOS | Notes |`, `|---|---|---|---|`);
    for (const m of rows) {
      const a = m.android ? byId.android.get(m.android) : undefined;
      const i = m.ios ? byId.ios.get(m.ios) : undefined;
      const flag = m.deepCompare ? " 🔍" : "";
      out.push(`| ${cell(m.name)}${flag} | ${side(a)} | ${side(i)} | ${cell(m.note)} |`);
    }
    out.push("");
  };
  table("On both platforms", both);
  table("🟢 Android only", androidOnly);
  table("🔵 iOS only", iosOnly);

  const suggested = both.filter((m) => m.deepCompare);
  if (suggested.length > 0) {
    out.push(`## 🔍 Suggested deep comparisons`, "");
    out.push("These shared features are the most likely to differ in ways users notice. Add them to `.driftcheck/config.yml` and run `driftcheck compare <id>`:", "");
    const features = suggested.map((m) => ({
      id: m.id,
      name: m.name,
      hints: hintsFor(m.android ? byId.android.get(m.android) : undefined, m.ios ? byId.ios.get(m.ios) : undefined),
    }));
    out.push("```yaml", toYaml({ features }).trimEnd(), "```", "");
  }

  const verified = (inv: VerifiedInventory) => inv.features.filter((f) => f.verified).length;
  out.push(`## How this was checked`, "");
  out.push(
    `- **Android:** ${android.features.length} features, ${verified(android)} with an entry point verified against the source`,
    `- **iOS:** ${ios.features.length} features, ${verified(ios)} with an entry point verified against the source`,
    `- Matching is done by the model from names and descriptions; check notes marked as uncertain.`,
    `- **Model:** \`${model}\` via ${BACKEND_DESCRIPTIONS[backend]} · **Tokens:** ${usage.inputTokens.toLocaleString("en")} in, ${usage.outputTokens.toLocaleString("en")} out · ${usageLabel(backend, usage)}`,
    `- **Generated:** ${generatedAt} by driftcheck`,
    "",
  );
  return out.join("\n");
}
