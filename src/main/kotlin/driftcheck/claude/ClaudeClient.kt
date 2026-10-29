package driftcheck.claude

import driftcheck.model.Usage
import driftcheck.model.jsonSchemaOf
import driftcheck.model.modelJson
import driftcheck.process.CommandNotFoundException
import driftcheck.process.CommandRunner
import driftcheck.process.CommandTimeoutException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import java.nio.file.Path
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

const val CLAUDE_COMMAND = "claude"

/** An agent run reads a lot of code; a healthy one finishes well within this. */
val AGENT_TIMEOUT = 30.minutes

/** A single run without tools. */
val TOOLLESS_TIMEOUT = 10.minutes

data class ClaudeRequest(
    val options: ClaudeOptions,
    /** Written to stdin, never put on the command line. */
    val prompt: String,
    /** For an agent with tools, the platform's source root: it decides what the agent can read. */
    val cwd: Path,
    val timeout: Duration,
    /** Names the run in error messages, e.g. "the Android description". */
    val where: String,
)

/** The one way driftcheck reaches Claude. Behind an interface so everything above it is tested with fakes. */
fun interface ClaudeClient {
    fun run(request: ClaudeRequest): ClaudeResult
}

/** Runs the user's own installed and logged-in Claude Code. */
class CliClaudeClient(
    private val runner: CommandRunner,
    /** driftcheck's environment; [claudeEnv] removes what must not reach claude. */
    private val env: Map<String, String>,
) : ClaudeClient {
    override fun run(request: ClaudeRequest): ClaudeResult {
        val result = try {
            runner.run(CLAUDE_COMMAND, claudeArgs(request.options), request.timeout, request.cwd, claudeEnv(env), request.prompt)
        } catch (e: CommandNotFoundException) {
            throw ClaudeRunException(
                "Claude Code (\"$CLAUDE_COMMAND\") was not found on PATH. Install it from https://claude.com/claude-code, " +
                    "log in, and try again.",
                cause = e,
            )
        } catch (e: CommandTimeoutException) {
            throw ClaudeRunException(
                "Claude Code did not finish ${request.where} within ${request.timeout} and was stopped. " +
                    "Try again, or add hints for the feature so the agent finds it faster.",
                cause = e,
            )
        }
        return parseClaudeOutput(result.stdout, result.stderr, result.exitCode, request.where)
    }
}

/** A run whose answer must have the structure of [serializer]. */
data class StructuredTask<T>(
    val serializer: KSerializer<T>,
    val systemPrompt: String,
    val prompt: String,
    val tools: List<String>,
    val cwd: Path,
    val timeout: Duration,
    val where: String,
    /** Rules the schema cannot express; the answer is only used when this returns nothing. */
    val problems: (T) -> List<String> = { emptyList() },
)

data class Structured<T>(val output: T, val usage: Usage)

/**
 * Runs [task] with a JSON schema generated from its serializer and validates the answer. Model output is untrusted,
 * so it is parsed and checked before anything uses it. A refused answer still reports its usage, because it counts.
 */
fun <T> ClaudeClient.runStructured(task: StructuredTask<T>, model: String, maxBudgetUsd: Double): Structured<T> {
    val options = ClaudeOptions(
        systemPrompt = task.systemPrompt,
        jsonSchema = jsonSchemaOf(task.serializer).toString(),
        model = model,
        maxBudgetUsd = maxBudgetUsd,
        tools = task.tools,
    )
    val result = run(ClaudeRequest(options, task.prompt, task.cwd, task.timeout, task.where))
    val output = try {
        modelJson.decodeFromJsonElement(task.serializer, result.output)
    } catch (e: SerializationException) {
        throw ClaudeRunException("The answer for ${task.where} does not have the expected structure: ${e.message}", result.usage, e)
    } catch (e: IllegalArgumentException) {
        throw ClaudeRunException("The answer for ${task.where} does not have the expected structure: ${e.message}", result.usage, e)
    }
    val problems = task.problems(output)
    if (problems.isNotEmpty()) {
        throw ClaudeRunException(
            "The answer for ${task.where} breaks ${problems.size} rule(s): ${problems.take(5).joinToString("; ")}",
            result.usage,
        )
    }
    return Structured(output, result.usage)
}
