import { readFile } from "node:fs/promises";
import type { Config } from "../config/config.js";
import { FsSourceReader } from "../io/fileReader.js";
import { FeatureSpec } from "../model/spec.js";
import { summarizeVerification, verifySpec, type VerificationSummary, type VerifiedFeatureSpec } from "../verify/verify.js";
import { ConfigError } from "../config/config.js";

/** Verifies a stored feature description against the platform's source tree. */
export async function verifySpecFile(
  config: Config,
  specFile: string,
): Promise<{ spec: VerifiedFeatureSpec; summary: VerificationSummary }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(specFile, "utf8"));
  } catch (e) {
    throw new ConfigError(`Could not read ${specFile} as JSON: ${(e as Error).message}`);
  }
  const parsed = FeatureSpec.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`${specFile} is not a valid feature description: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  }
  const reader = new FsSourceReader(config.platforms[parsed.data.platform]);
  const spec = await verifySpec(parsed.data, reader);
  return { spec, summary: summarizeVerification(spec) };
}

export function formatSummary(spec: VerifiedFeatureSpec, summary: VerificationSummary): string {
  const lines = [
    `${spec.feature} (${spec.platform}): ${summary.verifiedItems}/${summary.items} items verified against the source`,
    ...Object.entries(summary.evidence)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `  ${status}: ${count}`),
  ];
  const unverified = spec.items.filter((i) => !i.verified);
  if (unverified.length > 0) {
    lines.push("Unverified items:");
    for (const item of unverified) {
      const where = item.evidence.map((e) => `${e.file}:${e.line} (${e.status})`).join(", ");
      lines.push(`  - ${item.key}: ${where}`);
    }
  }
  return lines.join("\n");
}
