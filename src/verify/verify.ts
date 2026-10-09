import type { SourceReader } from "../io/fileReader.js";
import type { Evidence, FeatureSpec, SpecItem } from "../model/spec.js";

export type EvidenceStatus =
  /** File and line exist and the quote was found near the line. */
  | "verified"
  /** File and line exist, but no quote was given to check against. */
  | "line_exists"
  /** File and line exist, but the quote was not found near the line. */
  | "quote_not_found"
  | "line_out_of_range"
  /** Missing, or outside the platform root. */
  | "file_not_found";

export interface VerifiedEvidence extends Evidence {
  status: EvidenceStatus;
}

export interface VerifiedSpecItem extends Omit<SpecItem, "evidence"> {
  evidence: VerifiedEvidence[];
  /** True when at least one piece of evidence was verified against the source. */
  verified: boolean;
}

export interface VerifiedFeatureSpec extends Omit<FeatureSpec, "items"> {
  items: VerifiedSpecItem[];
}

/** How many lines around the cited line a quote may appear on; models are often off by a line or two. */
export const QUOTE_WINDOW = 3;

/** Whitespace-insensitive, so reformatting or a model's spacing does not cause false negatives. */
function normalize(text: string): string {
  return text.replace(/\s+/g, "");
}

export function checkEvidence(fileText: string | null, evidence: Evidence): EvidenceStatus {
  if (fileText === null) return "file_not_found";
  const lines = fileText.split(/\r?\n/);
  if (evidence.line > lines.length) return "line_out_of_range";
  const quote = evidence.quote?.trim();
  if (!quote) return "line_exists";
  const from = Math.max(0, evidence.line - 1 - QUOTE_WINDOW);
  const to = Math.min(lines.length, evidence.line + QUOTE_WINDOW);
  const window = normalize(lines.slice(from, to).join("\n"));
  return window.includes(normalize(quote)) ? "verified" : "quote_not_found";
}

/**
 * Many pieces of evidence cite the same file, so each file is read once. The promise is cached, not the
 * text, so parallel checks of the same file share one read.
 */
export function cachedReader(reader: SourceReader): SourceReader {
  const cache = new Map<string, Promise<string | null>>();
  return {
    read(file) {
      let pending = cache.get(file);
      if (!pending) {
        pending = reader.read(file);
        cache.set(file, pending);
      }
      return pending;
    },
  };
}

/**
 * Checks every piece of evidence against the actual source. This is the guard against
 * hallucinated file names, line numbers and values: reports show what was verified.
 */
export async function verifySpec(spec: FeatureSpec, reader: SourceReader): Promise<VerifiedFeatureSpec> {
  const cached = cachedReader(reader);
  const items = await Promise.all(
    spec.items.map(async (item) => {
      const evidence = await Promise.all(
        item.evidence.map(async (e) => ({ ...e, status: checkEvidence(await cached.read(e.file), e) })),
      );
      return { ...item, evidence, verified: evidence.some((e) => e.status === "verified") };
    }),
  );
  return { ...spec, items };
}

export interface VerificationSummary {
  items: number;
  verifiedItems: number;
  evidence: Record<EvidenceStatus, number>;
}

export function summarizeVerification(spec: VerifiedFeatureSpec): VerificationSummary {
  const evidence: Record<EvidenceStatus, number> = {
    verified: 0,
    line_exists: 0,
    quote_not_found: 0,
    line_out_of_range: 0,
    file_not_found: 0,
  };
  for (const item of spec.items) for (const e of item.evidence) evidence[e.status]++;
  return { items: spec.items.length, verifiedItems: spec.items.filter((i) => i.verified).length, evidence };
}
