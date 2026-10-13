package driftcheck.process

import java.nio.file.Path
import kotlin.time.Duration

data class CommandResult(val exitCode: Int, val stdout: String, val stderr: String)

class CommandNotFoundException(val command: String) : Exception("\"$command\" was not found on PATH")

class CommandTimeoutException(val command: String, val timeout: Duration) :
    Exception("\"$command\" did not finish within $timeout and was stopped")

/**
 * Runs an external program, such as `claude`. Behind an interface so everything that runs a program can be
 * tested with a fake, without starting a process.
 */
interface CommandRunner {
    /**
     * @param timeout every run has a limit, so a program that hangs cannot block driftcheck forever.
     * @param cwd required, because for `claude` the working directory decides which files the agent can read.
     * @param env the program's whole environment. Required, so nothing inherits driftcheck's own environment
     *   (and with it an API key) by accident; for `claude` it comes from `claudeEnv`.
     * @param input written to the program's stdin, which is then closed.
     */
    fun run(
        command: String,
        args: List<String>,
        timeout: Duration,
        cwd: Path,
        env: Map<String, String>,
        input: String? = null,
    ): CommandResult
}
