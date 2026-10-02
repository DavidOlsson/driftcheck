import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FsSourceReader, resolveInsideRoot, type SourceReader } from "../src/io/fileReader.js";
import type { FeatureSpec } from "../src/model/spec.js";
import { checkEvidence, summarizeVerification, verifySpec } from "../src/verify/verify.js";

const SOURCE = [
  "class SearchViewModel {",
  "    private val batchSize = 10",
  "    private val delayMillis = 200L",
  "}",
].join("\n");

class MemoryReader implements SourceReader {
  readonly reads: string[] = [];
  constructor(private readonly files: Record<string, string>) {}
  async read(file: string) {
    this.reads.push(file);
    return this.files[file] ?? null;
  }
}

describe("checkEvidence", () => {
  it("verifies a quote on the cited line, ignoring whitespace differences", () => {
    expect(checkEvidence(SOURCE, { file: "a", line: 3, quote: "delayMillis = 200L" })).toBe("verified");
    expect(checkEvidence(SOURCE, { file: "a", line: 3, quote: "delayMillis=200L" })).toBe("verified");
  });

  it("tolerates a line number that is a few lines off", () => {
    expect(checkEvidence(SOURCE, { file: "a", line: 1, quote: "delayMillis = 200L" })).toBe("verified");
  });

  it("flags a quote that is not near the line, e.g. a wrong value", () => {
    expect(checkEvidence(SOURCE, { file: "a", line: 3, quote: "delayMillis = 300L" })).toBe("quote_not_found");
  });

  it("distinguishes missing files, lines out of range and evidence without a quote", () => {
    expect(checkEvidence(null, { file: "a", line: 1, quote: "x" })).toBe("file_not_found");
    expect(checkEvidence(SOURCE, { file: "a", line: 99, quote: "x" })).toBe("line_out_of_range");
    expect(checkEvidence(SOURCE, { file: "a", line: 2 })).toBe("line_exists");
    expect(checkEvidence(SOURCE, { file: "a", line: 2, quote: "   " })).toBe("line_exists");
  });
});

describe("verifySpec", () => {
  const spec: FeatureSpec = {
    feature: "search",
    platform: "android",
    summary: "Search",
    notFound: [],
    items: [
      {
        key: "input_handling.debounce_ms",
        section: "input_handling",
        description: "Debounce",
        value: "200",
        evidence: [{ file: "Search.kt", line: 3, quote: "delayMillis = 200L" }],
      },
      {
        key: "api.result_limit",
        section: "api",
        description: "Page size",
        value: "20",
        evidence: [
          { file: "Search.kt", line: 2, quote: "batchSize = 20" },
          { file: "Missing.kt", line: 1, quote: "x" },
        ],
      },
    ],
  };

  it("marks each item and piece of evidence, and reads each file once", async () => {
    const reader = new MemoryReader({ "Search.kt": SOURCE });
    const verified = await verifySpec(spec, reader);

    expect(verified.items[0]?.verified).toBe(true);
    expect(verified.items[1]?.verified).toBe(false);
    expect(verified.items[1]?.evidence.map((e) => e.status)).toEqual(["quote_not_found", "file_not_found"]);
    expect(reader.reads.filter((f) => f === "Search.kt")).toHaveLength(1);

    const summary = summarizeVerification(verified);
    expect(summary).toMatchObject({ items: 2, verifiedItems: 1 });
    expect(summary.evidence).toMatchObject({ verified: 1, quote_not_found: 1, file_not_found: 1 });
  });
});

describe("source reading never escapes the platform root", () => {
  it("rejects absolute paths and parent traversal", () => {
    expect(resolveInsideRoot("/repo", "src/A.kt")).toBe(path.resolve("/repo/src/A.kt"));
    expect(resolveInsideRoot("/repo", "/etc/passwd")).toBeNull();
    expect(resolveInsideRoot("/repo", "../secret.txt")).toBeNull();
    expect(resolveInsideRoot("/repo", "src/../../secret.txt")).toBeNull();
    expect(resolveInsideRoot("/repo", ".")).toBeNull();
  });

  it("reads real files but not symlinks that point outside the root", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "driftcheck-"));
    const root = path.join(tmp, "repo");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "A.kt"), "val a = 1");
    await writeFile(path.join(tmp, "secret.txt"), "secret");
    await symlink(path.join(tmp, "secret.txt"), path.join(root, "src", "link.txt"));

    const reader = new FsSourceReader(root);
    expect(await reader.read("src/A.kt")).toBe("val a = 1");
    expect(await reader.read("src/missing.kt")).toBeNull();
    expect(await reader.read("src")).toBeNull();
    expect(await reader.read("src/link.txt")).toBeNull();
  });
});
