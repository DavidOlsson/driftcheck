import { BACKEND_DESCRIPTIONS, type Backend } from "../model/backend.js";
import type { PlanWindow, Usage } from "../extract/AgentRunner.js";
import type { Finding, FindingCategory, PlatformSide } from "../model/finding.js";
import type { Platform } from "../model/spec.js";
import { summarizeVerification, type VerifiedFeatureSpec } from "../verify/verify.js";

export interface CompareReportInput {
  featureName: string;
  android: VerifiedFeatureSpec;
  ios: VerifiedFeatureSpec;
  findings: Finding[];
  model: string;
  /** Subscription runs are not billed per token, so the cost is shown as an API-equivalent estimate. */
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

/** Table cells must not break the Markdown table. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function side(s: PlatformSide | null): string {
  if (!s) return "—";
  const refs = s.evidence.map((e) => `\`${e.file}:${e.line}\``).join(", ");
  return cell(refs ? `${s.summary} (${refs})` : s.summary);
}

function verificationLine(platform: Platform, spec: VerifiedFeatureSpec): string {
  const s = summarizeVerification(spec);
  return `- **${platform === "android" ? "Android" : "iOS"}:** ${s.verifiedItems} of ${s.items} items verified against the source`;
}

/** Reports must not depend on the machine's time zone, so reset times are shown in UTC. */
export function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function formatWindow(name: string, window: PlanWindow | undefined, formatTime: (iso: string) => string): string | null {
  if (!window) return null;
  const used = window.usedPercent !== undefined ? `${window.usedPercent}% used` : "usage unknown";
  return `${name} ${used}${window.resetsAt ? ` (resets ${formatTime(window.resetsAt)})` : ""}`;
}

/**
 * What a run "cost": dollars for API keys; for subscriptions the dollar estimate is noise, so the
 * plan's 5-hour and weekly windows are shown instead, when Claude Code reported them.
 */
export function usageLabel(backend: Backend, usage: Usage, formatTime: (iso: string) => string = formatUtc): string {
  if (backend === "api") return `**Estimated cost:** $${usage.costUsd.toFixed(2)}`;
  const windows = [
    formatWindow("5-hour window", usage.plan?.fiveHour, formatTime),
    formatWindow("weekly limit", usage.plan?.weekly, formatTime),
  ].filter((w): w is string => w !== null);
  return windows.length > 0
    ? `**Plan usage:** ${windows.join(" · ")}`
    : "**Plan usage:** not reported by Claude Code for this run";
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
  const notFound = [...android.notFound.map((n) => `Android: ${n}`), ...ios.notFound.map((n) => `iOS: ${n}`)];
  if (notFound.length > 0) out.push(`- **Looked for but not found:** ${notFound.map(cell).join("; ")}`);
  out.push(
    `- **Model:** \`${model}\` via ${BACKEND_DESCRIPTIONS[backend]} · **Tokens:** ${usage.inputTokens.toLocaleString("en")} in, ${usage.outputTokens.toLocaleString("en")} out · ${usageLabel(backend, usage)}`,
    `- **Generated:** ${generatedAt} by driftcheck`,
    "",
  );
  return out.join("\n");
}
