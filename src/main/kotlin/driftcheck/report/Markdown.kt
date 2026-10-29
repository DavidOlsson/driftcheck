package driftcheck.report

import driftcheck.evidence.summarize
import driftcheck.model.CompareRun
import driftcheck.model.CoverageStatus
import driftcheck.model.EvidenceStatus
import driftcheck.model.FindingCategory
import driftcheck.model.PlanWindow
import driftcheck.model.Usage
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedFinding
import driftcheck.model.VerifiedPlatformSide
import driftcheck.model.WindowStatus
import java.util.Locale

private val SECTION_TITLES = linkedMapOf(
    FindingCategory.BEHAVIOR to "🔴 Behavior differences",
    FindingCategory.BUG to "🟠 Possible bugs or gaps",
    FindingCategory.MISSING to "🟣 Only on one platform",
    FindingCategory.UI to "🟡 UI differences",
    FindingCategory.EQUAL to "✅ Same on both platforms",
)

private const val UNVERIFIED_MARK = "⚠️"

/** Everything but line breaks and tabs, which [mdText] turns into spaces. */
private val CONTROL_CHARACTERS = Regex("[\\p{Cc}&&[^\\n\\r\\t]]")

/** Markdown table cells must not break the table. */
fun cell(text: String): String = text.replace("|", "\\|").replace(Regex("\\r?\\n"), " ")

/**
 * Text from the model, the analyzed code or its config, made inert for Markdown. Raw HTML, links and images (which
 * load a URL when viewed, and can leak data through it) must never come from untrusted text. Line breaks become
 * spaces, so the text cannot start headings or list items either, and control characters, which could rewrite a
 * terminal showing the file, are removed. Light formatting such as backticks is kept.
 */
fun mdText(text: String): String = text
    .replace(CONTROL_CHARACTERS, "")
    .replace("\\", "\\\\")
    .replace("[", "\\[")
    .replace("]", "\\]")
    // Only "<" can open HTML; ">" is harmless once line breaks are gone, and stays readable
    .replace("<", "&lt;")
    .replace(Regex("\\s*\\r?\\n\\s*"), " ")

private fun side(s: VerifiedPlatformSide?): String {
    if (s == null) return "—"
    val refs = s.evidence.joinToString(", ") { e ->
        "`${cell(e.location.replace("`", "'").replace(CONTROL_CHARACTERS, ""))}`" + if (e.status == EvidenceStatus.VERIFIED) "" else " $UNVERIFIED_MARK"
    }
    return cell(if (refs.isEmpty()) mdText(s.summary) else "${mdText(s.summary)} ($refs)")
}

private fun verificationLine(spec: VerifiedFeatureSpec): String {
    val s = summarize(spec)
    return "- **${spec.platform.displayName}:** ${s.verifiedItems} of ${s.items} items verified against the source"
}

/** The descriptions can be well verified while the findings rest on their weakest items, so findings get their own line. */
private fun findingEvidenceLines(findings: List<VerifiedFinding>): List<String> = buildList {
    val refs = findings.flatMap { f -> f.android?.evidence.orEmpty() + f.ios?.evidence.orEmpty() }
    if (refs.isNotEmpty()) {
        val verified = refs.count { it.status == EvidenceStatus.VERIFIED }
        add("- **Findings:** $verified of ${refs.size} source references verified; $UNVERIFIED_MARK marks the ones that could not be confirmed")
    }
    val unsourced = findings.filter { f -> f.android?.evidence.orEmpty().isEmpty() && f.ios?.evidence.orEmpty().isEmpty() }
    if (unsourced.isNotEmpty()) {
        add("- $UNVERIFIED_MARK **Findings without a source reference:** ${unsourced.joinToString("; ") { cell(mdText(it.title)) }}")
    }
}

fun tokenCounts(usage: Usage): String =
    String.format(Locale.ENGLISH, "%,d in, %,d out", usage.inputTokens, usage.outputTokens)

/** Reports must not depend on the machine's time zone. */
fun formatUtc(iso: String): String = if (iso.length >= 16) "${iso.substring(0, 10)} ${iso.substring(11, 16)} UTC" else iso

private fun windowState(window: PlanWindow): String {
    val used = window.usedPercent?.let { "$it% used" }
    return when (window.status) {
        WindowStatus.REJECTED -> "limit reached"
        WindowStatus.ALLOWED_WARNING -> {
            val over = window.thresholdPercent?.let { "over $it% used" } ?: used
            "approaching limit" + (over?.let { " ($it)" } ?: "")
        }
        else -> used ?: "OK"
    }
}

private fun formatWindow(name: String, window: PlanWindow?, formatTime: (String) -> String): String? =
    window?.let { "$name ${windowState(it)}" + (it.resetsAt?.let { at -> ", resets ${formatTime(at)}" } ?: "") }

/**
 * Runs count toward the user's Claude plan rather than being billed per token, so the plan's 5-hour and weekly
 * windows are shown instead of Claude Code's dollar estimate.
 */
fun planUsageLabel(usage: Usage, formatTime: (String) -> String = ::formatUtc): String {
    val windows = listOfNotNull(
        formatWindow("5-hour window", usage.plan?.fiveHour, formatTime),
        formatWindow("weekly limit", usage.plan?.weekly, formatTime),
    )
    return if (windows.isEmpty()) "not reported by Claude Code for this run" else windows.joinToString(" · ")
}

fun renderCompareReport(run: CompareRun, android: VerifiedFeatureSpec, ios: VerifiedFeatureSpec): String = buildList {
    val findings = run.findings
    add("# Parity report: ${mdText(run.featureName)}")
    add("")
    add("| | Android | iOS |")
    add("|---|---|---|")
    add("| Summary | ${cell(mdText(android.summary))} | ${cell(mdText(ios.summary))} |")
    add("")

    add("## Summary")
    add("")
    add("| Category | Count |")
    add("|---|---|")
    SECTION_TITLES.forEach { (category, title) -> add("| $title | ${findings.count { it.category == category }} |") }
    add("")

    SECTION_TITLES.forEach { (category, title) ->
        val items = findings.filter { it.category == category }
        if (items.isEmpty()) return@forEach
        add("## $title")
        add("")
        add("| # | Severity | Finding | Android | iOS |")
        add("|---|---|---|---|---|")
        items.forEachIndexed { i, f -> add("| ${i + 1} | ${f.severity.id} | ${cell(mdText(f.title))} | ${side(f.android)} | ${side(f.ios)} |") }
        add("")
    }

    val questions = findings.mapNotNull { it.question?.takeIf(String::isNotBlank) }
    if (questions.isNotEmpty()) {
        add("## Questions for the team")
        add("")
        questions.forEachIndexed { i, q -> add("${i + 1}. ${mdText(q)}") }
        add("")
    }

    add("## How this was checked")
    add("")
    add(verificationLine(android))
    add(verificationLine(ios))
    addAll(findingEvidenceLines(findings))
    for (spec in listOf(android, ios)) {
        val gaps = spec.coverage.filter { it.status == CoverageStatus.NOT_INSPECTED }.map { it.section.id }
        if (gaps.isNotEmpty()) {
            add("- $UNVERIFIED_MARK **${spec.platform.displayName} sections not inspected:** ${gaps.joinToString(", ")}. Differences there may be missing from this report.")
        }
    }
    val notFound = android.notFound.map { "Android: $it" } + ios.notFound.map { "iOS: $it" }
    if (notFound.isNotEmpty()) add("- **Looked for but not found:** ${notFound.joinToString("; ") { cell(mdText(it)) }}")
    // Stored results may have been edited by someone else, so even these fields are treated as untrusted
    add("- **Model:** `${mdText(run.model.replace("`", "'"))}` via Claude Code · **Tokens:** ${tokenCounts(run.usage)} · **Plan usage:** ${mdText(planUsageLabel(run.usage))}")
    add("- **Generated:** ${mdText(formatUtc(run.generatedAt))} by driftcheck")
    add("")
}.joinToString("\n")
