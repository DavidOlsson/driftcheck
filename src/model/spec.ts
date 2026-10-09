import { z } from "zod";

export const PLATFORMS = ["android", "ios"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

/**
 * The fixed structure every feature description follows. Using the same sections on both
 * platforms is what makes two descriptions comparable item by item.
 */
export const SECTIONS = [
  "entry_points",
  "input_handling",
  "api",
  "localization",
  "presentation",
  "storage",
  "other",
  "constants",
] as const;
export const Section = z.enum(SECTIONS);
export type Section = z.infer<typeof Section>;

export const Evidence = z.object({
  /** Path relative to the platform root, using forward slashes. */
  file: z.string().min(1),
  line: z.number().int().min(1),
  /** A short verbatim snippet from the cited line, used to verify the claim. */
  quote: z.string().optional(),
});

/**
 * Result of checking one piece of evidence against the source:
 * - "verified": file and line exist and the quote was found near the line
 * - "line_exists": file and line exist, but no quote was given to check against
 * - "quote_not_found": file and line exist, but the quote was not found near the line
 * - "line_out_of_range"
 * - "file_not_found": missing, or outside the platform root
 */
export const EvidenceStatus = z.enum(["verified", "line_exists", "quote_not_found", "line_out_of_range", "file_not_found"]);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

export const VerifiedEvidence = Evidence.extend({ status: EvidenceStatus });
export type VerifiedEvidence = z.infer<typeof VerifiedEvidence>;
export type Evidence = z.infer<typeof Evidence>;

export const SpecItem = z.object({
  /**
   * Stable, platform-neutral identifier such as "input_handling.debounce_ms".
   * The same behavior must get the same key on both platforms so items can be paired.
   */
  key: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, "key must be lowercase dot-separated snake_case"),
  section: Section,
  description: z.string().min(1),
  /** The concrete value when there is one (a number, a limit, an endpoint), as text. */
  value: z.string().nullable().optional(),
  evidence: z.array(Evidence).min(1),
});
export type SpecItem = z.infer<typeof SpecItem>;

export const SectionCoverage = z.object({
  section: Section,
  /** "not_inspected" makes gaps visible instead of looking like the platform has nothing there. */
  status: z.enum(["covered", "not_found", "not_inspected"]),
  /** Files read for this section, relative to the platform root. */
  filesRead: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type SectionCoverage = z.infer<typeof SectionCoverage>;

export const FeatureSpec = z.object({
  feature: z.string().min(1),
  platform: Platform,
  summary: z.string().min(1),
  items: z.array(SpecItem),
  /** Things the agent looked for but did not find, so absence is explicit rather than silent. */
  notFound: z.array(z.string()).default([]),
  /** One entry per section, so a report can show which parts of the feature were actually examined. */
  coverage: z.array(SectionCoverage).default([]),
});
export type FeatureSpec = z.infer<typeof FeatureSpec>;
