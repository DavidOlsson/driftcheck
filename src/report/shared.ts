import type { PlanWindow, Usage } from "../extract/AgentRunner.js";
import { BACKEND_DESCRIPTIONS, type Backend } from "../model/backend.js";

/** Markdown table cells must not break the table. */
export function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Text from the model, the analyzed code or its config, made inert for Markdown. Reports may be posted as
 * pull request comments, where raw HTML, links and images (which load a URL when viewed, and can leak
 * data through it) must not come from untrusted text. Line breaks become spaces, so the text cannot
 * start headings or list items either. Light formatting such as backticks and emphasis is kept.
 */
export function mdText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[[\]]/g, (c) => `\\${c}`)
    // Only "<" can open HTML; ">" is harmless once line breaks are gone, and stays readable
    .replace(/</g, "&lt;")
    .replace(/\s*\r?\n\s*/g, " ");
}

export function tokenCounts(usage: Usage): string {
  return `${usage.inputTokens.toLocaleString("en")} in, ${usage.outputTokens.toLocaleString("en")} out`;
}

/** The "how this was run" line at the bottom of every Markdown report. */
export function runDetailsLine(model: string, backend: Backend, usage: Usage): string {
  return `- **Model:** \`${model}\` via ${BACKEND_DESCRIPTIONS[backend]} · **Tokens:** ${tokenCounts(usage)} · ${usageLabel(backend, usage)}`;
}

/** Reports must not depend on the machine's time zone, so reset times are shown in UTC. */
export function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function windowState(window: PlanWindow): string {
  const used = window.usedPercent !== undefined ? `${window.usedPercent}% used` : null;
  switch (window.status) {
    case "rejected":
      return "limit reached";
    case "allowed_warning": {
      const over = window.thresholdPercent !== undefined ? `over ${window.thresholdPercent}% used` : used;
      return `approaching limit${over ? ` (${over})` : ""}`;
    }
    default:
      return used ?? "OK";
  }
}

function formatWindow(name: string, window: PlanWindow | undefined, formatTime: (iso: string) => string): string | null {
  if (!window) return null;
  return `${name} ${windowState(window)}${window.resetsAt ? `, resets ${formatTime(window.resetsAt)}` : ""}`;
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
