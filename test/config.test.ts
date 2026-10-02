import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_TEMPLATE, ConfigError, DEFAULT_MODEL, findFeature, parseConfig } from "../src/config/config.js";

const root = path.resolve("/projects/app");

const yaml = (extra = "") => `
version: 1
platforms:
  android: { path: android-app }
  ios: { path: ../ios-app }
features:
  - id: search
    name: Search
    hints: [SearchFragment]
${extra}`;

describe("parseConfig", () => {
  it("resolves platform paths against the project root and applies defaults", () => {
    const config = parseConfig(yaml(), root);
    expect(config.platforms.android).toBe(path.join(root, "android-app"));
    expect(config.platforms.ios).toBe(path.resolve(root, "../ios-app"));
    expect(config.model).toBe(DEFAULT_MODEL);
    expect(config.features[0]).toEqual({ id: "search", name: "Search", hints: ["SearchFragment"] });
  });

  it("accepts overrides", () => {
    const config = parseConfig(yaml("model: claude-opus-5-5\nmaxTurns: 10\nmaxBudgetUsd: 0.5"), root);
    expect(config).toMatchObject({ model: "claude-opus-5-5", maxTurns: 10, maxBudgetUsd: 0.5 });
  });

  it("reports every schema problem with its path", () => {
    const bad = "version: 2\nplatforms:\n  android: { path: a }\nfeatures:\n  - id: Bad Id\n    name: x";
    expect(() => parseConfig(bad, root)).toThrowError(ConfigError);
    try {
      parseConfig(bad, root);
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("version");
      expect(message).toContain("platforms.ios");
      expect(message).toContain("features.0.id");
    }
  });

  it("rejects invalid YAML and duplicate feature ids", () => {
    expect(() => parseConfig("version: [1", root)).toThrowError(/not valid YAML/);
    const dup = yaml().replace("features:", "features:\n  - { id: search, name: Again }");
    expect(() => parseConfig(dup, root)).toThrowError(/Duplicate feature ids.*search/);
  });

  it("parses the template that init writes", () => {
    expect(parseConfig(CONFIG_TEMPLATE, root).features.map((f) => f.id)).toEqual(["search"]);
  });
});

describe("findFeature", () => {
  it("lists the configured features when the id is unknown", () => {
    const config = parseConfig(yaml(), root);
    expect(findFeature(config, "search").name).toBe("Search");
    expect(() => findFeature(config, "login")).toThrowError(/Unknown feature "login".*search/);
  });
});
