package driftcheck.claude

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ClaudeArgsTest {
    private val options = ClaudeOptions(
        systemPrompt = "Describe the feature.",
        jsonSchema = """{"type":"object"}""",
        model = "claude-sonnet-5-5",
        maxBudgetUsd = 1.5,
    )

    /** The value after a flag, or null when the flag is missing. */
    private fun List<String>.valueOf(flag: String): String? {
        val index = indexOf(flag)
        return if (index < 0) null else getOrNull(index + 1)
    }

    @Test
    fun `runs headless with a structured answer and the given model and budget`() {
        val args = claudeArgs(options)
        assertEquals("-p", args.first())
        assertEquals("stream-json", args.valueOf("--output-format"))
        assertContains(args, "--verbose")
        assertEquals("""{"type":"object"}""", args.valueOf("--json-schema"))
        assertEquals("Describe the feature.", args.valueOf("--system-prompt"))
        assertEquals("claude-sonnet-5-5", args.valueOf("--model"))
        assertEquals("1.5", args.valueOf("--max-budget-usd"))
    }

    @Test
    fun `locks the agent down to read-only tools without the repository's settings or MCP servers`() {
        val args = claudeArgs(options)
        assertContains(args, "--restricted")
        assertContains(args, "--safe-mode")
        assertContains(args, "--strict-mcp-config")
        assertContains(args, "--no-session-persistence")
        assertEquals("dontAsk", args.valueOf("--permission-mode"))
        assertEquals(READ_ONLY_TOOLS.joinToString(","), args.valueOf("--tools"))
        assertEquals(args.valueOf("--tools"), args.valueOf("--allowedTools"))
        val denied = args.valueOf("--disallowedTools")!!.split(",")
        for (tool in listOf("Bash", "Edit", "Write", "WebFetch", "WebSearch")) assertContains(denied, tool)
        assertTrue(READ_ONLY_TOOLS.none { it in denied })
    }

    @Test
    fun `can run with no tools at all`() {
        val args = claudeArgs(options.copy(tools = emptyList()))
        assertEquals("", args.valueOf("--tools"))
        assertFalse("--allowedTools" in args)
    }

    @Test
    fun `never puts a prompt on the command line`() {
        // -p is followed directly by the next flag; the prompt goes to stdin
        val args = claudeArgs(options)
        assertTrue(args[1].startsWith("--"))
    }

    @Test
    fun `refuses tools that are not read-only, model ids that look like flags and budgets that are not positive and finite`() {
        assertFailsWith<IllegalArgumentException> { options.copy(tools = listOf("Read", "Bash")) }
        assertFailsWith<IllegalArgumentException> { options.copy(model = "--dangerously-skip-permissions") }
        assertFailsWith<IllegalArgumentException> { options.copy(maxBudgetUsd = 0.0) }
        assertFailsWith<IllegalArgumentException> { options.copy(maxBudgetUsd = Double.POSITIVE_INFINITY) }
        assertFailsWith<IllegalArgumentException> { options.copy(maxBudgetUsd = Double.NaN) }
        // Ids with a context suffix or a provider prefix are still accepted
        options.copy(model = "claude-opus-5-5[1m]")
        options.copy(model = "us.anthropic.claude-sonnet-5-5")
    }

    @Test
    fun `removes API credentials from the environment and keeps the rest`() {
        val env = mapOf("ANTHROPIC_API_KEY" to "secret", "ANTHROPIC_AUTH_TOKEN" to "token", "PATH" to "/usr/bin", "HOME" to "/Users/me")
        assertEquals(mapOf("PATH" to "/usr/bin", "HOME" to "/Users/me"), claudeEnv(env))
    }
}
