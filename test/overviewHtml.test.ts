import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { overviewPaths, rerenderOverview } from "../src/commands/overviewCommand.js";
import type { VerifiedInventory } from "../src/inventory/inventory.js";
import type { FeatureMatch } from "../src/model/inventory.js";
import { esc, renderOverviewHtml } from "../src/report/overviewHtml.js";
import { ConfigError } from "../src/config/config.js";

const feature = (id: string, name: string, file: string, verified = true) => ({
  id,
  name,
  description: `${name} feature`,
  entryPoints: [{ file, line: 3, quote: "x", status: verified ? ("verified" as const) : ("file_not_found" as const) }],
  files: [file],
  verified,
});

const android: VerifiedInventory = {
  platform: "android",
  summary: "Android <app>",
  features: [feature("search", "Search", "search/SearchActivity.kt"), feature("voice", "Voice <script>alert(1)</script>", "voice/Voice.kt", false)],
};
const ios: VerifiedInventory = {
  platform: "ios",
  summary: "iOS app",
  features: [feature("find", "Find", "Search/SearchViewController.swift"), feature("toc", "Table of contents", "ToC.swift")],
};
const matches: FeatureMatch[] = [
  { id: "search", name: "Search", android: "search", ios: "find", note: 'Note with "quotes" & <b>', deepCompare: true },
  {
    id: "voice",
    name: "Voice search",
    android: "voice",
    ios: null,
    note: "",
    deepCompare: false,
    check: { platform: "ios", status: "not_found", name: "", note: "Searched speech APIs.", evidence: [] },
  },
  {
    id: "toc",
    name: "Table of contents",
    android: null,
    ios: "toc",
    note: "",
    deepCompare: false,
    check: { platform: "android", status: "part_of", name: "Side panel", note: "", evidence: [{ file: "page/SidePanel.kt", line: 68 }] },
  },
];

const render = (overrides: Partial<Parameters<typeof renderOverviewHtml>[0]> = {}) =>
  renderOverviewHtml({
    android,
    ios,
    matches,
    run: {
      model: "claude-sonnet-5-5",
      backend: "claude-code",
      usage: { inputTokens: 1200, outputTokens: 300, costUsd: 1 },
      generatedAt: "2026-10-02T12:00:00.000Z",
    },
    ...overrides,
  });

describe("renderOverviewHtml", () => {
  it("escapes all text from the model and the source code", () => {
    const html = render();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Voice &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Android &lt;app&gt;");
    expect(html).toContain("Note with &quot;quotes&quot; &amp; &lt;b&gt;");
    expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("is self-contained: no external scripts, styles, fonts or images", () => {
    const html = render();
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("shows group counts, rows grouped by presence check, evidence and suggestions", () => {
    const html = render();
    expect(html).toMatch(/data-filter="both"[^>]*><span class="count">1<\/span>/);
    expect(html).toMatch(/data-filter="different_structure"[^>]*><span class="count">1<\/span>/);
    expect(html).toMatch(/data-filter="android_only"[^>]*><span class="count">1<\/span>/);
    expect(html).toMatch(/data-filter="ios_only"[^>]*><span class="count">0<\/span>/);
    expect(html).toContain('<tr data-group="android_only"');
    expect(html).toContain("↪ part of Side panel");
    expect(html).toContain('<code class="ref">page/SidePanel.kt:68</code>');
    expect(html).toContain(">unverified</span>");
    expect(html).toContain('<span class="absent">not found</span>');
    expect(html).toContain("deep compare");
    expect(html).toContain("- id: search");
    expect(html).toContain('data-label="iOS"');
  });

  it("shows run details when known and hides them when not", () => {
    expect(render()).toContain("Plan usage:");
    expect(render()).toContain("generated 2026-10-02T12:00:00.000Z");
    const old = render({ run: undefined });
    expect(old).not.toContain("Plan usage:");
    expect(old).not.toContain("generated");
    expect(old).not.toContain("unknown");
  });
});

describe("rerenderOverview", () => {
  it("rebuilds both reports from the stored inventory without calling Claude", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "driftcheck-rerender-"));
    const paths = overviewPaths(root);
    await mkdir(path.dirname(paths.inventory), { recursive: true });
    await writeFile(paths.inventory, JSON.stringify({ android, ios, matches }));

    const files = await rerenderOverview(root);
    expect(await readFile(files.html, "utf8")).toContain("<title>Feature overview · driftcheck</title>");
    expect(await readFile(files.report, "utf8")).toContain("# Feature overview");
  });

  it("leaves out run details for an inventory stored without them, and shows them when stored", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "driftcheck-rerender-"));
    const paths = overviewPaths(root);
    await mkdir(path.dirname(paths.inventory), { recursive: true });
    await writeFile(paths.inventory, JSON.stringify({ android, ios, matches }));
    const old = await readFile((await rerenderOverview(root)).report, "utf8");
    expect(old).not.toContain("**Model:**");
    expect(old).not.toContain("unknown");

    const meta = { model: "claude-sonnet-5-5", backend: "api", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5 }, generatedAt: "2026-10-02T12:00:00.000Z" };
    await writeFile(paths.inventory, JSON.stringify({ android, ios, matches, meta }));
    const current = await readFile((await rerenderOverview(root)).report, "utf8");
    expect(current).toContain("**Model:** `claude-sonnet-5-5`");
    expect(current).toContain("**Estimated cost:** $0.50");
  });

  it("rejects a stored inventory with missing or invalid platforms, with a clear message", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "driftcheck-rerender-"));
    const paths = overviewPaths(root);
    await mkdir(path.dirname(paths.inventory), { recursive: true });

    await writeFile(paths.inventory, JSON.stringify({ ios, matches }));
    await expect(rerenderOverview(root)).rejects.toThrowError(/does not look like a driftcheck inventory \(android: .*Run "driftcheck overview" again/);

    const broken = { ...android, features: [{ ...android.features[0], entryPoints: [{ file: "a.kt", line: 1, status: "maybe" }] }] };
    await writeFile(paths.inventory, JSON.stringify({ android: broken, ios, matches }));
    await expect(rerenderOverview(root)).rejects.toThrowError(ConfigError);
  });

  it("explains what to do when there is no inventory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "driftcheck-rerender-"));
    await expect(rerenderOverview(root)).rejects.toThrowError(/Run "driftcheck overview" first/);
  });
});
