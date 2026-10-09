import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../src/llm/pricing.js";
import type { VerifiedFinding } from "../src/model/finding.js";
import { renderCompareReport } from "../src/report/markdown.js";
import { usageLabel } from "../src/report/shared.js";
import { verifiedFinding, verifiedSpec } from "./helpers/specs.js";

const report = (findings: VerifiedFinding[], backend: "api" | "claude-code" = "api") =>
  renderCompareReport({
    featureName: "Search",
    android: verifiedSpec("android", "200", "Search.kt"),
    ios: verifiedSpec("ios", "100", "Search.swift"),
    findings,
    model: "claude-sonnet-5-5",
    backend,
    usage: { inputTokens: 12345, outputTokens: 678, costUsd: 0.4567 },
    generatedAt: "2026-10-02T10:00:00.000Z",
  });

describe("renderCompareReport", () => {
  it("summarizes counts per category and renders each finding with evidence", () => {
    const text = report([
      verifiedFinding(),
      verifiedFinding({ category: "missing", severity: "medium", title: "Voice search", ios: null, question: undefined }),
    ] as VerifiedFinding[]);

    expect(text).toContain("# Parity report: Search");
    expect(text).toContain("| 🔴 Behavior differences | 1 |");
    expect(text).toContain("| 🟣 Only on one platform | 1 |");
    expect(text).toContain("| ✅ Same on both platforms | 0 |");
    expect(text).toContain("| 1 | high | Different debounce | 200 ms (`Search.kt:10`) | 100 ms (`Search.swift:10`) |");
    expect(text).toContain("| 1 | medium | Voice search | 200 ms (`Search.kt:10`) | — |");
    expect(text).not.toContain("## ✅ Same on both platforms");
  });

  it("lists questions, verification, things not found and cost", () => {
    const text = report([verifiedFinding()] as VerifiedFinding[]);
    expect(text).toContain("## Questions for the team");
    expect(text).toContain("1. Is the difference intentional?");
    expect(text).toContain("**Android:** 1 of 1 items verified");
    expect(text).toContain("iOS: voice search");
    expect(text).toContain("12,345 in, 678 out");
    expect(text).toContain("$0.46");
    expect(text).toContain("2026-10-02T10:00:00.000Z");
  });

  it("shows plan usage instead of a dollar estimate for subscription runs", () => {
    const text = report([verifiedFinding()] as VerifiedFinding[], "claude-code");
    expect(text).toContain("via Claude Code CLI (your Claude subscription)");
    expect(text).not.toContain("$0.46");
    expect(text).toContain("**Plan usage:** not reported by Claude Code for this run");
    expect(report([verifiedFinding()] as VerifiedFinding[])).toContain("via Anthropic API (ANTHROPIC_API_KEY)");
  });

  it("warns about sections a platform did not inspect", () => {
    const text = report([verifiedFinding()] as VerifiedFinding[]);
    expect(text).toContain("⚠️ **Android sections not inspected:** presentation");
    expect(text).not.toContain("iOS sections not inspected");
  });

  it("marks references that could not be confirmed and counts them for the findings", () => {
    const text = report([
      verifiedFinding({
        android: { summary: "200 ms", evidence: [{ file: "Search.kt", line: 10, quote: "debounce = 200", status: "quote_not_found" }] },
      }),
    ] as VerifiedFinding[]);
    expect(text).toContain("| 1 | high | Different debounce | 200 ms (`Search.kt:10` ⚠️) | 100 ms (`Search.swift:10`) |");
    expect(text).toContain("- **Findings:** 1 of 2 source references verified; ⚠️ marks the ones that could not be confirmed");
    expect(text).not.toContain("without a source reference");
  });

  it("lists findings that cite no source at all", () => {
    const text = report([
      verifiedFinding(),
      verifiedFinding({ title: "Unbacked", android: { summary: "x", evidence: [] }, ios: null }),
    ] as VerifiedFinding[]);
    expect(text).toContain("- ⚠️ **Findings without a source reference:** Unbacked");
  });

  it("keeps table cells intact when text contains pipes or newlines", () => {
    const text = report([verifiedFinding({ title: "a | b\nc" })] as VerifiedFinding[]);
    expect(text).toContain("a \\| b c");
  });
});

describe("usageLabel", () => {
  const usage = { inputTokens: 1, outputTokens: 1, costUsd: 0.62 };

  it("shows dollars for API runs", () => {
    expect(usageLabel("api", usage)).toBe("**Estimated cost:** $0.62");
  });

  it("shows the 5-hour and weekly windows in UTC for subscription runs", () => {
    const plan = {
      fiveHour: { usedPercent: 34, resetsAt: "2026-10-02T15:40:00.000Z" },
      weekly: { usedPercent: 12, resetsAt: "2026-10-05T08:00:00.000Z" },
    };
    expect(usageLabel("claude-code", { ...usage, plan })).toBe(
      "**Plan usage:** 5-hour window 34% used, resets 2026-10-02 15:40 UTC · weekly limit 12% used, resets 2026-10-05 08:00 UTC",
    );
  });

  it("uses the status when no percentage is reported, as Claude Code usually does", () => {
    const ok = { fiveHour: { status: "allowed" as const, resetsAt: "2026-10-02T16:10:00.000Z" } };
    expect(usageLabel("claude-code", { ...usage, plan: ok })).toBe("**Plan usage:** 5-hour window OK, resets 2026-10-02 16:10 UTC");
    const warning = { weekly: { status: "allowed_warning" as const, thresholdPercent: 80 } };
    expect(usageLabel("claude-code", { ...usage, plan: warning })).toBe("**Plan usage:** weekly limit approaching limit (over 80% used)");
    const rejected = { fiveHour: { status: "rejected" as const, usedPercent: 100, resetsAt: "2026-10-02T16:10:00.000Z" } };
    expect(usageLabel("claude-code", { ...usage, plan: rejected })).toBe("**Plan usage:** 5-hour window limit reached, resets 2026-10-02 16:10 UTC");
  });

  it("shows only the windows that were reported", () => {
    expect(usageLabel("claude-code", { ...usage, plan: { weekly: { usedPercent: 5 } } })).toBe("**Plan usage:** weekly limit 5% used");
  });
});

describe("estimateCostUsd", () => {
  it("prices known models and returns null for unknown ones", () => {
    expect(estimateCostUsd("claude-sonnet-5-5", 1_000_000, 100_000)).toBeCloseTo(3);
    expect(estimateCostUsd("some-future-model", 1, 1)).toBeNull();
  });
});
