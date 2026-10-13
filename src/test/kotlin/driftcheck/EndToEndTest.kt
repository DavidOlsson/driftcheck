package driftcheck

import driftcheck.claude.ClaudeRequest
import driftcheck.claude.ClaudeResult
import driftcheck.claude.ClaudeRunException
import driftcheck.claude.FakeClaudeClient
import driftcheck.claude.READ_ONLY_TOOLS
import driftcheck.model.PlanUsage
import driftcheck.model.PlanWindow
import driftcheck.model.Usage
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.io.PrintStream
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneOffset
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.copyToRecursively
import kotlin.io.path.deleteExisting
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.toPath
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The whole pipeline on a small synthetic twin app (src/test/resources/twin-app) with known differences: the debounce
 * (300 ms vs 0.5 s), the result limit (20 vs 50) and trimming (Android only). Claude is faked; everything else is real.
 */
@OptIn(ExperimentalPathApi::class)
class EndToEndTest {
    private val project: Path = Files.createTempDirectory("driftcheck-e2e").also { dir ->
        val fixture = javaClass.getResource("/twin-app")!!.toURI().toPath()
        fixture.copyToRecursively(dir, followLinks = false, overwrite = true)
    }
    private val androidRoot = project.resolve("android")
    private val iosRoot = project.resolve("ios")

    private val androidSpec = """
        {"feature":"search","platform":"android","summary":"Searches as the user types, after a 300 ms pause.",
         "items":[
          {"key":"input_handling.debounce_ms","section":"input_handling","description":"Waits before searching","value":"300 ms",
           "evidence":[{"file":"app/src/main/java/org/example/search/SearchViewModel.kt","line":7,"quote":"const val DEBOUNCE_MS = 300L"}]},
          {"key":"api.result_limit","section":"api","description":"Maximum number of results","value":"20",
           "evidence":[{"file":"app/src/main/java/org/example/search/SearchViewModel.kt","line":8,"quote":"RESULT_LIMIT = 20"}]},
          {"key":"input_handling.trim","section":"input_handling","description":"Trims the query","value":null,
           "evidence":[{"file":"app/src/main/java/org/example/search/SearchViewModel.kt","line":12,"quote":"query.trim()"}]},
          {"key":"api.timeout_ms","section":"api","description":"A made-up timeout","value":"10000",
           "evidence":[{"file":"app/src/main/java/org/example/search/SearchViewModel.kt","line":40,"quote":"TIMEOUT = 10000"}]}
         ],
         "notFound":["voice search"],
         "coverage":[{"section":"storage","status":"not_found","filesRead":[]}]}
    """

    private val iosSpec = """
        {"feature":"search","platform":"ios","summary":"Searches as the user types, after half a second.",
         "items":[
          {"key":"input_handling.debounce_ms","section":"input_handling","description":"Waits before searching","value":"500 ms",
           "evidence":[{"file":"Search/SearchViewModel.swift","line":4,"quote":"debounceInterval: TimeInterval = 0.5"}]},
          {"key":"api.result_limit","section":"api","description":"Maximum number of results","value":"50",
           "evidence":[{"file":"Search/SearchViewModel.swift","line":5,"quote":"static let resultLimit = 50"}]},
          {"key":"input_handling.empty_query","section":"input_handling","description":"Skips empty queries without trimming","value":null,
           "evidence":[{"file":"Search/SearchViewModel.swift","line":14,"quote":"if query.isEmpty { return [] }"}]}
         ],
         "coverage":[{"section":"storage","status":"not_inspected"}]}
    """

    private val findings = """
        {"findings":[
          {"category":"equal","severity":"info","title":"Both skip empty queries","keys":["input_handling.empty_query"],
           "android":{"summary":"Returns nothing for an empty query","evidence":[]},
           "ios":{"summary":"Returns nothing for an empty query","evidence":[{"file":"Search/SearchViewModel.swift","line":14}]}},
          {"category":"behavior","severity":"high","title":"Different result limits","keys":["api.result_limit"],
           "android":{"summary":"20 results","evidence":[{"file":"app/src/main/java/org/example/search/SearchViewModel.kt","line":8}]},
           "ios":{"summary":"50 results","evidence":[{"file":"Search/SearchViewModel.swift","line":5},{"file":"Search/Invented.swift","line":1}]},
           "question":"Is the higher limit on iOS intentional?"},
          {"category":"bug","severity":"medium","title":"iOS does not trim the query","keys":["input_handling.trim"],
           "android":{"summary":"Trims","evidence":[{"file":"app/src/main/java/org/example/search/SearchViewModel.kt","line":12}]},
           "ios":null},
          {"category":"behavior","severity":"medium","title":"Different debounce","keys":["input_handling.debounce_ms"],
           "android":{"summary":"300 ms","evidence":[{"file":"app/src/main/java/org/example/search/SearchViewModel.kt","line":7}]},
           "ios":{"summary":"500 ms","evidence":[{"file":"Search/SearchViewModel.swift","line":4}]}}
        ]}
    """

    private val plan = PlanUsage(fiveHour = PlanWindow(usedPercent = 30, resetsAt = "2026-10-13T15:00:00Z"))

    private fun answer(json: String, usage: Usage = Usage(1000, 100, 0.4, plan)) = ClaudeResult(Json.parseToJsonElement(json), usage)

    private fun twinAppClaude(failIos: Boolean = false) = FakeClaudeClient { request: ClaudeRequest ->
        when (request.cwd) {
            androidRoot -> answer(androidSpec)
            iosRoot -> if (failIos) throw ClaudeRunException("Claude Code stopped the iOS description early: budget.", Usage(10, 1, 2.0, plan)) else answer(iosSpec)
            else -> answer(findings)
        }
    }

    private class Result(val exitCode: Int, val out: String, val err: String)

    private fun runWith(claude: FakeClaudeClient, vararg args: String): Result {
        val out = ByteArrayOutputStream()
        val err = ByteArrayOutputStream()
        val env = Environment(project, claude = { claude }, now = { Instant.parse("2026-10-13T08:30:00.123Z") }, zone = ZoneOffset.UTC)
        val exitCode = run(args.toList(), PrintStream(out, true), PrintStream(err, true), env)
        return Result(exitCode, out.toString(), err.toString())
    }

    @Test
    fun `compare describes both platforms, verifies, compares and writes the results`() {
        val claude = twinAppClaude()
        val result = runWith(claude, "compare", "search")

        assertEquals(0, result.exitCode, result.err)
        assertContains(result.out, "Android: 4 items, 3 verified against the source")
        assertContains(result.out, "iOS: 3 items, 3 verified against the source")
        assertContains(result.out, "Findings: 2 behavior, 1 bug, 1 equal")
        assertContains(result.out, "Report: .driftcheck/reports/search.md")
        assertContains(result.out, "Plan usage: 5-hour window 30% used, resets Tue 15:00")

        // Two read-only agents in their own roots, then one run without tools outside the project
        assertEquals(3, claude.requests.size)
        val agents = claude.requests.filter { it.options.tools.isNotEmpty() }
        assertEquals(setOf(androidRoot, iosRoot), agents.map { it.cwd }.toSet())
        assertTrue(agents.all { it.options.tools == READ_ONLY_TOOLS })
        val comparison = claude.requests.single { it.options.tools.isEmpty() }
        assertFalse(comparison.cwd.startsWith(project))
        assertFalse(comparison.cwd.exists(), "the empty work directory is removed afterwards")

        val report = project.resolve(".driftcheck/reports/search.md").readText()
        assertContains(report, "| 1 | high | Different result limits | 20 results (`app/src/main/java/org/example/search/SearchViewModel.kt:8`) | 50 results (`Search/SearchViewModel.swift:5`) |")
        assertFalse("Invented.swift" in report)
        assertContains(report, "## 🟠 Possible bugs or gaps")
        assertContains(report, "| 1 | medium | iOS does not trim the query |")
        assertContains(report, "- **Android:** 3 of 4 items verified against the source")
        assertContains(report, "**iOS sections not inspected:** storage")
        assertContains(report, "**Tokens:** 3,000 in, 300 out")
        assertContains(report, "- **Generated:** 2026-10-13 08:30 UTC by driftcheck")
        assertTrue(project.resolve(".driftcheck/specs/search/android.json").exists())
        assertContains(project.resolve(".driftcheck/findings/search.json").readText(), "\"status\": \"verified\"")
    }

    @Test
    fun `verify and report work from the stored results without Claude`() {
        assertEquals(0, runWith(twinAppClaude(), "compare", "search").exitCode)
        val reportFile = project.resolve(".driftcheck/reports/search.md")
        val original = reportFile.readText()
        val noClaude = FakeClaudeClient { error("Claude must not be called") }

        val verified = runWith(noClaude, "verify", ".driftcheck/specs/search/android.json")
        assertEquals(0, verified.exitCode, verified.err)
        assertContains(verified.out, "search (android): 3/4 items verified against the source")
        assertContains(verified.out, "  - api.timeout_ms: app/src/main/java/org/example/search/SearchViewModel.kt:40 (line_out_of_range)")

        reportFile.deleteExisting()
        val rebuilt = runWith(noClaude, "report", "search")
        assertEquals(0, rebuilt.exitCode, rebuilt.err)
        assertEquals(original, reportFile.readText())
    }

    @Test
    fun `a failed run writes nothing and reports the plan usage of both platforms`() {
        val result = runWith(twinAppClaude(failIos = true), "compare", "search")

        assertEquals(EXIT_FAILURE, result.exitCode)
        assertContains(result.err, "stopped the iOS description early")
        assertContains(result.err, "Plan usage: 5-hour window 30% used")
        assertFalse(project.resolve(".driftcheck/specs").exists())
        assertFalse(project.resolve(".driftcheck/reports").exists())
    }

    @Test
    fun `report explains how to create missing results`() {
        val result = runWith(FakeClaudeClient { error("Claude must not be called") }, "report", "search")
        assertEquals(EXIT_FAILURE, result.exitCode)
        assertContains(result.err, "Run \"driftcheck compare search\"")
    }
}
