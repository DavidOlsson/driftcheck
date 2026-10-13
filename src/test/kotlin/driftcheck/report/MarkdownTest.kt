package driftcheck.report

import driftcheck.model.CompareRun
import driftcheck.model.CoverageStatus
import driftcheck.model.EvidenceStatus
import driftcheck.model.FindingCategory
import driftcheck.model.PlanUsage
import driftcheck.model.PlanWindow
import driftcheck.model.Platform
import driftcheck.model.Section
import driftcheck.model.SectionCoverage
import driftcheck.model.Severity
import driftcheck.model.Usage
import driftcheck.model.VerifiedEvidence
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedFinding
import driftcheck.model.VerifiedPlatformSide
import driftcheck.model.VerifiedSpecItem
import driftcheck.model.WindowStatus
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class MarkdownTest {
    private val androidLimit = VerifiedEvidence("Search.kt", 10, "limit = 20", EvidenceStatus.VERIFIED)
    private val iosLimit = VerifiedEvidence("Search.swift", 5, "limit: 50", EvidenceStatus.QUOTE_NOT_FOUND)

    private val android = VerifiedFeatureSpec(
        "search", Platform.ANDROID, "Searches | as you type",
        listOf(VerifiedSpecItem("api.limit", Section.API, "Limit", "20", listOf(androidLimit), true)),
        notFound = listOf("voice search"),
    )
    private val ios = VerifiedFeatureSpec(
        "search", Platform.IOS, "Searches on submit",
        listOf(VerifiedSpecItem("api.limit", Section.API, "Limit", "50", listOf(iosLimit), false)),
        coverage = listOf(SectionCoverage(Section.STORAGE, CoverageStatus.NOT_INSPECTED)),
    )

    private val run = CompareRun(
        feature = "search",
        featureName = "Search",
        model = "claude-sonnet-5-5",
        generatedAt = "2026-10-13T08:30:00Z",
        usage = Usage(12_345, 678, 1.2, PlanUsage(fiveHour = PlanWindow(WindowStatus.ALLOWED_WARNING, 80, 75, "2026-10-13T12:00:00Z"))),
        findings = listOf(
            VerifiedFinding(
                "search", FindingCategory.BEHAVIOR, Severity.HIGH, "Different result limits", listOf("api.limit"),
                VerifiedPlatformSide("20 results", listOf(androidLimit)), VerifiedPlatformSide("50 results", listOf(iosLimit)),
                question = "Is the higher limit on iOS intentional?",
            ),
            VerifiedFinding(
                "search", FindingCategory.MISSING, Severity.MEDIUM, "Voice search <img src=x onerror=alert(1)>", listOf("entry_points.voice"),
                VerifiedPlatformSide("Mic button [click](https://evil.example)", emptyList()), null,
            ),
        ),
    )

    private val report = renderCompareReport(run, android, ios)

    @Test
    fun `lists findings by category with their evidence and marks what could not be verified`() {
        assertContains(report, "# Parity report: Search")
        assertContains(report, "| 🔴 Behavior differences | 1 |")
        assertContains(report, "| ✅ Same on both platforms | 0 |")
        assertContains(report, "| 1 | high | Different result limits | 20 results (`Search.kt:10`) | 50 results (`Search.swift:5` ⚠️) |")
        assertFalse("## ✅ Same on both platforms" in report)
        assertContains(report, "1. Is the higher limit on iOS intentional?")
    }

    @Test
    fun `says how it was checked and what it used`() {
        assertContains(report, "- **Android:** 1 of 1 items verified against the source")
        assertContains(report, "- **iOS:** 0 of 1 items verified against the source")
        assertContains(report, "- **Findings:** 1 of 2 source references verified")
        assertContains(report, "**Findings without a source reference:** Voice search")
        assertContains(report, "**iOS sections not inspected:** storage")
        assertContains(report, "**Looked for but not found:** Android: voice search")
        assertContains(report, "**Tokens:** 12,345 in, 678 out")
        assertContains(report, "**Plan usage:** 5-hour window approaching limit (over 75% used), resets 2026-10-13 12:00 UTC")
        assertContains(report, "- **Generated:** 2026-10-13 08:30 UTC by driftcheck")
    }

    @Test
    fun `makes untrusted text inert and keeps tables intact`() {
        assertContains(report, "Searches \\| as you type")
        assertContains(report, "&lt;img src=x onerror=alert(1)>")
        assertContains(report, "Mic button \\[click\\](https://evil.example)")
        assertFalse("<img" in report)
        assertEquals("a b", mdText("a\n  b"))
    }

    @Test
    fun `labels plan usage that Claude Code did not report`() {
        assertEquals("not reported by Claude Code for this run", planUsageLabel(Usage()))
        assertEquals(
            "5-hour window 42% used · weekly limit limit reached, resets 2026-10-20 00:00 UTC",
            planUsageLabel(Usage(plan = PlanUsage(PlanWindow(usedPercent = 42), PlanWindow(WindowStatus.REJECTED, resetsAt = "2026-10-20T00:00:00Z")))),
        )
    }
}
