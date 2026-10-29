package driftcheck.claude

import driftcheck.model.CompareOutput
import driftcheck.model.problems
import driftcheck.process.CommandNotFoundException
import driftcheck.process.CommandResult
import driftcheck.process.CommandTimeoutException
import driftcheck.process.FakeCommandRunner
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.time.Duration.Companion.minutes

class ClaudeClientTest {
    private val cwd = Path.of("/work/android")

    private fun answer(output: String) = CommandResult(
        0,
        """{"type":"result","subtype":"success","structured_output":$output,"total_cost_usd":0.1}""",
        "",
    )

    private val task = StructuredTask(
        serializer = CompareOutput.serializer(),
        systemPrompt = "Compare.",
        prompt = "The descriptions",
        tools = emptyList(),
        cwd = cwd,
        timeout = 5.minutes,
        where = "the comparison",
        problems = { it.problems() },
    )

    @Test
    fun `runs claude in the given directory with the prompt on stdin, a generated schema and a clean environment`() {
        val runner = FakeCommandRunner { answer("""{"findings":[]}""") }
        val client = CliClaudeClient(runner, mapOf("ANTHROPIC_API_KEY" to "secret", "PATH" to "/usr/bin"))

        val result = client.runStructured(task, "claude-sonnet-5-5", 1.0)

        assertEquals(CompareOutput(emptyList()), result.output)
        assertEquals(0.1, result.usage.costUsd)
        val call = runner.calls.single()
        assertEquals(CLAUDE_COMMAND, call.command)
        assertEquals(cwd, call.cwd)
        assertEquals(5.minutes, call.timeout)
        assertEquals("The descriptions", call.input)
        assertEquals(mapOf("PATH" to "/usr/bin"), call.env)
        assertContains(call.args[call.args.indexOf("--json-schema") + 1], "\"findings\"")
        assertFalse("The descriptions" in call.args)
    }

    @Test
    fun `refuses answers with the wrong structure or broken rules, keeping the usage`() {
        val wrong = CliClaudeClient(FakeCommandRunner { answer("""{"findings":"none"}""") }, emptyMap())
        assertEquals(0.1, assertFailsWith<ClaudeRunException> { wrong.runStructured(task, "m", 1.0) }.usage.costUsd)

        val broken = CliClaudeClient(
            FakeCommandRunner {
                answer("""{"findings":[{"category":"bug","severity":"low","title":"","keys":["a"],"android":null,"ios":null}]}""")
            },
            emptyMap(),
        )
        val error = assertFailsWith<ClaudeRunException> { broken.runStructured(task, "m", 1.0) }
        assertContains(error.message!!, "title is empty")
    }

    @Test
    fun `explains a missing claude command and a timeout`() {
        val missing = CliClaudeClient(FakeCommandRunner { throw CommandNotFoundException("claude") }, emptyMap())
        assertContains(assertFailsWith<ClaudeRunException> { missing.runStructured(task, "m", 1.0) }.message!!, "Install it")

        val slow = CliClaudeClient(FakeCommandRunner { throw CommandTimeoutException("claude", 5.minutes) }, emptyMap())
        assertContains(assertFailsWith<ClaudeRunException> { slow.runStructured(task, "m", 1.0) }.message!!, "within 5m")
    }

    @Test
    fun `gives token advice when claude logged in with CLAUDE_CODE_OAUTH_TOKEN`() {
        val rejected = CommandResult(1, """{"type":"result","subtype":"success","is_error":true,"result":"401 Invalid bearer token"}""", "")
        val withToken = CliClaudeClient(FakeCommandRunner { rejected }, mapOf(TOKEN_VARIABLE to "token"))
        assertContains(assertFailsWith<ClaudeRunException> { withToken.runStructured(task, "m", 1.0) }.message!!, "claude setup-token")
        val interactive = CliClaudeClient(FakeCommandRunner { rejected }, emptyMap())
        assertContains(assertFailsWith<ClaudeRunException> { interactive.runStructured(task, "m", 1.0) }.message!!, "log in (/login)")
    }
}
