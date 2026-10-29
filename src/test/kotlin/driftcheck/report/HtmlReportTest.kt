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
import kotlin.test.assertTrue

class HtmlReportTest {
    private val androidLimit = VerifiedEvidence("app/Search.kt", 10, "limit = 20", EvidenceStatus.VERIFIED)
    private val iosLimit = VerifiedEvidence("Search/Search.swift", 5, "limit: 50", EvidenceStatus.QUOTE_NOT_FOUND)

    private val android = VerifiedFeatureSpec(
        "search",
        Platform.ANDROID,
        "Searches as you type",
        listOf(VerifiedSpecItem("api.limit", Section.API, "Limit", "20", listOf(androidLimit), true)),
        notFound = listOf("voice search"),
    )
    private val ios = VerifiedFeatureSpec(
        "search",
        Platform.IOS,
        "Searches on submit",
        listOf(VerifiedSpecItem("api.limit", Section.API, "Limit", "50", listOf(iosLimit), false)),
        coverage = listOf(SectionCoverage(Section.STORAGE, CoverageStatus.NOT_INSPECTED)),
        omitted = listOf("input_handling.max_length"),
    )

    private fun finding(
        category: FindingCategory,
        severity: Severity,
        title: String,
        android: VerifiedPlatformSide?,
        ios: VerifiedPlatformSide?,
        question: String? = null,
    ) = VerifiedFinding("search", category, severity, title, listOf("api.limit"), android, ios, question)

    private val run = CompareRun(
        feature = "search",
        featureName = "Search",
        model = "claude-sonnet-5-5",
        generatedAt = "2026-10-13T08:30:00Z",
        usage = Usage(12_345, 678, 1.2, PlanUsage(fiveHour = PlanWindow(WindowStatus.ALLOWED_WARNING, 80, 75, "2026-10-13T12:00:00Z"))),
        findings = listOf(
            finding(
                FindingCategory.MISSING,
                Severity.MEDIUM,
                "Voice search <img src=https://evil.example/x>",
                VerifiedPlatformSide("Mic button\" onmouseover=\"alert(1)", emptyList(), "Mic \u001b[2J"),
                null,
            ),
            finding(
                FindingCategory.BEHAVIOR,
                Severity.HIGH,
                "Different result limits",
                VerifiedPlatformSide("20 results", listOf(androidLimit), "20"),
                VerifiedPlatformSide("50 results", listOf(iosLimit), "50"),
                question = "Is the higher limit on iOS intentional?",
            ),
            finding(
                FindingCategory.EQUAL,
                Severity.INFO,
                "Both cancel in-flight requests",
                VerifiedPlatformSide("Cancels", listOf(androidLimit)),
                VerifiedPlatformSide("Cancels", emptyList()),
            ),
        ),
    )

    private val subject = ReportSubject("Wikipedia <beta>", mapOf(Platform.ANDROID to "android", Platform.IOS to "apps/ios"))

    private val report = renderCompareReport(subject, run, android, ios)

    @Test
    fun `is one self-contained page that cannot load anything`() {
        assertTrue(report.startsWith("<!doctype html>"))
        assertContains(report, "<title>Wikipedia &lt;beta&gt;: Search parity report</title>")
        assertContains(report, "content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\"")
        assertFalse(Regex("(src|href)=\"https?:").containsMatchIn(report))
    }

    @Test
    fun `names the app, the feature and the analyzed folders at the top`() {
        assertContains(report, """<h1><span class="app">Wikipedia &lt;beta&gt;</span><span class="feature">Search</span></h1>""")
        assertContains(
            report,
            """<span class="plat android">Android</span> <code>android</code> vs <span class="plat ios">iOS</span> <code>apps/ios</code>""",
        )
    }

    @Test
    fun `opens with the numbers and lists differences most severe first`() {
        assertContains(report, "<b>2</b><span>Differences</span>")
        assertContains(report, "<b>1</b><span>High severity</span>")
        assertContains(report, "<b>1</b><span>Questions for the team</span>")
        assertContains(report, "<b>2/3</b><span>References verified</span>")
        assertTrue(report.indexOf("Different result limits") < report.indexOf("Voice search"))
        assertContains(report, """data-sev="high" data-cat="behavior"""")
        assertContains(report, """<div class="val">20</div>""")
        assertContains(report, "Not found on iOS")
        assertContains(report, "<span class=\"chip\">Search and API</span>")
        assertContains(report, "1 behavior is the same on both platforms")
        assertContains(report, "<li>Is the higher limit on iOS intentional?</li>")
    }

    @Test
    fun `marks evidence that could not be verified and findings without any`() {
        assertContains(report, """<b class="ok" aria-label="verified">✓</b> Search.kt:10""")
        assertContains(report, """<b aria-label="not verified">⚠</b> Search.swift:5 <small>quote not found</small>""")
        assertContains(report, "⚠ No source reference")
        assertContains(report, "2 of 3 source references verified; ⚠ marks the ones that could not be confirmed")
    }

    @Test
    fun `says how it was checked and what it used`() {
        assertContains(report, "<b>Android:</b> 1 of 1 items verified against the source")
        assertContains(report, "<b>iOS:</b> 0 of 1 items verified against the source")
        assertContains(report, "⚠ iOS areas not inspected:</b> Storage")
        assertContains(report, "<b>Looked for but not found:</b> Android: voice search")
        assertContains(report, "⚠ Left out, no evidence given:</b> iOS: input_handling.max_length")
        assertContains(report, "<b>Tokens:</b> 12,345 in, 678 out")
        assertContains(report, "5-hour window approaching limit (over 75% used), resets 2026-10-13 12:00 UTC")
        assertContains(report, "<b>Generated:</b> 2026-10-13 08:30 UTC by driftcheck")
    }

    @Test
    fun `makes untrusted text inert`() {
        assertFalse("<img" in report)
        assertContains(report, "Voice search &lt;img src=https://evil.example/x&gt;")
        assertContains(report, "Mic button&quot; onmouseover=&quot;alert(1)")
        assertFalse("\u001b" in report)
        assertEquals("a&amp;b&#39;c", html("a&b'c"))
    }

    @Test
    fun `lists every difference without JavaScript and shows the filters only with it`() {
        assertContains(report, """<div class="filters" id="filters" role="group" aria-label="Filter differences" hidden>""")
        assertContains(report, "filters.hidden = false")
    }

    @Test
    fun `says so when the platforms do not differ`() {
        val same =
            renderCompareReport(subject, run.copy(findings = run.findings.filter { it.category == FindingCategory.EQUAL }), android, ios)
        assertContains(same, "No differences found.")
        assertFalse("data-sev=" in same)
    }
}
