package driftcheck.evidence

import driftcheck.model.Evidence
import driftcheck.model.EvidenceStatus
import driftcheck.model.FeatureSpec
import driftcheck.model.Platform
import driftcheck.model.Section
import driftcheck.model.SpecItem
import driftcheck.source.SourceReader
import kotlin.test.Test
import kotlin.test.assertEquals

class VerifyTest {
    private val source = """
        package org.wikipedia.search

        class SearchFragment {
            companion object {
                private const val DELAY_MILLIS = 300L
            }
        }
    """.trimIndent()

    @Test
    fun `verifies a quote on the cited line, near it, or with different whitespace`() {
        assertEquals(EvidenceStatus.VERIFIED, checkEvidence(source, Evidence("a.kt", 5, "DELAY_MILLIS = 300L")))
        assertEquals(EvidenceStatus.VERIFIED, checkEvidence(source, Evidence("a.kt", 2, "DELAY_MILLIS = 300L")))
        assertEquals(EvidenceStatus.VERIFIED, checkEvidence(source, Evidence("a.kt", 5, "const val DELAY_MILLIS=300L")))
    }

    @Test
    fun `reports what could not be confirmed`() {
        assertEquals(EvidenceStatus.FILE_NOT_FOUND, checkEvidence(null, Evidence("a.kt", 1, "x")))
        assertEquals(EvidenceStatus.LINE_OUT_OF_RANGE, checkEvidence(source, Evidence("a.kt", 99, "x")))
        assertEquals(EvidenceStatus.LINE_OUT_OF_RANGE, checkEvidence(source, Evidence("a.kt", 0, "x")))
        assertEquals(EvidenceStatus.QUOTE_NOT_FOUND, checkEvidence(source, Evidence("a.kt", 5, "DELAY_MILLIS = 500L")))
        // Too far from the cited line
        assertEquals(EvidenceStatus.QUOTE_NOT_FOUND, checkEvidence(source, Evidence("a.kt", 1, "DELAY_MILLIS = 300L")))
        assertEquals(EvidenceStatus.LINE_EXISTS, checkEvidence(source, Evidence("a.kt", 5, " ")))
    }

    @Test
    fun `verifies a description, reading each file once`() {
        val reads = mutableListOf<String>()
        val reader = SourceReader { path -> reads += path; if (path == "SearchFragment.kt") source else null }
        val spec = FeatureSpec(
            feature = "search",
            platform = Platform.ANDROID,
            summary = "Search",
            items = listOf(
                SpecItem("input_handling.debounce_ms", Section.INPUT_HANDLING, "Debounce", "300", listOf(Evidence("SearchFragment.kt", 5, "DELAY_MILLIS = 300L"))),
                SpecItem("api.limit", Section.API, "Limit", "20", listOf(Evidence("SearchFragment.kt", 3, "limit = 20"), Evidence("Missing.kt", 1, "x"))),
            ),
        )

        val verified = verifySpec(spec, reader)

        assertEquals(listOf(true, false), verified.items.map { it.verified })
        assertEquals(listOf("SearchFragment.kt", "Missing.kt"), reads)
        val summary = summarize(verified)
        assertEquals(2, summary.items)
        assertEquals(1, summary.verifiedItems)
        assertEquals(1, summary.evidence[EvidenceStatus.FILE_NOT_FOUND])
        assertEquals(0, summary.evidence[EvidenceStatus.LINE_EXISTS])
        assertEquals(spec, verified.toSpec())
    }
}
