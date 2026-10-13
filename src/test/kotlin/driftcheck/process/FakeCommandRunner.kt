package driftcheck.process

import java.nio.file.Path
import kotlin.time.Duration

/** Records every call and answers with a canned result; never starts a process. */
class FakeCommandRunner(private val respond: (Call) -> CommandResult) : CommandRunner {
    data class Call(
        val command: String,
        val args: List<String>,
        val timeout: Duration,
        val cwd: Path,
        val env: Map<String, String>,
        val input: String?,
    )

    val calls = mutableListOf<Call>()

    override fun run(
        command: String,
        args: List<String>,
        timeout: Duration,
        cwd: Path,
        env: Map<String, String>,
        input: String?,
    ): CommandResult {
        val call = Call(command, args, timeout, cwd, env, input)
        calls += call
        return respond(call)
    }
}
