package driftcheck

import java.io.ByteArrayOutputStream
import java.io.PrintStream
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals

class MainTest {
    private class Result(val exitCode: Int, val out: String, val err: String)

    private fun runWith(vararg args: String): Result {
        val out = ByteArrayOutputStream()
        val err = ByteArrayOutputStream()
        val exitCode = run(args.toList(), PrintStream(out, true), PrintStream(err, true))
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
        for (args in listOf(arrayOf("--help"), arrayOf("-h"), emptyArray())) {
            val result = runWith(*args)
            assertEquals(0, result.exitCode)
            assertContains(result.out, "Usage: driftcheck [--help | --version]")
        }
    }

    @Test
    fun `rejects unknown arguments with a usage error`() {
        val unknown = runWith("compare")
        assertEquals(EXIT_USAGE, unknown.exitCode)
        assertContains(unknown.err, "unknown argument \"compare\"")

        val tooMany = runWith("--version", "--help")
        assertEquals(EXIT_USAGE, tooMany.exitCode)
        assertContains(tooMany.err, "at most one argument")
    }
}
