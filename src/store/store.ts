import { randomBytes } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, ConfigError } from "../config/config.js";
import { isWithin } from "../io/paths.js";
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

/**
 * Creates the directories from `.driftcheck/` down to `dir` one level at a time, refusing symlinks.
 * The analyzed repository may be untrusted (e.g. a pull request in CI), and a symlinked directory in it
 * must not redirect a write to somewhere else on the machine. Nothing is created outside `.driftcheck/`.
 */
async function ensureRealDirs(projectRoot: string, dir: string): Promise<void> {
  const base = path.join(projectRoot, CONFIG_DIR);
  const parts = path.relative(base, dir).split(path.sep).filter(Boolean);
  let current = base;
  for (const part of ["", ...parts]) {
    current = path.join(current, part);
    try {
      // Not recursive: it never follows a symlink at `current`, and its parent was checked in the previous step
      await mkdir(current);
    } catch (e) {
      // Also when the other platform's parallel write created it first
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ConfigError(
        `${current} is ${stat.isSymbolicLink() ? "a symlink" : "not a directory"}. driftcheck only writes to real directories inside ${CONFIG_DIR}/; remove it and run again.`,
      );
    }
  }
}

/**
 * Writes a file inside `<projectRoot>/.driftcheck/`. The text goes to a new temporary file that is then
 * renamed over the target, so a symlink planted at the target is replaced instead of followed.
 */
export async function writeText(projectRoot: string, file: string, text: string): Promise<void> {
  const base = path.join(projectRoot, CONFIG_DIR);
  if (!isWithin(base, file) || path.resolve(file) === path.resolve(base)) {
    throw new Error(`Refusing to write ${file}: results are only written inside ${base}`);
  }
  await ensureRealDirs(projectRoot, path.dirname(file));
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    // "wx" creates a new file and fails if anything, including a symlink, already exists at that path
    await writeFile(temp, text, { encoding: "utf8", flag: "wx" });
    await rename(temp, file);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

export async function writeJson(projectRoot: string, file: string, value: unknown): Promise<void> {
  await writeText(projectRoot, file, `${JSON.stringify(value, null, 2)}\n`);
}
