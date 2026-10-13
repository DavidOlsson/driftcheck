package driftcheck.process

import java.nio.file.Path
import kotlin.time.Duration

/** Records every call and answers with a canned result; never starts a process. */
class FakeCommandRunner(private val respond: (Call) -> CommandResult) : CommandRunner {
    data class Call(
        val command: String,
        val args: List<String>,
        val timeout: Duration,
        val cwd: Path?,
        val input: String?,
        val env: Map<String, String>?,
    )

    val calls = mutableListOf<Call>()

    override fun run(
        command: String,
        args: List<String>,
        timeout: Duration,
        cwd: Path?,
        input: String?,
        env: Map<String, String>?,
    ): CommandResult {
        val call = Call(command, args, timeout, cwd, input, env)
        calls += call
        return respond(call)
    }
}
