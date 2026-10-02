import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { formatScore, matches, parseExpected, score } from "../src/eval/score.js";
import type { Finding } from "../src/model/finding.js";
import { finding } from "./helpers/specs.js";

const expected = [
  { id: "debounce", description: "Debounce differs", match: [["debounce"], ["200"], ["100"]] },
  { id: "voice", description: "Voice search only on Android", match: [["voice search", "speech"]] },
];

describe("matches", () => {
  it("requires a term from every group, case-insensitively", () => {
    expect(matches(expected[0]!, "debounce is 200 ms vs 100 ms")).toBe(true);
    expect(matches(expected[0]!, "DEBOUNCE 200 MS")).toBe(false);
    // Whole-phrase terms avoid accidental hits such as "VoiceOver"
    expect(matches(expected[1]!, "voiceover focus moves to the first result")).toBe(false);
  });
});

describe("score", () => {
  it("computes recall, lists misses and findings that matched nothing", () => {
    const findings = [
      finding(),
      finding({ title: "Analytics differ", android: null, ios: null, question: undefined }),
      finding({ category: "equal", title: "Voice search on neither", android: null, ios: null, question: undefined }),
    ] as Finding[];
    const result = score(expected, findings);

    expect(result.recall).toBe(0.5);
    expect(result.found[0]?.findings).toEqual(["Different debounce"]);
    expect(result.missed.map((m) => m.id)).toEqual(["voice"]);
    expect(result.unmatched).toEqual(["Analytics differ"]);
    expect(formatScore(result)).toContain("Recall: 1/2 (50%)");
  });
});

describe("expected file", () => {
  it("parses the Wikipedia search expectations", async () => {
    const parsed = parseExpected(await readFile("eval/wikipedia-search.expected.yml", "utf8"));
    expect(parsed.feature).toBe("search");
    expect(parsed.expected).toHaveLength(16);
  });
});
