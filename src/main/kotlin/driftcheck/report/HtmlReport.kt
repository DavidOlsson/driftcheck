package driftcheck.report

import driftcheck.evidence.summarize
import driftcheck.model.CompareRun
import driftcheck.model.CoverageStatus
import driftcheck.model.EvidenceStatus
import driftcheck.model.FindingCategory
import driftcheck.model.Platform
import driftcheck.model.Section
import driftcheck.model.Severity
import driftcheck.model.VerifiedEvidence
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedFinding
import driftcheck.model.VerifiedPlatformSide

private val CATEGORY_LABELS = mapOf(
    FindingCategory.BEHAVIOR to "Behavior",
    FindingCategory.BUG to "Possible bug",
    FindingCategory.MISSING to "One platform only",
    FindingCategory.UI to "UI",
    FindingCategory.EQUAL to "Same",
)

private val SECTION_LABELS = mapOf(
    Section.ENTRY_POINTS to "Entry points",
    Section.INPUT_HANDLING to "Input",
    Section.API to "Search and API",
    Section.LOCALIZATION to "Language",
    Section.PRESENTATION to "Presentation",
    Section.STORAGE to "Storage",
    Section.OTHER to "Other",
    Section.CONSTANTS to "Constants",
)

/** Severity is never shown by color alone: each level also has its own symbol and name. */
private val SEVERITY_SYMBOLS = mapOf(Severity.HIGH to "▲", Severity.MEDIUM to "◆", Severity.LOW to "●", Severity.INFO to "○")

private val CONTROL_CHARACTERS = Regex("[\\p{Cc}&&[^\\n\\t]]")

/**
 * Text from the model, the analyzed code or stored results, made inert for HTML. Every character that could open a
 * tag, an attribute or an entity is escaped, and control characters are removed.
 */
fun html(text: String): String = buildString(text.length) {
    for (c in text.replace(CONTROL_CHARACTERS, "")) {
        when (c) {
            '&' -> append("&amp;")
            '<' -> append("&lt;")
            '>' -> append("&gt;")
            '"' -> append("&quot;")
            '\'' -> append("&#39;")
            else -> append(c)
        }
    }
}

private fun severityPill(severity: Severity) =
    """<span class="pill s-${severity.id}"><i aria-hidden="true">${SEVERITY_SYMBOLS.getValue(severity)}</i>${severity.id.replaceFirstChar {
        it.uppercase()
    }}</span>"""

private fun reference(e: VerifiedEvidence): String {
    val name = e.file.substringAfterLast('/')
    val tooltip = html(e.location + (e.quote?.let { "\n$it" } ?: ""))
    return if (e.status == EvidenceStatus.VERIFIED) {
        """<span class="ref" title="$tooltip"><b class="ok" aria-label="verified">✓</b> ${html(name)}:${e.line}</span>"""
    } else {
        """<span class="ref warn" title="$tooltip"><b aria-label="not verified">⚠</b> ${html(
            name,
        )}:${e.line} <small>${e.status.id.replace('_', ' ')}</small></span>"""
    }
}

private fun side(platform: Platform, side: VerifiedPlatformSide?): String {
    val label = """<div class="plat ${platform.id}">${platform.displayName}</div>"""
    if (side == null) return """<div class="side absent">$label<span class="none">Not found on ${platform.displayName}</span></div>"""
    val value = side.value?.takeIf { it.isNotBlank() }?.let { """<div class="val">${html(it)}</div>""" } ?: ""
    val refs = if (side.evidence.isEmpty()) "" else """<div class="refs">${side.evidence.joinToString("") { reference(it) }}</div>"""
    return """<div class="side">$label$value<p>${html(side.summary)}</p>$refs</div>"""
}

/** The area a finding belongs to, taken from the sections of the items it is about. */
private fun area(finding: VerifiedFinding, specs: List<VerifiedFeatureSpec>): Section? =
    finding.keys.firstNotNullOfOrNull { key -> specs.firstNotNullOfOrNull { spec -> spec.items.find { it.key == key }?.section } }

private fun references(f: VerifiedFinding) = f.android?.evidence.orEmpty() + f.ios?.evidence.orEmpty()

private fun findingItem(f: VerifiedFinding, specs: List<VerifiedFeatureSpec>): String {
    val area = area(f, specs)?.let { """<span class="chip">${SECTION_LABELS.getValue(it)}</span>""" } ?: ""
    val unsourced = if (references(f).isEmpty()) """<span class="chip warn">⚠ No source reference</span>""" else ""
    val question = f.question?.takeIf { it.isNotBlank() }?.let { """<p class="q"><b>Question:</b> ${html(it)}</p>""" } ?: ""
    return """
        <details class="item" data-sev="${f.severity.id}" data-cat="${f.category.id}">
          <summary><span class="sevcol">${severityPill(
        f.severity,
    )}</span><span class="t">${html(
        f.title,
    )}</span><span class="meta"><span class="chip">${CATEGORY_LABELS.getValue(f.category)}</span>$area$unsourced</span></summary>
          <div class="body"><div class="vs">${side(Platform.ANDROID, f.android)}${side(Platform.IOS, f.ios)}</div>$question</div>
        </details>
    """.trimIndent()
}

private fun checkedLines(run: CompareRun, android: VerifiedFeatureSpec, ios: VerifiedFeatureSpec): List<String> = buildList {
    for (spec in listOf(android, ios)) {
        val s = summarize(spec)
        add("<li><b>${spec.platform.displayName}:</b> ${s.verifiedItems} of ${s.items} items verified against the source</li>")
    }
    val refs = run.findings.flatMap(::references)
    if (refs.isNotEmpty()) {
        val verified = refs.count { it.status == EvidenceStatus.VERIFIED }
        val marked = if (verified < refs.size) "; ⚠ marks the ones that could not be confirmed" else ""
        add(
            "<li><b>Findings:</b> $verified of ${refs.size} source references verified$marked. A ✓ means the quoted line was found near the cited line.</li>",
        )
    }
    for (spec in listOf(android, ios)) {
        val gaps = spec.coverage.filter { it.status == CoverageStatus.NOT_INSPECTED }.map { SECTION_LABELS.getValue(it.section) }
        if (gaps.isNotEmpty()) {
            add(
                "<li class=\"warn\"><b>⚠ ${spec.platform.displayName} areas not inspected:</b> ${gaps.joinToString(
                    ", ",
                )}. Differences there may be missing from this report.</li>",
            )
        }
    }
    val notFound = android.notFound.map { "Android: $it" } + ios.notFound.map { "iOS: $it" }
    if (notFound.isNotEmpty()) add("<li><b>Looked for but not found:</b> ${notFound.joinToString("; ") { html(it) }}</li>")
    // Stored results may have been edited by someone else, so even these fields are treated as untrusted
    add(
        "<li><b>Model:</b> <code>${html(
            run.model,
        )}</code> via Claude Code · <b>Tokens:</b> ${tokenCounts(run.usage)} · <b>Plan usage:</b> ${html(planUsageLabel(run.usage))}</li>",
    )
    add("<li><b>Generated:</b> ${html(formatUtc(run.generatedAt))} by driftcheck</li>")
}

/** What was analyzed, shown at the top of the report. */
data class ReportSubject(
    val appName: String,
    /** Each platform's source root, relative to the project root. */
    val paths: Map<Platform, String>,
)

/**
 * The parity report as one self-contained HTML file: no external resources, so it opens offline and cannot leak
 * anything when viewed. The content security policy enforces that even if escaping ever failed. Everything is
 * visible without JavaScript; the script only adds the filters.
 */
fun renderCompareReport(subject: ReportSubject, run: CompareRun, android: VerifiedFeatureSpec, ios: VerifiedFeatureSpec): String {
    val specs = listOf(android, ios)
    // Most severe first, whatever the category, so the report opens on what needs attention
    val differences = run.findings.filter { it.category != FindingCategory.EQUAL }
        .sortedWith(compareBy({ it.severity.ordinal }, { it.category.ordinal }))
    val same = run.findings.filter { it.category == FindingCategory.EQUAL }
    val questions = differences.mapNotNull { it.question?.takeIf(String::isNotBlank) }
    val refs = run.findings.flatMap(::references)
    val verifiedRefs = refs.count { it.status == EvidenceStatus.VERIFIED }
    val high = differences.count { it.severity == Severity.HIGH }
    val filterSeverities = Severity.entries.filter { s -> differences.any { it.severity == s } }
    val filterCategories = FindingCategory.entries.filter { c -> differences.any { it.category == c } }

    val kpis = """
        <div class="kpis">
          <div class="kpi"><b>${differences.size}</b><span>Differences</span></div>
          <div class="kpi${if (high > 0) " hi" else ""}"><b>$high</b><span>High severity</span></div>
          <div class="kpi"><b>${questions.size}</b><span>Questions for the team</span></div>
          <div class="kpi ${if (verifiedRefs == refs.size) "ok" else "partial"}"><b>$verifiedRefs/${refs.size}</b><span>References verified</span></div>
        </div>
    """.trimIndent()

    val filters = """
        <div class="filters" id="filters" role="group" aria-label="Filter differences" hidden>
          ${filterSeverities.joinToString("") { s ->
        """<button type="button" class="fchip s-${s.id}" data-sev="${s.id}" aria-pressed="true"><i aria-hidden="true">${SEVERITY_SYMBOLS.getValue(
            s,
        )}</i>${s.id.replaceFirstChar {
            it.uppercase()
        }} <span class="num">${differences.count { it.severity == s }}</span></button>"""
    }}
          <select id="category" aria-label="Category"><option value="">All categories</option>${filterCategories.joinToString("") {
        """<option value="${it.id}">${CATEGORY_LABELS.getValue(it)}</option>"""
    }}</select>
          <input id="search" type="search" placeholder="Search findings and files" aria-label="Search findings and files">
        </div>
    """.trimIndent()

    val list = if (differences.isEmpty()) {
        """<p class="empty">No differences found.</p>"""
    } else {
        """<div class="list">${differences.joinToString("\n") {
            findingItem(it, specs)
        }}<p class="empty" id="no-match" hidden>No differences match these filters.</p></div>"""
    }

    val questionList = if (questions.isEmpty()) {
        ""
    } else {
        """
        <section><h2>Questions for the team</h2><ol class="questions">${questions.joinToString("") {
            "<li>${html(it)}</li>"
        }}</ol></section>
        """.trimIndent()
    }

    val sameList = if (same.isEmpty()) {
        ""
    } else {
        """
        <details class="passed"><summary><span class="ok">✓</span> ${same.size} ${if (same.size == 1) "behavior is" else "behaviors are"} the same on both platforms</summary>
        <ul>${same.joinToString("") { f ->
            "<li>${html(f.title)}<div class=\"refs\">${references(f).joinToString("") { reference(it) }}</div></li>"
        }}</ul></details>
        """.trimIndent()
    }

    val summaries = """
        <details class="summaries"><summary>How each app implements it</summary><div class="vs">
          <div class="side"><div class="plat android">Android</div><p>${html(android.summary)}</p></div>
          <div class="side"><div class="plat ios">iOS</div><p>${html(ios.summary)}</p></div>
        </div></details>
    """.trimIndent()

    // Joined line by line rather than with trimMargin, so untrusted text that happens to contain "|" is never touched
    return listOf(
        "<!doctype html>",
        "<html lang=\"en\">",
        "<head>",
        "<meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\">",
        "<title>${html(subject.appName)}: ${html(run.featureName)} parity report</title>",
        "<style>$CSS</style>",
        "</head>",
        "<body>",
        "<main class=\"wrap\">",
        "<header class=\"top\"><span class=\"eyebrow\">driftcheck parity report</span>" +
            "<h1><span class=\"app\">${html(subject.appName)}</span><span class=\"feature\">${html(run.featureName)}</span></h1>" +
            "<p class=\"sub\">${Platform.entries.joinToString(" vs ") { p ->
                "<span class=\"plat ${p.id}\">${p.displayName}</span> <code>${html(subject.paths[p].orEmpty())}</code>"
            }}" +
            " · ${html(formatUtc(run.generatedAt))}</p></header>",
        kpis,
        summaries,
        "<section><h2>Differences <small>most severe first</small></h2>",
        filters,
        list,
        "</section>",
        questionList,
        sameList,
        "<section><h2>How this was checked</h2><ul class=\"checked\">${checkedLines(run, android, ios).joinToString("")}</ul></section>",
        "</main>",
        "<script>$SCRIPT</script>",
        "</body>",
        "</html>",
    ).filter { it.isNotEmpty() }.joinToString("\n", postfix = "\n")
}

private val CSS = """
:root {
  --bg: #F4F6F9; --surface: #FFFFFF; --surface-2: #EDF0F5; --fg: #17202B; --muted: #5A6676; --line: #D9DFE7; --focus: #2E4DB0;
  --sev-high: #B42318; --sev-high-bg: #FCEBE8; --sev-medium: #A84B06; --sev-medium-bg: #FDF1E3;
  --sev-low: #1D5FB8; --sev-low-bg: #E7EFFA; --sev-info: #5A6676; --sev-info-bg: #EDF0F5;
  --ok: #1D7A4D; --warn: #A84B06; --android: #0F7468; --ios: #5047B5;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root {
  --bg: #0E131A; --surface: #151C25; --surface-2: #1C2530; --fg: #E5EAF0; --muted: #96A2B2; --line: #2A3543; --focus: #91A8F6;
  --sev-high: #FF8B7B; --sev-high-bg: #3A1B17; --sev-medium: #F4A65E; --sev-medium-bg: #382615;
  --sev-low: #82B2F6; --sev-low-bg: #16263C; --sev-info: #A6B1BF; --sev-info-bg: #1F2833;
  --ok: #6FD3A1; --warn: #F4A65E; --android: #4FCFBF; --ios: #A9A3F7;
  color-scheme: dark;
} }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 var(--font); }
.wrap { max-width: 1040px; margin: 0 auto; padding-inline: 16px; padding-block: 32px 64px; display: grid; gap: 24px; }
h1, h2 { margin: 0; text-wrap: balance; }
h1 { display: grid; gap: 2px; letter-spacing: -0.01em; }
h1 .app { font-size: clamp(28px, 4.5vw, 38px); }
h1 .feature { font-size: clamp(18px, 2.6vw, 22px); font-weight: 500; color: var(--muted); }
.top { display: grid; gap: 6px; }
.sub .plat { font-size: 11px; }
h2 { font-size: 19px; margin-bottom: 12px; }
h2 small { font-size: 13px; font-weight: 400; color: var(--muted); margin-left: 6px; }
p { margin: 0; }
code { font-family: var(--mono); font-size: 0.88em; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.eyebrow { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.sub { color: var(--muted); font-size: 14px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.kpi { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; display: grid; gap: 2px; }
.kpi b { font-size: 26px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.kpi span { font-size: 13px; color: var(--muted); }
.kpi.hi b { color: var(--sev-high); } .kpi.ok b { color: var(--ok); } .kpi.partial b { color: var(--warn); }
.pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.pill i, .fchip i { font-style: normal; font-size: 10px; }
.s-high { color: var(--sev-high); background: var(--sev-high-bg); }
.s-medium { color: var(--sev-medium); background: var(--sev-medium-bg); }
.s-low { color: var(--sev-low); background: var(--sev-low-bg); }
.s-info { color: var(--sev-info); background: var(--sev-info-bg); }
.chip { display: inline-block; font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 6px; white-space: nowrap; }
.chip.warn { color: var(--warn); border-color: currentColor; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.fchip { font: inherit; font-size: 13px; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 4px 11px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.fchip[aria-pressed="true"] { border-color: currentColor; }
.fchip[aria-pressed="false"] { color: var(--muted); background: var(--surface); }
.filters select, .filters input { font: inherit; font-size: 13px; background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; min-width: 0; }
.filters input { flex: 1 1 200px; }
.list, .passed, .summaries { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
.list { overflow: hidden; }
.item { border-bottom: 1px solid var(--line); }
.item:last-of-type { border-bottom: 0; }
.item > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 14px; }
.item > summary::-webkit-details-marker { display: none; }
.item > summary:hover { background: var(--surface-2); }
.item .t { font-weight: 500; min-width: 0; }
.item .meta { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.item .body { padding: 4px 14px 16px 118px; display: grid; gap: 12px; }
.vs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.side { background: var(--surface-2); border-radius: 4px; padding: 10px 12px; min-width: 0; display: grid; gap: 4px; align-content: start; font-size: 14px; }
.side.absent { background: repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--surface) 6px 12px); }
.plat { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.plat.android { color: var(--android); } .plat.ios { color: var(--ios); }
.val { font-weight: 700; font-size: 15px; }
.none { color: var(--muted); font-style: italic; }
.refs { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.ref { font-family: var(--mono); font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.ref .ok, .ok { color: var(--ok); }
.ref.warn, .warn { color: var(--warn); }
.ref small { font-family: var(--font); }
.q { font-size: 14px; color: var(--muted); }
.q b { color: var(--fg); }
.empty { padding: 18px; color: var(--muted); text-align: center; }
.questions { margin: 0; padding-left: 22px; display: grid; gap: 4px; }
details.passed > summary, details.summaries > summary { cursor: pointer; padding: 11px 14px; font-weight: 600; }
.passed ul { margin: 0; padding: 0 14px 12px 38px; display: grid; gap: 8px; }
.summaries .vs { padding: 0 14px 14px; }
.checked { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 14px; }
.num { font-variant-numeric: tabular-nums; }
@media (max-width: 720px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .item > summary { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .item .meta { justify-content: flex-start; }
  .item .body { padding-left: 14px; }
  .vs { grid-template-columns: minmax(0, 1fr); }
}
@media print { .filters { display: none !important; } details { break-inside: avoid; } }
""".trim()

/** Only adds the filters; without it every difference is still listed. */
private val SCRIPT = """
(function () {
  var filters = document.getElementById("filters");
  if (!filters) return;
  filters.hidden = false;
  var items = Array.prototype.slice.call(document.querySelectorAll(".item"));
  var noMatch = document.getElementById("no-match");
  var category = document.getElementById("category");
  var search = document.getElementById("search");
  var chips = Array.prototype.slice.call(filters.querySelectorAll(".fchip"));
  function update() {
    var severities = chips.filter(function (c) { return c.getAttribute("aria-pressed") === "true"; }).map(function (c) { return c.dataset.sev; });
    var query = search.value.trim().toLowerCase();
    var shown = 0;
    items.forEach(function (item) {
      var text = (item.textContent + " " + Array.prototype.map.call(item.querySelectorAll("[title]"), function (e) { return e.title; }).join(" ")).toLowerCase();
      var visible = severities.indexOf(item.dataset.sev) >= 0 && (!category.value || item.dataset.cat === category.value) && (!query || text.indexOf(query) >= 0);
      item.hidden = !visible;
      if (visible) shown++;
    });
    if (noMatch) noMatch.hidden = shown > 0;
  }
  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true");
      update();
    });
  });
  category.addEventListener("change", update);
  search.addEventListener("input", update);
})();
""".trim()
