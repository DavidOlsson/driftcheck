import { stringify as toYaml } from "yaml";
import { groupOf, type MatrixGroup } from "../inventory/presence.js";
import { BACKEND_DESCRIPTIONS } from "../model/backend.js";
import type { FeatureMatch, PresenceCheck } from "../model/inventory.js";
import { usageLabel } from "./markdown.js";
import { hintsFor, type InventoryFeature, type OverviewReportInput } from "./overviewMarkdown.js";

/** Everything in the report comes from model output or source code, so all of it is escaped. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const GROUPS: { group: MatrixGroup; title: string; hint: string }[] = [
  { group: "both", title: "On both platforms", hint: "Matched directly, or found on the other platform by the presence check." },
  { group: "different_structure", title: "Structured differently", hint: "Exists on both platforms, but inside another feature on one of them." },
  { group: "android_only", title: "Android only", hint: "The iOS app was searched and nothing serving the same purpose was found." },
  { group: "ios_only", title: "iOS only", hint: "The Android app was searched and nothing serving the same purpose was found." },
  { group: "uncertain", title: "Uncertain", hint: "Not checked, or claimed with evidence that did not verify. Check by hand." },
];

function evidenceTag(file: string, line: number, verified = true): string {
  const warn = verified ? "" : ` <span class="warn" title="Entry point could not be verified against the source">unverified</span>`;
  return `<code class="ref">${esc(file)}:${line}</code>${warn}`;
}

function featureCell(feature: InventoryFeature | undefined): string {
  if (!feature) return `<span class="absent">—</span>`;
  const entry = feature.entryPoints[0];
  return `<div class="name">${esc(feature.name)}</div>${entry ? evidenceTag(entry.file, entry.line, feature.verified) : ""}`;
}

function checkCell(check: PresenceCheck | undefined): string {
  if (!check) return `<span class="absent">not checked</span>`;
  const e = check.evidence[0];
  const ref = e ? evidenceTag(e.file, e.line) : "";
  switch (check.status) {
    case "found":
      return `<div class="name">${esc(check.name || "Found")}</div>${ref}<div class="badge found">found by presence check</div>`;
    case "part_of":
      return `<div class="name">↪ part of ${esc(check.name || "another feature")}</div>${ref}`;
    case "not_found":
      return `<span class="absent">not found</span>`;
    case "unverified":
      return `<div class="name">❓ ${esc(check.name || "claimed")}</div>${ref}<div class="badge warn">evidence not verified</div>`;
  }
}

function row(m: FeatureMatch, byId: { android: Map<string, InventoryFeature>; ios: Map<string, InventoryFeature> }): string {
  const group = groupOf(m);
  const android = m.android ? featureCell(byId.android.get(m.android)) : checkCell(m.check);
  const ios = m.ios ? featureCell(byId.ios.get(m.ios)) : checkCell(m.check);
  const notes = [m.note, m.check?.note].filter(Boolean).map((n) => `<p>${esc(n!)}</p>`).join("");
  const deep = m.deepCompare ? `<span class="badge deep" title="Suggested for a deep comparison">deep compare</span>` : "";
  // Text used by the client-side search box
  const searchText = [m.name, m.note, m.check?.note, m.check?.name, m.android, m.ios].filter(Boolean).join(" ").toLowerCase();
  return `<tr data-group="${group}" data-search="${esc(searchText)}">
  <th scope="row"><div class="feature">${esc(m.name)}</div>${deep}</th>
  <td data-label="Android">${android}</td>
  <td data-label="iOS">${ios}</td>
  <td class="notes" data-label="Notes">${notes}</td>
</tr>`;
}

export function renderOverviewHtml(input: OverviewReportInput): string {
  const { android, ios, matches, model, backend, usage, generatedAt } = input;
  const byId = {
    android: new Map(android.features.map((f) => [f.id, f])),
    ios: new Map(ios.features.map((f) => [f.id, f])),
  };
  const counts = Object.fromEntries(GROUPS.map(({ group }) => [group, matches.filter((m) => groupOf(m) === group).length])) as Record<
    MatrixGroup,
    number
  >;
  const verified = (inv: typeof android) => inv.features.filter((f) => f.verified).length;

  const cards = GROUPS.map(
    ({ group, title, hint }) =>
      `<button class="card ${group}" data-filter="${group}" title="${esc(hint)}" aria-pressed="false"><span class="count">${counts[group]}</span><span class="label">${esc(title)}</span></button>`,
  ).join("\n");

  const sections = GROUPS.filter(({ group }) => counts[group] > 0)
    .map(
      ({ group, title, hint }) => `<section class="group" data-section="${group}">
  <h2><span class="dot ${group}"></span>${esc(title)} <span class="muted">${counts[group]}</span></h2>
  <p class="hint">${esc(hint)}</p>
  <div class="table-wrap"><table>
    <thead><tr><th scope="col">Feature</th><th scope="col">Android</th><th scope="col">iOS</th><th scope="col">Notes</th></tr></thead>
    <tbody>${matches.filter((m) => groupOf(m) === group).map((m) => row(m, byId)).join("\n")}</tbody>
  </table></div>
</section>`,
    )
    .join("\n");

  const suggested = matches.filter((m) => groupOf(m) === "both" && m.deepCompare && m.android && m.ios);
  const yaml = toYaml({
    features: suggested.map((m) => ({
      id: m.id,
      name: m.name,
      hints: hintsFor(m.android ? byId.android.get(m.android) : undefined, m.ios ? byId.ios.get(m.ios) : undefined),
    })),
  }).trimEnd();
  const suggestions =
    suggested.length === 0
      ? ""
      : `<section class="group">
  <h2>Suggested deep comparisons</h2>
  <p class="hint">Shared features most likely to differ in ways users notice. Add them to <code>.driftcheck/config.yml</code> and run <code>driftcheck compare &lt;id&gt;</code>.</p>
  <div class="chips">${suggested.map((m) => `<span class="chip">${esc(m.name)}</span>`).join("")}</div>
  <div class="code"><button class="copy" type="button">Copy</button><pre><code>${esc(yaml)}</code></pre></div>
</section>`;

  const usageText = usageLabel(backend, usage).replace(/\*\*/g, "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feature overview · driftcheck</title>
<style>
:root {
  --bg: #f7f7f8; --surface: #ffffff; --text: #1d1d1f; --muted: #6b6b73; --border: #e3e3e8;
  --both: #2f7d4f; --structure: #7a5af5; --android: #1a8f5c; --ios: #2f6fde; --uncertain: #b7791f;
  --code-bg: #f0f0f3; --warn: #b7791f; --radius: 10px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111114; --surface: #1b1b20; --text: #ececf1; --muted: #9b9ba6; --border: #2c2c34;
    --both: #4cc283; --structure: #a48cff; --android: #3ccf8e; --ios: #6aa2ff; --uncertain: #e0a84a;
    --code-bg: #24242b; --warn: #e0a84a;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 32px 16px 64px; }
header h1 { margin: 0 0 4px; font-size: 26px; }
.muted, .hint { color: var(--muted); }
.hint { margin: 0 0 12px; font-size: 14px; }
.summaries { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 20px 0; }
.summary { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
.summary h3 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 8px 0 20px; }
.card { text-align: left; cursor: pointer; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-left: 4px solid; border-radius: var(--radius); padding: 12px 14px; font: inherit; }
.card .count { display: block; font-size: 28px; font-weight: 650; }
.card .label { color: var(--muted); font-size: 13px; }
.card[aria-pressed="true"] { outline: 2px solid currentColor; }
.both { border-left-color: var(--both); } .different_structure { border-left-color: var(--structure); }
.android_only { border-left-color: var(--android); } .ios_only { border-left-color: var(--ios); } .uncertain { border-left-color: var(--uncertain); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
.dot.both { background: var(--both); } .dot.different_structure { background: var(--structure); }
.dot.android_only { background: var(--android); } .dot.ios_only { background: var(--ios); } .dot.uncertain { background: var(--uncertain); }
.toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
input[type=search] { flex: 1; min-width: 200px; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; }
.reset { padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font: inherit; }
.group { margin-top: 28px; }
.group h2 { font-size: 19px; margin: 0 0 4px; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
table { width: 100%; border-collapse: collapse; min-width: 720px; }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-top: 1px solid var(--border); }
thead th { border-top: none; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
tbody th { font-weight: 600; width: 20%; }
td { width: 27%; } td.notes { width: 26%; color: var(--muted); font-size: 14px; }
td.notes p { margin: 0 0 4px; }
.name { margin-bottom: 4px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.ref { background: var(--code-bg); padding: 1px 6px; border-radius: 5px; word-break: break-all; }
.absent { color: var(--muted); font-style: italic; }
.badge { display: inline-block; margin-top: 6px; font-size: 11.5px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.badge.deep { color: var(--structure); border-color: var(--structure); }
.badge.found { color: var(--both); border-color: var(--both); }
.badge.warn, .warn { color: var(--warn); }
.warn { font-size: 12px; margin-left: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip { background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 3px 12px; font-size: 14px; }
.code { position: relative; background: var(--code-bg); border-radius: var(--radius); }
.code pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
.copy { position: absolute; top: 8px; right: 8px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font: inherit; font-size: 13px; }
footer { margin-top: 36px; color: var(--muted); font-size: 13px; }
footer li { margin-bottom: 4px; }
tr.hidden, section.hidden { display: none !important; }
/* On narrow screens each row becomes a card, so no column is hidden behind horizontal scrolling */
@media (max-width: 700px) {
  table { min-width: 0; }
  thead { display: none; }
  table, tbody, tr, th, td { display: block; width: auto !important; }
  tbody tr { border-top: 1px solid var(--border); padding: 10px 12px; }
  tbody tr:first-child { border-top: none; }
  tbody th, tbody td { border: none; padding: 4px 0; }
  tbody td::before { content: attr(data-label); display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  td.notes:empty { display: none; }
}
</style>
</head>
<body>
<main>
<header>
  <h1>Feature overview</h1>
  <div class="muted">Android vs iOS${generatedAt === "unknown" ? "" : ` · generated ${esc(generatedAt)}`} by driftcheck</div>
</header>

<div class="summaries">
  <div class="summary"><h3>Android</h3>${esc(android.summary)}</div>
  <div class="summary"><h3>iOS</h3>${esc(ios.summary)}</div>
</div>

<div class="cards">
${cards}
</div>

<div class="toolbar">
  <input type="search" id="search" placeholder="Search features, notes or ids…" aria-label="Search features">
  <button class="reset" type="button" id="reset">Show all</button>
</div>

${sections}

${suggestions}

<footer>
  <ul>
    <li>Android: ${android.features.length} features, ${verified(android)} with an entry point verified against the source.</li>
    <li>iOS: ${ios.features.length} features, ${verified(ios)} with an entry point verified against the source.</li>
    <li>Matching is done by the model from names and descriptions. Every feature listed on one platform only was then searched for on the other platform; only features that were not found are reported as platform-only.</li>
${model === "unknown" ? "" : `    <li>Model: <code>${esc(model)}</code> via ${esc(BACKEND_DESCRIPTIONS[backend])} · Tokens: ${usage.inputTokens.toLocaleString("en")} in, ${usage.outputTokens.toLocaleString("en")} out · ${esc(usageText)}</li>`}
  </ul>
</footer>
</main>
<script>
// Optional enhancement: the report is fully readable without JavaScript
(() => {
  const search = document.getElementById("search");
  const cards = [...document.querySelectorAll(".card")];
  let group = null;
  const apply = () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll("tbody tr").forEach((tr) => {
      const ok = (!group || tr.dataset.group === group) && (!q || tr.dataset.search.includes(q));
      tr.classList.toggle("hidden", !ok);
    });
    document.querySelectorAll("section[data-section]").forEach((s) => {
      s.classList.toggle("hidden", !s.querySelector("tbody tr:not(.hidden)"));
    });
    cards.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === group)));
  };
  cards.forEach((c) => c.addEventListener("click", () => { group = group === c.dataset.filter ? null : c.dataset.filter; apply(); }));
  search.addEventListener("input", apply);
  document.getElementById("reset").addEventListener("click", () => { group = null; search.value = ""; apply(); });
  document.querySelectorAll(".copy").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.nextElementSibling.textContent); b.textContent = "Copied"; }
    catch { b.textContent = "Select and copy"; }
    setTimeout(() => (b.textContent = "Copy"), 1500);
  }));
})();
</script>
</body>
</html>
`;
}
