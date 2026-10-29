package driftcheck.claude

import driftcheck.model.PlanUsage
import driftcheck.model.PlanWindow
import driftcheck.model.Usage
import driftcheck.model.WindowStatus
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull

class ClaudeOutputTest {
    private val usageJson =
        """"usage":{"input_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":50},"total_cost_usd":0.25"""

    private fun result(fields: String) = """{"type":"result",$fields,$usageJson}"""

    private val success = result(""""subtype":"success","is_error":false,"structured_output":{"answer":42}""")

    @Test
    fun `returns the structured answer and the usage, counting cached input tokens`() {
        val stdout = listOf("""{"type":"system","subtype":"init"}""", "not json, e.g. a log line", "", success).joinToString("\n")
        val parsed = parseClaudeOutput(stdout, "", 0, "the test run")
        assertEquals(JsonObject(mapOf("answer" to JsonPrimitive(42))), parsed.output)
        assertEquals(Usage(inputTokens = 1110, outputTokens = 50, costUsd = 0.25), parsed.usage)
    }

    @Test
    fun `keeps the last state of the plan windows, filling in fields later events leave out`() {
        val events = listOf(
            """{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour","utilization":0.42,"resetsAt":1760000000}}""",
            """{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","rateLimitType":"five_hour","surpassedThreshold":75}}""",
            """{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"seven_day","utilization":0.12,"resetsAt":1760000000000}}""",
            success,
        )
        val plan = parseClaudeOutput(events.joinToString("\n"), "", 0, "the test run").usage.plan!!
        assertEquals(PlanWindow(WindowStatus.ALLOWED_WARNING, 42, 75, "2025-10-09T08:53:20Z"), plan.fiveHour)
        assertEquals(PlanWindow(WindowStatus.ALLOWED, 12, null, "2025-10-09T08:53:20Z"), plan.weekly)
    }

    @Test
    fun `reads utilization as a fraction, also when usage runs past the cap`() {
        fun used(utilization: String) = parseClaudeOutput(
            """{"type":"rate_limit_event","rate_limit_info":{"rateLimitType":"five_hour","utilization":$utilization}}""" + "\n" + success,
            "",
            0,
            "x",
        ).usage.plan!!.fiveHour!!.usedPercent
        assertEquals(1, used("0.01"))
        assertEquals(100, used("1"))
        assertEquals(120, used("1.2"))
    }

    @Test
    fun `reports no plan usage when Claude Code sends none`() {
        assertNull(parseClaudeOutput(success, "", 0, "the test run").usage.plan)
    }

    @Test
    fun `explains a run that hit its budget and keeps what it used`() {
        val error = assertFailsWith<ClaudeRunException> {
            parseClaudeOutput(result(""""subtype":"error_max_budget_usd","is_error":true"""), "", 1, "the Android description")
        }
        assertContains(error.message!!, "stopped the Android description early")
        assertContains(error.message!!, "Raise maxBudgetUsd")
        assertEquals(0.25, error.usage.costUsd)
    }

    @Test
    fun `adds a login hint to authentication errors`() {
        val error = assertFailsWith<ClaudeRunException> {
            parseClaudeOutput(result(""""subtype":"success","is_error":true,"result":"Invalid API key · Please run /login""""), "", 1, "x")
        }
        assertContains(error.message!!, "log in (/login)")

        val noResult = assertFailsWith<ClaudeRunException> { parseClaudeOutput("", "Error: 401 Unauthorized\n", 1, "x") }
        assertContains(noResult.message!!, "exit code 1")
        assertContains(noResult.message!!, "401 Unauthorized")
        assertContains(noResult.message!!, "/login")
    }

    @Test
    fun `tells a token login to renew the token instead of logging in`() {
        // The message seen in CI when CLAUDE_CODE_OAUTH_TOKEN was wrong
        val error = assertFailsWith<ClaudeRunException> {
            parseClaudeOutput(
                result(""""subtype":"success","is_error":true,"result":"Failed to authenticate. API Error: 401 Invalid bearer token""""),
                "",
                1,
                "x",
                tokenLogin = true,
            )
        }
        assertContains(error.message!!, "claude setup-token")
        assertFalse("log in (/login)" in error.message!!)
    }

    @Test
    fun `adds no login hint to unrelated text`() {
        for (unrelated in listOf("Read 4013 files", "Open the catalog in Settings", "see blog in docs")) {
            assertEquals(unrelated, withLoginHint(unrelated, tokenLogin = false))
        }
    }

    @Test
    fun `keeps Claude's own words when it stops early`() {
        val error = assertFailsWith<ClaudeRunException> {
            parseClaudeOutput(result(""""subtype":"error_during_execution","errors":["Tool Grep crashed","exit 2"]"""), "", 1, "x")
        }
        assertContains(error.message!!, "an error occurred while it was running. Claude Code said: Tool Grep crashed; exit 2")
    }

    @Test
    fun `refuses a successful run without a structured answer`() {
        assertFailsWith<ClaudeRunException> { parseClaudeOutput(result(""""subtype":"success","result":"Done!""""), "", 0, "x") }
        assertFailsWith<ClaudeRunException> { parseClaudeOutput(result(""""subtype":"success","structured_output":null"""), "", 0, "x") }
    }

    @Test
    fun `adds usage and keeps the most recent plan reading`() {
        val earlier = Usage(1, 2, 0.5, PlanUsage(fiveHour = PlanWindow(WindowStatus.ALLOWED, 40)))
        val later = Usage(10, 20, 1.0, PlanUsage(fiveHour = PlanWindow(WindowStatus.ALLOWED, 55)))
        val total = earlier + later
        assertEquals(11, total.inputTokens)
        assertEquals(22, total.outputTokens)
        assertEquals(1.5, total.costUsd)
        assertEquals(55, total.plan!!.fiveHour!!.usedPercent)
        assertEquals(earlier, earlier + Usage.NONE)
    }
}
