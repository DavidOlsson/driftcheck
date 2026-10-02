import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, CONFIG_FILE, CONFIG_TEMPLATE, ConfigError, parseConfig, type Config } from "../config/config.js";
import { PLATFORMS } from "../model/spec.js";

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_DIR, CONFIG_FILE);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Creates `.driftcheck/config.yml` from the template. Refuses to overwrite unless forced. */
export async function initProject(projectRoot: string, force = false): Promise<string> {
  const file = configPath(projectRoot);
  if (!force && (await exists(file))) {
    throw new ConfigError(`${path.relative(projectRoot, file)} already exists. Use --force to overwrite it.`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, CONFIG_TEMPLATE, "utf8");
  return file;
}

export async function loadConfig(projectRoot: string): Promise<Config> {
  const file = configPath(projectRoot);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(`No ${CONFIG_DIR}/${CONFIG_FILE} found in ${projectRoot}. Run "driftcheck init" first.`);
    }
    throw e;
  }
  return parseConfig(text, projectRoot);
}

/** Loads the config and checks that both platform roots exist, so later runs fail early and clearly. */
export async function validateProject(projectRoot: string): Promise<Config> {
  const config = await loadConfig(projectRoot);
  const missing = [];
  for (const platform of PLATFORMS) {
    if (!(await exists(config.platforms[platform]))) missing.push(`${platform}: ${config.platforms[platform]}`);
  }
  if (missing.length > 0) {
    throw new ConfigError(`Platform paths do not exist:\n${missing.map((m) => `  - ${m}`).join("\n")}`);
  }
  return config;
}
