import type { Backend } from "../model/backend.js";
import type { Usage } from "../extract/AgentRunner.js";
import type { Finding, FindingCategory, PlatformSide } from "../model/finding.js";
import type { Platform } from "../model/spec.js";
import { summarizeVerification, type VerifiedFeatureSpec } from "../verify/verify.js";
import { cell, runDetailsLine } from "./shared.js";

export interface CompareReportInput {
  featureName: string;
  android: VerifiedFeatureSpec;
  ios: VerifiedFeatureSpec;
  findings: Finding[];
  model: string;
  /** Decides how usage is shown: estimated dollars for API keys, plan limits for Claude Code subscriptions. */
  backend: Backend;
  usage: Usage;
  /** ISO timestamp, passed in so rendering stays deterministic in tests. */
  generatedAt: string;
}

const SECTIONS: { category: FindingCategory; title: string }[] = [
  { category: "behavior", title: "🔴 Behavior differences" },
  { category: "bug", title: "🟠 Possible bugs or gaps" },
  { category: "missing", title: "🟣 Only on one platform" },
  { category: "ui", title: "🟡 UI differences" },
  { category: "equal", title: "✅ Same on both platforms" },
];

function side(s: PlatformSide | null): string {
  if (!s) return "—";
  const refs = s.evidence.map((e) => `\`${e.file}:${e.line}\``).join(", ");
  return cell(refs ? `${s.summary} (${refs})` : s.summary);
}

function verificationLine(platform: Platform, spec: VerifiedFeatureSpec): string {
  const s = summarizeVerification(spec);
  return `- **${platform === "android" ? "Android" : "iOS"}:** ${s.verifiedItems} of ${s.items} items verified against the source`;
}

export function renderCompareReport(input: CompareReportInput): string {
  const { featureName, android, ios, findings, model, backend, usage, generatedAt } = input;
  const count = (c: FindingCategory) => findings.filter((f) => f.category === c).length;

  const out: string[] = [];
  out.push(`# Parity report: ${featureName}`, "");
  out.push(`| | Android | iOS |`, `|---|---|---|`);
  out.push(`| Summary | ${cell(android.summary)} | ${cell(ios.summary)} |`, "");

  out.push(`## Summary`, "", `| Category | Count |`, `|---|---|`);
  for (const { category, title } of SECTIONS) out.push(`| ${title} | ${count(category)} |`);
  out.push("");

  for (const { category, title } of SECTIONS) {
    const items = findings.filter((f) => f.category === category);
    if (items.length === 0) continue;
    out.push(`## ${title}`, "", `| # | Severity | Finding | Android | iOS |`, `|---|---|---|---|---|`);
    items.forEach((f, i) => {
      out.push(`| ${i + 1} | ${f.severity} | ${cell(f.title)} | ${side(f.android)} | ${side(f.ios)} |`);
    });
    out.push("");
  }

  const questions = findings.filter((f) => f.question);
  if (questions.length > 0) {
    out.push(`## Questions for the team`, "");
    questions.forEach((f, i) => out.push(`${i + 1}. ${f.question}`));
    out.push("");
  }

  out.push(`## How this was checked`, "");
  out.push(verificationLine("android", android), verificationLine("ios", ios));
  for (const [platform, spec] of [["Android", android], ["iOS", ios]] as const) {
    const gaps = spec.coverage.filter((c) => c.status === "not_inspected").map((c) => c.section);
    if (spec.coverage.length > 0 && gaps.length > 0) {
      out.push(`- ⚠️ **${platform} sections not inspected:** ${gaps.join(", ")}. Differences there may be missing from this report.`);
    }
  }
  const notFound = [...android.notFound.map((n) => `Android: ${n}`), ...ios.notFound.map((n) => `iOS: ${n}`)];
  if (notFound.length > 0) out.push(`- **Looked for but not found:** ${notFound.map(cell).join("; ")}`);
  out.push(
    runDetailsLine(model, backend, usage),
    `- **Generated:** ${generatedAt} by driftcheck`,
    "",
  );
  return out.join("\n");
}
