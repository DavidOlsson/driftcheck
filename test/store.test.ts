import { lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "../src/config/config.js";
import { storePaths, writeJson, writeText } from "../src/store/store.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "driftcheck-store-"));
  outside = await mkdtemp(path.join(os.tmpdir(), "driftcheck-outside-"));
});

describe("writeText", () => {
  it("creates the directories inside .driftcheck/ and leaves no temporary files", async () => {
    const file = storePaths(root, "search").spec("android");
    await Promise.all([writeJson(root, file, { a: 1 }), writeJson(root, storePaths(root, "search").spec("ios"), { b: 2 })]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: 1 });
    expect((await readdir(path.dirname(file))).sort()).toEqual(["android.json", "ios.json"]);
  });

  it("refuses to write through a symlinked directory", async () => {
    await mkdir(path.join(root, ".driftcheck"));
    await symlink(outside, path.join(root, ".driftcheck", "reports"));
    await expect(writeText(root, storePaths(root, "search").report, "x")).rejects.toThrowError(ConfigError);
    await expect(writeText(root, storePaths(root, "search").report, "x")).rejects.toThrowError(/symlink/);
    expect(await readdir(outside)).toEqual([]);
  });

  it("refuses a symlinked .driftcheck/ itself", async () => {
    await symlink(outside, path.join(root, ".driftcheck"));
    await expect(writeText(root, storePaths(root, "search").findings, "x")).rejects.toThrowError(/symlink/);
    expect(await readdir(outside)).toEqual([]);
  });

  it("replaces a symlink at the target instead of writing to where it points", async () => {
    const victim = path.join(outside, "victim.txt");
    await writeFile(victim, "original");
    const report = storePaths(root, "search").report;
    await mkdir(path.dirname(report), { recursive: true });
    await symlink(victim, report);

    await writeText(root, report, "report");
    expect(await readFile(victim, "utf8")).toBe("original");
    expect((await lstat(report)).isSymbolicLink()).toBe(false);
    expect(await readFile(report, "utf8")).toBe("report");
  });

  it("only writes inside .driftcheck/", async () => {
    await expect(writeText(root, path.join(root, "elsewhere.txt"), "x")).rejects.toThrowError(/only written inside/);
    await expect(writeText(root, path.join(root, ".driftcheck", "..", "x.txt"), "x")).rejects.toThrowError(/only written inside/);
  });
});
