import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../config/config.js";
import type { Platform } from "../model/spec.js";

/** Where results live inside the analyzed project, so they can be committed and compared over time. */
export const storePaths = (projectRoot: string, featureId: string) => {
  const base = path.join(projectRoot, CONFIG_DIR);
  return {
    spec: (platform: Platform) => path.join(base, "specs", featureId, `${platform}.json`),
    findings: path.join(base, "findings", `${featureId}.json`),
    report: path.join(base, "reports", `${featureId}.md`),
  };
};

export async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}
