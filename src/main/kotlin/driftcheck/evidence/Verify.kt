package driftcheck.evidence

import driftcheck.model.Evidence
import driftcheck.model.EvidenceStatus
import driftcheck.model.FeatureSpec
import driftcheck.model.VerifiedEvidence
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedSpecItem
import driftcheck.source.SourceReader

/** How many lines around the cited line a quote may appear on; models are often off by a line or two. */
const val QUOTE_WINDOW = 3

/** Whitespace is ignored, so reformatting or the model's spacing does not cause false negatives. */
private fun normalize(text: String) = text.filterNot { it.isWhitespace() }

/** Pure: [fileText] is null when the file does not exist or lies outside the platform root. */
fun checkEvidence(fileText: String?, evidence: Evidence): EvidenceStatus {
    if (fileText == null) return EvidenceStatus.FILE_NOT_FOUND
    val lines = fileText.lines()
    if (evidence.line < 1 || evidence.line > lines.size) return EvidenceStatus.LINE_OUT_OF_RANGE
    val quote = evidence.quote?.trim()
    if (quote.isNullOrEmpty()) return EvidenceStatus.LINE_EXISTS
    val from = maxOf(0, evidence.line - 1 - QUOTE_WINDOW)
    val to = minOf(lines.size, evidence.line + QUOTE_WINDOW)
    val window = normalize(lines.subList(from, to).joinToString("\n"))
    return if (normalize(quote) in window) EvidenceStatus.VERIFIED else EvidenceStatus.QUOTE_NOT_FOUND
}

/**
 * Checks every piece of evidence against the source. This is the guard against made-up files, lines and values:
 * reports show what was verified. Each file is read once.
 */
fun verifySpec(spec: FeatureSpec, reader: SourceReader): VerifiedFeatureSpec {
    val files = mutableMapOf<String, String?>()
    val items = spec.items.map { item ->
        val evidence = item.evidence.map { e ->
            VerifiedEvidence(e.file, e.line, e.quote, checkEvidence(files.getOrPut(e.file) { reader.read(e.file) }, e))
        }
        VerifiedSpecItem(
            item.key,
            item.section,
            item.description,
            item.value,
            evidence,
            evidence.any {
                it.status == EvidenceStatus.VERIFIED
            },
        )
    }
    return VerifiedFeatureSpec(spec.feature, spec.platform, spec.summary, items, spec.notFound, spec.coverage)
}

data class VerificationSummary(val items: Int, val verifiedItems: Int, val evidence: Map<EvidenceStatus, Int>)

fun summarize(spec: VerifiedFeatureSpec): VerificationSummary {
    val counts = spec.items.flatMap { it.evidence }.groupingBy { it.status }.eachCount()
    return VerificationSummary(
        items = spec.items.size,
        verifiedItems = spec.items.count { it.verified },
        evidence = EvidenceStatus.entries.associateWith { counts[it] ?: 0 },
    )
}
