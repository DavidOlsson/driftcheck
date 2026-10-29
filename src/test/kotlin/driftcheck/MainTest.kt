package driftcheck

import driftcheck.claude.FakeClaudeClient
import driftcheck.config.CONFIG_TEMPLATE
import java.io.ByteArrayOutputStream
import java.io.PrintStream
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.fail

class MainTest {
    private class Result(val exitCode: Int, val out: String, val err: String)

    private val project: Path = Files.createTempDirectory("driftcheck-main")
    private val env = Environment(project, claude = { FakeClaudeClient { fail("Claude must not be called") } })

    private fun runWith(vararg args: String): Result {
        val out = ByteArrayOutputStream()
        val err = ByteArrayOutputStream()
        val exitCode = run(args.toList(), PrintStream(out, true), PrintStream(err, true), env)
        return Result(exitCode, out.toString(), err.toString())
    }

    @Test
    fun `prints the version from the build`() {
        val result = runWith("--version")
        assertEquals(0, result.exitCode)
        assertEquals("0.1.0", result.out.trim())
    }

    @Test
    fun `prints usage for --help and when run without arguments`() {
        for (args in listOf(arrayOf("--help"), arrayOf("-h"), emptyArray(), arrayOf("compare", "--help"))) {
            val result = runWith(*args)
            assertEquals(0, result.exitCode)
            assertContains(result.out, "Usage: driftcheck [options] <command>")
            assertContains(result.out, "compare <feature>")
        }
    }

    @Test
    fun `rejects unknown commands, options and missing operands with a usage error`() {
        val unknown = runWith("frobnicate")
        assertEquals(EXIT_USAGE, unknown.exitCode)
        assertContains(unknown.err, "unknown command \"frobnicate\"")

        assertContains(runWith("--colour").err, "unknown option \"--colour\"")
        assertContains(runWith("compare").err, "compare expects one feature, got 0")
        assertContains(runWith("compare", "a", "b").err, "got 2")
        assertContains(runWith("compare", "search", "--model").err, "--model needs a value")
        assertEquals(EXIT_USAGE, runWith("init", "extra").exitCode)
    }

    @Test
    fun `init creates the config once, and overwrites it only with --force`() {
        val created = runWith("init")
        assertEquals(0, created.exitCode)
        assertContains(created.out, "Created .driftcheck/config.json")
        assertEquals(CONFIG_TEMPLATE, project.resolve(".driftcheck/config.json").readText())

        val again = runWith("init")
        assertEquals(EXIT_FAILURE, again.exitCode)
        assertContains(again.err, "--force")
        assertEquals(0, runWith("init", "--force").exitCode)
    }

    @Test
    fun `explains a missing config`() {
        val result = runWith("compare", "search")
        assertEquals(EXIT_FAILURE, result.exitCode)
        assertContains(result.err, "driftcheck init")
    }

    @Test
    fun `uses another project root with -C`() {
        Files.createDirectories(project.resolve("app"))
        assertEquals(0, runWith("-C", "app", "init").exitCode)
        assertEquals(CONFIG_TEMPLATE, project.resolve("app/.driftcheck/config.json").readText())
    }

    @Test
    fun `shows control characters from untrusted text as question marks`() {
        assertEquals("a?[2Jb\nc\td", terminalSafe("a\u001b[2Jb\nc\td"))
    }
}
