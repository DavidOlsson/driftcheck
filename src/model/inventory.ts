import { z } from "zod";
import { Evidence, Platform } from "./spec.js";

/** One user-facing feature of one app, found during the overview. Deliberately shallow: depth is for `compare`. */
export const InventoryFeature = z.object({
  /** Short platform-local id, e.g. "search" or "reading-lists". Unique within one inventory. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id must be lowercase letters, digits and dashes"),
  name: z.string().min(1),
  description: z.string().min(1),
  /** Where the feature starts (screen, activity, view controller), with a verifiable quote. */
  entryPoints: z.array(Evidence).min(1),
  /** The main files or folders that implement it, relative to the platform root. */
  files: z.array(z.string()).default([]),
});
export type InventoryFeature = z.infer<typeof InventoryFeature>;

export const FeatureInventory = z.object({
  platform: Platform,
  summary: z.string().min(1),
  features: z.array(InventoryFeature),
});
export type FeatureInventory = z.infer<typeof FeatureInventory>;

/** One row of the feature matrix: the same feature on both platforms, or on one only. */
export const FeatureMatch = z.object({
  /** Platform-neutral id, suitable as a feature id in .driftcheck/config.yml. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  android: z.string().nullable(),
  ios: z.string().nullable(),
  /** Notable differences visible already at this level, or why the match is uncertain. */
  note: z.string().default(""),
  /** True when the feature is shared and likely to differ in ways worth a deep comparison. */
  deepCompare: z.boolean().default(false),
});
export type FeatureMatch = z.infer<typeof FeatureMatch>;

export const MatchOutput = z.object({ matches: z.array(FeatureMatch) });
