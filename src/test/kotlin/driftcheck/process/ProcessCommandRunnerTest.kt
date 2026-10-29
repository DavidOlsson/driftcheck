package driftcheck.process

import java.io.IOException
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.measureTime

// These start real, harmless programs (cat, sh, sleep), so they run on macOS and Linux
class ProcessCommandRunnerTest {
    private val runner = ProcessCommandRunner(killGrace = 1.seconds, outputGrace = 1.seconds)
    private val dir = Files.createTempDirectory("driftcheck-cwd").toRealPath()
    private val env = System.getenv()

    @Test
    fun `writes the input to stdin and returns stdout`() {
        val result = runner.run("cat", emptyList(), timeout = 10.seconds, cwd = dir, env = env, input = "hello\nworld")
        assertEquals(CommandResult(0, "hello\nworld", ""), result)
    }

    @Test
    fun `returns the exit code and stderr of a failing program`() {
        val result = runner.run("sh", listOf("-c", "echo oops >&2; exit 3"), timeout = 10.seconds, cwd = dir, env = env)
        assertEquals(3, result.exitCode)
        assertEquals("oops\n", result.stderr)
    }

    @Test
    fun `passes arguments as-is, without a shell`() {
        val result = runner.run("echo", listOf("\$HOME; rm -rf x", "*"), timeout = 10.seconds, cwd = dir, env = env)
        assertEquals("\$HOME; rm -rf x *\n", result.stdout)
    }

    @Test
    fun `runs in the given directory with exactly the given environment`() {
        val result = runner.run(
            "sh",
            listOf("-c", "pwd; echo \"[\$ONLY]\" \"[\$HOME]\""),
            timeout = 10.seconds,
            cwd = dir,
            env = mapOf("ONLY" to "this"),
        )
        assertEquals("$dir\n[this] []\n", result.stdout)
    }

    @Test
    fun `does not hang on large output`() {
        val result = runner.run("sh", listOf("-c", "yes driftcheck | head -n 200000"), timeout = 10.seconds, cwd = dir, env = env)
        assertEquals(200_000, result.stdout.lines().count { it == "driftcheck" })
    }

    @Test
    fun `stops a program that runs past its timeout`() {
        val elapsed = measureTime {
            val error =
                assertFailsWith<CommandTimeoutException> {
                    runner.run("sleep", listOf("30"), timeout = 200.milliseconds, cwd = dir, env = env)
                }
            assertContains(error.message!!, "did not finish within 200ms")
        }
        assertFalse(elapsed > 5.seconds, "the program was not stopped in time: $elapsed")
    }

    @Test
    fun `stops the processes a timed-out program started, too`() {
        // Like claude starting ripgrep for Grep: the shell starts a child and waits for it
        val pidFile = dir.resolve("child.pid")
        assertFailsWith<CommandTimeoutException> {
            runner.run("sh", listOf("-c", "sleep 30 & echo \$! > child.pid; wait"), timeout = 500.milliseconds, cwd = dir, env = env)
        }
        val child = ProcessHandle.of(Files.readString(pidFile).trim().toLong())
        try {
            // A process that was stopped can take a moment to disappear
            val gone = (1..20).any {
                child.map { !it.isAlive }.orElse(true) || run {
                    Thread.sleep(100)
                    false
                }
            }
            assertTrue(gone, "the child process was left running after the timeout")
        } finally {
            child.ifPresent { it.destroyForcibly() }
        }
    }

    @Test
    fun `includes what a timed-out program wrote to stderr`() {
        // exec, so the stop request reaches sleep itself and nothing is left holding stderr open
        val error = assertFailsWith<CommandTimeoutException> {
            runner.run("sh", listOf("-c", "echo stuck here >&2; exec sleep 30"), timeout = 500.milliseconds, cwd = dir, env = env)
        }
        assertEquals("stuck here\n", error.stderr)
        assertContains(error.message!!, "stuck here")
    }

    @Test
    fun `does not wait forever for output a leftover child process keeps open`() {
        // The short sleep makes sure the reader is already blocked when sh exits. Otherwise the JDK drains and
        // closes the pipe on exit by itself, and the case this test is about does not happen.
        val elapsed = measureTime {
            val error =
                assertFailsWith<IOException> {
                    runner.run("sh", listOf("-c", "sleep 5 & sleep 0.5"), timeout = 10.seconds, cwd = dir, env = env)
                }
            assertContains(error.message!!, "output was still open")
        }
        assertFalse(elapsed > 4.seconds, "waited too long for the output: $elapsed")
    }

    @Test
    fun `reports a missing working directory as such, not as a missing program`() {
        val error =
            assertFailsWith<IllegalArgumentException> {
                runner.run("cat", emptyList(), timeout = 10.seconds, cwd = dir.resolve("missing"), env = env)
            }
        assertContains(error.message!!, "working directory")
    }

    @Test
    fun `survives a program that exits without reading its input`() {
        val result = runner.run("true", emptyList(), timeout = 10.seconds, cwd = dir, env = env, input = "x".repeat(1_000_000))
        assertEquals(0, result.exitCode)
    }

    @Test
    fun `reports a missing program clearly`() {
        val error =
            assertFailsWith<CommandNotFoundException> {
                runner.run("driftcheck-no-such-program", emptyList(), timeout = 10.seconds, cwd = dir, env = env)
            }
        assertEquals("\"driftcheck-no-such-program\" was not found on PATH", error.message)
    }
}
