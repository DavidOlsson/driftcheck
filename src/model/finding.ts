import { z } from "zod";
import { Evidence } from "./spec.js";

export const FindingCategory = z.enum([
  /** Users get different behavior on the two platforms. */
  "behavior",
  /** Looks like a defect or gap on one platform. */
  "bug",
  /** Different presentation or interaction, same underlying behavior. */
  "ui",
  /** Exists on one platform only. */
  "missing",
  /** The platforms agree. Reported so a reader can see what was checked. */
  "equal",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const Severity = z.enum(["high", "medium", "low", "info"]);
export type Severity = z.infer<typeof Severity>;

export const PlatformSide = z.object({
  summary: z.string(),
  evidence: z.array(Evidence),
});
export type PlatformSide = z.infer<typeof PlatformSide>;

export const Finding = z.object({
  feature: z.string(),
  category: FindingCategory,
  severity: Severity,
  title: z.string().min(1),
  /** Spec item keys this finding is about, used to match intentional divergences. */
  keys: z.array(z.string()).min(1),
  /** Null when the behavior does not exist on that platform. */
  android: PlatformSide.nullable(),
  ios: PlatformSide.nullable(),
  /** An open question for the team, e.g. whether a difference is intentional. */
  question: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;
