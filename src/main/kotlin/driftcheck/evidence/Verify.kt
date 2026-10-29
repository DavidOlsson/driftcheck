package driftcheck.evidence

import driftcheck.model.Evidence
import driftcheck.model.EvidenceStatus
import driftcheck.model.FeatureSpec
import driftcheck.model.VerifiedEvidence
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedSpecItem
import driftcheck.source.SourceFile
import driftcheck.source.SourceReader

/** How many lines around the cited line a quote may appear on; models are often off by a line or two. */
const val QUOTE_WINDOW = 3

/** Whitespace is ignored, so reformatting or the model's spacing does not cause false negatives. */
private fun normalize(text: String) = text.filterNot { it.isWhitespace() }

/**
 * A quote shorter than this, without whitespace, matches almost any few lines of code ("}", "val", "= 0"), so finding
 * it proves nothing about the cited line.
 */
const val MIN_QUOTE_LENGTH = 6

/** Pure: [file] is what reading the cited file gave. */
fun checkEvidence(file: SourceFile, evidence: Evidence): EvidenceStatus {
    val lines = when (file) {
        SourceFile.Missing -> return EvidenceStatus.FILE_NOT_FOUND
        SourceFile.TooLarge -> return EvidenceStatus.FILE_TOO_LARGE
        is SourceFile.Text -> file.lines
    }
    if (evidence.line < 1 || evidence.line > lines.size) return EvidenceStatus.LINE_OUT_OF_RANGE
    val quote = normalize(evidence.quote.orEmpty())
    if (quote.isEmpty()) return EvidenceStatus.LINE_EXISTS
    val from = maxOf(0, evidence.line - 1 - QUOTE_WINDOW)
    val to = minOf(lines.size, evidence.line + QUOTE_WINDOW)
    val window = normalize(lines.subList(from, to).joinToString("\n"))
    return when {
        quote !in window -> EvidenceStatus.QUOTE_NOT_FOUND
        quote.length < MIN_QUOTE_LENGTH -> EvidenceStatus.QUOTE_TOO_SHORT
        else -> EvidenceStatus.VERIFIED
    }
}

/**
 * Checks every piece of evidence against the source. This is the guard against made-up files, lines and values:
 * reports show what was verified. Each file is read once.
 */
fun verifySpec(spec: FeatureSpec, reader: SourceReader): VerifiedFeatureSpec {
    val files = mutableMapOf<String, SourceFile>()
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
    return VerifiedFeatureSpec(spec.feature, spec.platform, spec.summary, items, spec.notFound, spec.coverage, spec.omitted)
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
