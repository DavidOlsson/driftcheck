package driftcheck.compare

import driftcheck.claude.FakeClaudeClient
import driftcheck.config.parseConfig
import driftcheck.model.Evidence
import driftcheck.model.EvidenceStatus
import driftcheck.model.Finding
import driftcheck.model.FindingCategory
import driftcheck.model.Platform
import driftcheck.model.PlatformSide
import driftcheck.model.Section
import driftcheck.model.Severity
import driftcheck.model.VerifiedEvidence
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedSpecItem
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals

class CompareTest {
    private fun spec(platform: Platform, vararg evidence: VerifiedEvidence) = VerifiedFeatureSpec(
        feature = "search",
        platform = platform,
        summary = "Search on ${platform.displayName}",
        items = evidence.mapIndexed { i, e ->
            VerifiedSpecItem("api.item_$i", Section.API, "Item $i", null, listOf(e), e.status == EvidenceStatus.VERIFIED)
        },
    )

    private val android = spec(
        Platform.ANDROID,
        VerifiedEvidence("Search.kt", 10, "limit = 20", EvidenceStatus.VERIFIED),
        VerifiedEvidence("Search.kt", 20, "retry", EvidenceStatus.QUOTE_NOT_FOUND),
        // Same line cited again, verified this time
        VerifiedEvidence("Search.kt", 20, "retry()", EvidenceStatus.VERIFIED),
    )
    private val ios = spec(Platform.IOS, VerifiedEvidence("Search.swift", 5, "limit: 50", EvidenceStatus.VERIFIED))

    private fun finding(category: FindingCategory, severity: Severity, android: List<Evidence>, ios: List<Evidence>?) =
        Finding(category, severity, "$category $severity", listOf("api.limit"), PlatformSide("a", android), ios?.let { PlatformSide("i", it) })

    @Test
    fun `keeps only evidence from the descriptions, with its checked status, and sorts into report order`() {
        val findings = listOf(
            finding(FindingCategory.EQUAL, Severity.INFO, listOf(Evidence("Search.kt", 10)), listOf(Evidence("Search.swift", 5))),
            finding(FindingCategory.BEHAVIOR, Severity.LOW, listOf(Evidence("Search.kt", 20, "made up")), null),
            finding(FindingCategory.BEHAVIOR, Severity.HIGH, listOf(Evidence("Search.kt", 10), Evidence("Invented.kt", 1)), listOf(Evidence("Search.swift", 6))),
        )

        val sanitized = sanitizeFindings(findings, "search", android, ios)

        assertEquals(listOf(Severity.HIGH, Severity.LOW, Severity.INFO), sanitized.map { it.severity })
        assertEquals(listOf(VerifiedEvidence("Search.kt", 10, "limit = 20", EvidenceStatus.VERIFIED)), sanitized[0].android!!.evidence)
        assertEquals(emptyList(), sanitized[0].ios!!.evidence)
        assertEquals(VerifiedEvidence("Search.kt", 20, "retry()", EvidenceStatus.VERIFIED), sanitized[1].android!!.evidence.single())
        assertEquals(null, sanitized[1].ios)
        assertEquals("search", sanitized[2].feature)
    }

    @Test
    fun `compares in one run without tools in the given directory`() {
        val client = FakeClaudeClient.answering(
            """{"findings":[{"category":"behavior","severity":"high","title":"Different limits","keys":["api.limit"],
                "android":{"summary":"20","evidence":[{"file":"Search.kt","line":10}]},
                "ios":{"summary":"50","evidence":[{"file":"Search.swift","line":5}]},
                "question":"Intentional?"}]}""",
        )
        val config = parseConfig("""{"version":1,"platforms":{"android":{"path":"a"},"ios":{"path":"i"}}}""", Path.of("/p"))

        val result = compareSpecs(client, config, android, ios, Path.of("/tmp/empty"))

        assertEquals("Different limits", result.output.single().title)
        assertEquals(0.5, result.usage.costUsd)
        val request = client.requests.single()
        assertEquals(emptyList(), request.options.tools)
        assertEquals(Path.of("/tmp/empty"), request.cwd)
        assertContains(request.prompt, "Search on Android")
        assertContains(request.prompt, "\"verified\": false")
    }
}
