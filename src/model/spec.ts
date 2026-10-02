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

export const FeatureSpec = z.object({
  feature: z.string().min(1),
  platform: Platform,
  summary: z.string().min(1),
  items: z.array(SpecItem),
  /** Things the agent looked for but did not find, so absence is explicit rather than silent. */
  notFound: z.array(z.string()).default([]),
});
export type FeatureSpec = z.infer<typeof FeatureSpec>;
