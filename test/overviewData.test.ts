import { describe, expect, it } from "vitest";
import type { VerifiedInventory } from "../src/inventory/inventory.js";
import type { FeatureMatch } from "../src/model/inventory.js";
import { featuresById, groupMatches, hintsFor, suggestedComparisons } from "../src/report/overviewData.js";
import { cell, mdText, runDetailsLine } from "../src/report/shared.js";

const feature = (id: string, file: string) => ({
  id,
  name: id,
  description: id,
  entryPoints: [{ file, line: 1, quote: "x", status: "verified" as const }],
  files: [],
  verified: true,
});
const android: VerifiedInventory = { platform: "android", summary: "a", features: [feature("search", "search/SearchActivity.kt")] };
const ios: VerifiedInventory = { platform: "ios", summary: "i", features: [feature("find", "Search/SearchViewController.swift")] };

const row = (overrides: Partial<FeatureMatch>): FeatureMatch => ({ id: "x", name: "X", android: null, ios: null, note: "", deepCompare: false, ...overrides });
const matches: FeatureMatch[] = [
  row({ id: "search", name: "Search", android: "search", ios: "find", deepCompare: true }),
  row({ id: "shared", android: "a", ios: "b" }),
  row({ id: "voice", android: "voice", check: { platform: "ios", status: "not_found", name: "", note: "", evidence: [] } }),
  row({ id: "toc", ios: "toc", check: { platform: "android", status: "part_of", name: "Panel", note: "", evidence: [] } }),
  row({ id: "unchecked", ios: "w" }),
];

describe("groupMatches", () => {
  it("puts every row in its report group and keeps every group present", () => {
    const groups = groupMatches(matches);
    expect(Object.fromEntries(Object.entries(groups).map(([g, rows]) => [g, rows.map((r) => r.id)]))).toEqual({
      both: ["search", "shared"],
      different_structure: ["toc"],
      android_only: ["voice"],
      ios_only: [],
      uncertain: ["unchecked"],
    });
  });
});

describe("suggestedComparisons", () => {
  it("suggests only shared rows marked for a deep comparison, with file-name hints", () => {
    expect(suggestedComparisons(matches, featuresById(android, ios))).toEqual([
      { id: "search", name: "Search", hints: ["SearchActivity", "SearchViewController"] },
    ]);
  });

  it("deduplicates hints and keeps at most six", () => {
    const many = { ...feature("f", "A.kt"), files: ["a/A.kt", "B.kt", "C.kt", "D.kt", "E.kt", "F.kt", "G.kt"] };
    expect(hintsFor(many, undefined)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
});

describe("shared Markdown helpers", () => {
  it("keeps table cells on one line without breaking the table", () => {
    expect(cell("a | b\nc")).toBe("a \\| b c");
  });

  it("escapes HTML, link brackets and backslashes in untrusted text but keeps code spans", () => {
    expect(mdText("<b>x</b> [a](u) \\ `code`\n  next")).toBe("&lt;b>x&lt;/b> \\[a\\](u) \\\\ `code` next");
  });

  it("describes how a run was made", () => {
    const usage = { inputTokens: 12345, outputTokens: 678, costUsd: 0.5 };
    expect(runDetailsLine("claude-sonnet-5-5", "api", usage)).toBe(
      "- **Model:** `claude-sonnet-5-5` via Anthropic API (ANTHROPIC_API_KEY) · **Tokens:** 12,345 in, 678 out · **Estimated cost:** $0.50",
    );
  });
});
