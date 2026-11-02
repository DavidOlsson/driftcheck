package driftcheck.stability

import driftcheck.model.CompareRun
import driftcheck.model.FindingCategory
import driftcheck.model.Platform
import driftcheck.model.Section
import driftcheck.model.Severity
import driftcheck.model.Usage
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedFinding
import driftcheck.model.VerifiedSpecItem
import driftcheck.model.storeJson
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

class StabilityTest {
    private fun spec(platform: Platform, vararg keys: String) = VerifiedFeatureSpec(
        "search",
        platform,
        "summary",
        keys.map { VerifiedSpecItem(it, Section.API, "description", evidence = emptyList(), verified = false) },
    )

    private fun finding(category: FindingCategory, severity: Severity, vararg keys: String) =
        VerifiedFinding("search", category, severity, "title", keys.toList(), android = null, ios = null)

    private fun run(android: List<String>, ios: List<String>, vararg findings: VerifiedFinding) = RunResults(
        mapOf(Platform.ANDROID to spec(Platform.ANDROID, *android.toTypedArray()), Platform.IOS to spec(Platform.IOS, *ios.toTypedArray())),
        findings.toList(),
    )

    @Test
    fun `measures keys, bundled differences and matching findings`() {
        val a = run(
            android = listOf("api.timeout", "api.limit", "input.trim"),
            ios = listOf("api.timeout", "input.debounce"),
            finding(FindingCategory.BEHAVIOR, Severity.LOW, "input.trim"),
            finding(FindingCategory.BUG, Severity.HIGH, "api.limit", "api.retry"),
            finding(FindingCategory.MISSING, Severity.MEDIUM, "history.clear"),
            finding(FindingCategory.EQUAL, Severity.INFO, "api.timeout"),
        )
        val b = run(
            android = listOf("api.timeout", "api.max_results", "input.trim"),
            ios = listOf("api.timeout", "input.trim"),
            finding(FindingCategory.BUG, Severity.MEDIUM, "input.trim"),
            finding(FindingCategory.BUG, Severity.HIGH, "api.retry"),
            // Equal findings are not differences, so they never count as a match
            finding(FindingCategory.EQUAL, Severity.INFO, "history.clear"),
        )

        val s = stability(a, b)

        assertEquals(RunShape(sharedKeys = Share(1, 4), differences = 3, bundled = 1), s.a)
        assertEquals(RunShape(sharedKeys = Share(2, 3), differences = 2, bundled = 0), s.b)
        assertEquals(mapOf(Platform.ANDROID to Share(2, 4), Platform.IOS to Share(1, 3)), s.sameKeys)
        assertEquals(Share(2, 3), s.matchedDifferences)
        assertEquals(Share(1, 2), s.sameCategory)
        assertEquals(Share(1, 2), s.sameSeverity)
    }

    @Test
    fun `reads a stored results folder`() {
        val dir = Files.createTempDirectory("driftcheck-stability")
        val expected = run(listOf("api.timeout"), listOf("api.limit"), finding(FindingCategory.BUG, Severity.HIGH, "api.limit"))
        Files.createDirectories(dir.resolve("specs/search"))
        Files.createDirectories(dir.resolve("findings"))
        for ((platform, spec) in expected.specs) {
            Files.writeString(
                dir.resolve("specs/search/${platform.id}.json"),
                storeJson.encodeToString(VerifiedFeatureSpec.serializer(), spec),
            )
        }
        val compareRun = CompareRun("search", "Search", "model", "2026-11-02T00:00:00Z", Usage.NONE, expected.findings)
        Files.writeString(dir.resolve("findings/search.json"), storeJson.encodeToString(CompareRun.serializer(), compareRun))

        assertEquals(expected, loadResults(dir, "search"))
    }
}
