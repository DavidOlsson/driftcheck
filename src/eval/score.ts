import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Finding } from "../model/finding.js";

/**
 * Scores findings against a list of known differences. Free to run: it only reads a findings file,
 * so a costly comparison can be measured afterwards and compared with earlier runs.
 */
const ExpectedDifference = z.object({
  id: z.string(),
  description: z.string(),
  /** Every group must contribute at least one term (AND of ORs), case-insensitive. */
  match: z.array(z.array(z.string()).min(1)).min(1),
});
export const ExpectedFile = z.object({ feature: z.string(), expected: z.array(ExpectedDifference).min(1) });
export type ExpectedDifference = z.infer<typeof ExpectedDifference>;

export interface ScoreResult {
  found: { expected: ExpectedDifference; findings: string[] }[];
  missed: ExpectedDifference[];
  /** Findings that match no expected difference: new discoveries or noise, to be reviewed by hand. */
  unmatched: string[];
  recall: number;
}

export function parseExpected(yamlText: string): z.infer<typeof ExpectedFile> {
  return ExpectedFile.parse(parseYaml(yamlText));
}

function findingText(f: Finding): string {
  return [f.title, f.android?.summary, f.ios?.summary, f.question].filter(Boolean).join(" ").toLowerCase();
}

export function matches(expected: ExpectedDifference, text: string): boolean {
  return expected.match.every((group) => group.some((term) => text.includes(term.toLowerCase())));
}

export function score(expected: ExpectedDifference[], findings: Finding[]): ScoreResult {
  // "equal" findings state agreement, so they cannot count as having found a difference
  const differences = findings.filter((f) => f.category !== "equal");
  const texts = differences.map((f) => ({ title: f.title, text: findingText(f) }));

  const found: ScoreResult["found"] = [];
  const missed: ExpectedDifference[] = [];
  const used = new Set<string>();
  for (const e of expected) {
    const hits = texts.filter((t) => matches(e, t.text)).map((t) => t.title);
    if (hits.length > 0) {
      found.push({ expected: e, findings: hits });
      hits.forEach((h) => used.add(h));
    } else {
      missed.push(e);
    }
  }
  return {
    found,
    missed,
    unmatched: texts.map((t) => t.title).filter((title) => !used.has(title)),
    recall: found.length / expected.length,
  };
}

export function formatScore(result: ScoreResult): string {
  const lines = [
    `Recall: ${result.found.length}/${result.found.length + result.missed.length} (${Math.round(result.recall * 100)}%)`,
    "",
    "Found:",
    ...result.found.map((f) => `  ✓ ${f.expected.id}: ${f.findings.join(" | ")}`),
    "Missed:",
    ...(result.missed.length > 0 ? result.missed.map((m) => `  ✗ ${m.id}: ${m.description}`) : ["  (none)"]),
    "Unmatched findings (review by hand: new discoveries or noise):",
    ...(result.unmatched.length > 0 ? result.unmatched.map((u) => `  ? ${u}`) : ["  (none)"]),
  ];
  return lines.join("\n");
}
