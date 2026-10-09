import { z } from "zod";
import { BACKENDS } from "./backend.js";
import { Evidence, Platform, VerifiedEvidence } from "./spec.js";

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

/**
 * The result of looking for a platform-only feature on the other platform.
 * - "found": it exists there as a feature of its own (the inventory missed it)
 * - "part_of": it exists there, but inside another feature
 * - "not_found": the agent looked and could not find it
 * - "unverified": the agent claimed it exists, but the evidence did not check out
 */
export const PresenceStatus = z.enum(["found", "part_of", "not_found", "unverified"]);
export type PresenceStatus = z.infer<typeof PresenceStatus>;

export const PresenceCheck = z.object({
  platform: Platform,
  status: PresenceStatus,
  /** Where it was found, e.g. the name of the feature it is part of. */
  name: z.string().default(""),
  note: z.string().default(""),
  evidence: z.array(Evidence).default([]),
});
export type PresenceCheck = z.infer<typeof PresenceCheck>;

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
  /** Set for platform-only rows after the other platform was searched for the feature. */
  check: PresenceCheck.optional(),
});
export type FeatureMatch = z.infer<typeof FeatureMatch>;

/** What the presence-check agent returns for each candidate feature. */
export const PresenceAnswer = z.object({
  rowId: z.string(),
  status: z.enum(["found", "part_of", "not_found"]),
  name: z.string().default(""),
  note: z.string().default(""),
  evidence: z.array(Evidence).default([]),
});
export const PresenceOutput = z.object({ answers: z.array(PresenceAnswer) });
export type PresenceAnswer = z.infer<typeof PresenceAnswer>;

/** What the matching model returns: rows without a presence check, which only the check step may set. */
export const MatchRow = FeatureMatch.omit({ check: true });
export type MatchRow = z.infer<typeof MatchRow>;
export const MatchOutput = z.object({ matches: z.array(MatchRow) });

/** An inventory after its entry points were checked against the source. */
export const VerifiedInventory = FeatureInventory.extend({
  features: z.array(InventoryFeature.extend({ entryPoints: z.array(VerifiedEvidence), verified: z.boolean() })),
});
export type VerifiedInventory = z.infer<typeof VerifiedInventory>;

const PlanWindow = z.object({
  status: z.enum(["allowed", "allowed_warning", "rejected"]).optional(),
  usedPercent: z.number().optional(),
  thresholdPercent: z.number().optional(),
  resetsAt: z.string().optional(),
});

/** How an overview was made, shown at the bottom of its reports. */
export const RunDetails = z.object({
  model: z.string(),
  backend: z.enum(BACKENDS).exclude(["auto"]),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.number(),
    plan: z.object({ fiveHour: PlanWindow.optional(), weekly: PlanWindow.optional() }).optional(),
  }),
  generatedAt: z.string(),
});
export type RunDetails = z.infer<typeof RunDetails>;

/** `.driftcheck/inventory.json`. Inventories stored before run details were recorded have no `meta`. */
export const StoredInventory = z.object({
  android: VerifiedInventory,
  ios: VerifiedInventory,
  matches: z.array(FeatureMatch),
  meta: RunDetails.optional(),
});
export type StoredInventory = z.infer<typeof StoredInventory>;
