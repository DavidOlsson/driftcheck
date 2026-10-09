import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "../src/config/config.js";
import { configPath, initProject, loadConfig, validateProject } from "../src/commands/project.js";
import { formatSummary, verifySpecFile } from "../src/commands/verifyCommand.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "driftcheck-project-"));
});

describe("init", () => {
  it("writes a config that loads, and refuses to overwrite without force", async () => {
    const file = await initProject(root);
    expect(file).toBe(configPath(root));
    expect((await loadConfig(root)).features[0]?.id).toBe("search");

    await expect(initProject(root)).rejects.toThrowError(/already exists/);
    await expect(initProject(root, true)).resolves.toBe(file);
  });
});

describe("validate", () => {
  it("explains how to start when there is no config", async () => {
    await expect(loadConfig(root)).rejects.toThrowError(/Run "driftcheck init" first/);
  });

  it("fails clearly when a platform path is missing", async () => {
    await initProject(root);
    await mkdir(path.join(root, "android"));
    await expect(validateProject(root)).rejects.toThrowError(ConfigError);
    await expect(validateProject(root)).rejects.toThrowError(/ios:/);

    await mkdir(path.join(root, "ios"));
    await expect(validateProject(root)).resolves.toMatchObject({ model: expect.any(String) });
  });
});

describe("platform paths outside the project", () => {
  const writeConfig = (android: string, ios: string) =>
    writeFile(configPath(root), `version: 1\nplatforms:\n  android: { path: "${android}" }\n  ios: { path: "${ios}" }\n`);

  beforeEach(async () => {
    await initProject(root);
    await mkdir(path.join(root, "app", "ios"), { recursive: true });
  });

  it("are refused by default, also when absolute or reached through a symlink", async () => {
    const sibling = await mkdtemp(path.join(os.tmpdir(), "driftcheck-sibling-"));
    for (const android of ["..", sibling, os.homedir()]) {
      await writeConfig(android, "app/ios");
      await expect(validateProject(root)).rejects.toThrowError(/outside the project root[\s\S]*android:[\s\S]*--allow-external-paths/);
    }
    await symlink(sibling, path.join(root, "app", "android"));
    await writeConfig("app/android", "app/ios");
    await expect(validateProject(root)).rejects.toThrowError(/android: .*driftcheck-sibling-/);
  });

  it("are accepted inside the project, or outside it with an explicit opt-in", async () => {
    await mkdir(path.join(root, "app", "android"));
    await writeConfig("app/android", "app/ios");
    await expect(validateProject(root)).resolves.toMatchObject({ platforms: { android: path.join(root, "app", "android") } });

    const sibling = await mkdtemp(path.join(os.tmpdir(), "driftcheck-sibling-"));
    await writeConfig(sibling, "app/ios");
    await expect(validateProject(root, { allowExternalPaths: true })).resolves.toMatchObject({ platforms: { android: sibling } });
  });
});

describe("verify command", () => {
  it("verifies a stored description against the platform's source", async () => {
    await initProject(root);
    await mkdir(path.join(root, "android", "search"), { recursive: true });
    await mkdir(path.join(root, "ios"));
    await writeFile(path.join(root, "android", "search", "Search.kt"), "val a = 1\nval delayMillis = 200L\n");
    const specFile = path.join(root, "android-search.json");
    await writeFile(
      specFile,
      JSON.stringify({
        feature: "search",
        platform: "android",
        summary: "Search",
        items: [
          {
            key: "input_handling.debounce_ms",
            section: "input_handling",
            description: "Debounce",
            value: "200",
            evidence: [{ file: "search/Search.kt", line: 2, quote: "delayMillis = 200L" }],
          },
          {
            key: "api.result_limit",
            section: "api",
            description: "Limit",
            evidence: [{ file: "search/Nope.kt", line: 1, quote: "limit" }],
          },
        ],
      }),
    );

    const config = await validateProject(root);
    const { spec, summary } = await verifySpecFile(config, specFile);
    expect(summary).toMatchObject({ items: 2, verifiedItems: 1 });
    const text = formatSummary(spec, summary);
    expect(text).toContain("1/2 items verified");
    expect(text).toContain("api.result_limit: search/Nope.kt:1 (file_not_found)");
  });

  it("rejects files that are not feature descriptions", async () => {
    await initProject(root);
    const config = await loadConfig(root);
    const bad = path.join(root, "bad.json");
    await writeFile(bad, '{"hello": "world"}');
    await expect(verifySpecFile(config, bad)).rejects.toThrowError(/not a valid feature description/);
    await writeFile(bad, "not json");
    await expect(verifySpecFile(config, bad)).rejects.toThrowError(/as JSON/);
  });
});
