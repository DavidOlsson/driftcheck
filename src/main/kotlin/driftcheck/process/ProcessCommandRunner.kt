package driftcheck.process

import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Starts programs directly, never through a shell, so prompts and arguments can never be interpreted as
 * shell syntax.
 */
class ProcessCommandRunner(
    /** How long a timed-out program gets to exit after a normal stop request before it is killed. */
    private val killGrace: Duration = 5.seconds,
    /**
     * How long to wait for stdout and stderr to close once the program has exited. A child process the program
     * left running can keep them open, which would otherwise block driftcheck forever.
     */
    private val outputGrace: Duration = 5.seconds,
) : CommandRunner {

    override fun run(
        command: String,
        args: List<String>,
        timeout: Duration,
        cwd: Path,
        env: Map<String, String>,
        input: String?,
    ): CommandResult {
        // Checked up front: the JDK reports a missing directory with the same error as a missing program
        require(Files.isDirectory(cwd)) { "The working directory $cwd does not exist or is not a directory" }
        val builder = ProcessBuilder(listOf(command) + args).directory(cwd.toFile())
        builder.environment().apply { clear(); putAll(env) }

        val process = try {
            builder.start()
        } catch (e: IOException) {
            // The JDK reports a missing program as error=2 (ENOENT) in the message
            if (e.message?.contains("error=2") == true) throw CommandNotFoundException(command)
            throw e
        }

        // stdout and stderr are read while the program runs: a program that fills a pipe nobody reads would hang
        val stdout = inBackground { process.inputStream.readText() }
        val stderr = inBackground { process.errorStream.readText() }
        inBackground {
            try {
                process.outputStream.use { stdin -> input?.let { stdin.write(it.toByteArray()) } }
            } catch (_: IOException) {
                // The program exited without reading all of its input; its exit code and stderr say why
            }
        }

        if (!process.waitFor(timeout.inWholeMilliseconds, TimeUnit.MILLISECONDS)) {
            process.destroy()
            if (!process.waitFor(killGrace.inWholeMilliseconds, TimeUnit.MILLISECONDS)) process.destroyForcibly().waitFor()
            // Best effort: what the program wrote before it was stopped is often the only clue to why it hung
            val partialStderr = runCatching { stderr.await(command) }.getOrDefault("")
            throw CommandTimeoutException(command, timeout, partialStderr)
        }
        return CommandResult(process.exitValue(), stdout.await(command), stderr.await(command))
    }

    private fun FutureTask<String>.await(command: String): String =
        try {
            get(outputGrace.inWholeMilliseconds, TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
            throw IOException("\"$command\" exited, but its output was still open after $outputGrace; a process it started may still be running")
        } catch (e: ExecutionException) {
            throw IOException("Could not read the output of \"$command\": ${e.cause?.message}", e.cause)
        }

    private fun InputStream.readText(): String = bufferedReader().use { it.readText() }

    private fun <T> inBackground(block: () -> T): FutureTask<T> =
        FutureTask(block).also { task -> Thread(task).apply { isDaemon = true }.start() }
}
