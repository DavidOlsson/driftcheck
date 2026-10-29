package driftcheck.claude

import driftcheck.UserException
import driftcheck.model.PlanUsage
import driftcheck.model.PlanWindow
import driftcheck.model.Usage
import driftcheck.model.WindowStatus
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import kotlin.math.roundToInt

/** A Claude run that failed in an expected way. Carries what the run used, because a failed run counts too. */
class ClaudeRunException(message: String, val usage: Usage = Usage.NONE, cause: Throwable? = null) :
    UserException(message, cause)

data class ClaudeResult(
    /** The structured answer, still unvalidated. */
    val output: JsonElement,
    val usage: Usage,
)

private val STOP_REASONS = mapOf(
    "error_max_budget_usd" to "it reached the budget limit. Raise maxBudgetUsd in .driftcheck/config.json, or add hints for the feature so the agent finds it faster",
    "error_max_turns" to "it reached the turn limit. Add hints for the feature",
    "error_max_structured_output_retries" to "it could not produce an answer in the expected structure",
    "error_during_execution" to "an error occurred while it was running",
)

/** A missing or expired login is the most common first-run failure, so it gets a concrete next step. */
fun withLoginHint(message: String): String =
    if (Regex("401|authenticat|log ?in|oauth", RegexOption.IGNORE_CASE).containsMatchIn(message)) {
        "$message Run \"claude\" in a terminal and log in (/login), then try again."
    } else {
        message
    }

/**
 * Reads the stream-json output of `claude -p`: the final result event and the plan usage events before it.
 * [where] names the run in error messages, e.g. "the Android description".
 */
fun parseClaudeOutput(stdout: String, stderr: String, exitCode: Int, where: String): ClaudeResult {
    val events = stdout.lineSequence().mapNotNull(::parseLine).toList()
    val result = events.lastOrNull { it.string("type") == "result" }
    if (result == null) {
        val detail = stderr.ifBlank { stdout }.trim().lines().takeLast(3).joinToString(" ").take(300)
        throw ClaudeRunException(
            withLoginHint("Claude Code did not return a result for $where (exit code $exitCode)" + if (detail.isEmpty()) "." else ": $detail"),
        )
    }

    val tokens = result["usage"] as? JsonObject
    // input_tokens leaves out cached prompt tokens, which are most of an agent run's input
    val usage = Usage(
        inputTokens = listOf("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens").sumOf { tokens?.long(it) ?: 0 },
        outputTokens = tokens?.long("output_tokens") ?: 0,
        costUsd = result.double("total_cost_usd") ?: 0.0,
        plan = planUsage(events),
    )
    val subtype = result.string("subtype")
    if (subtype != "success") {
        throw ClaudeRunException("Claude Code stopped $where early: ${STOP_REASONS[subtype] ?: subtype ?: "no reason given"}.", usage)
    }
    if (result.boolean("is_error") == true) {
        throw ClaudeRunException(withLoginHint("Claude Code failed $where: ${result.string("result") ?: "unknown error"}."), usage)
    }
    val output = result["structured_output"]
    if (output == null || output is JsonNull) {
        throw ClaudeRunException("Claude Code finished $where without a structured answer.", usage)
    }
    return ClaudeResult(output, usage)
}

/** Lines that are not JSON objects, such as stray log output, are skipped. */
private fun parseLine(line: String): JsonObject? {
    if (line.isBlank()) return null
    return try {
        Json.parseToJsonElement(line) as? JsonObject
    } catch (_: SerializationException) {
        null
    }
}

/** Keeps the last reported state of the 5-hour and weekly windows. */
fun planUsage(events: List<JsonObject>): PlanUsage? {
    var fiveHour: PlanWindow? = null
    var weekly: PlanWindow? = null
    for (event in events) {
        if (event.string("type") != "rate_limit_event") continue
        val info = event["rate_limit_info"] as? JsonObject ?: continue
        val window = PlanWindow(
            status = when (info.string("status")) {
                "allowed" -> WindowStatus.ALLOWED
                "allowed_warning" -> WindowStatus.ALLOWED_WARNING
                "rejected" -> WindowStatus.REJECTED
                else -> null
            },
            usedPercent = info.double("utilization")?.let(::toPercent),
            thresholdPercent = info.double("surpassedThreshold")?.let(::toPercent),
            resetsAt = info.double("resetsAt")?.let(::toIso),
        )
        when (info.string("rateLimitType")) {
            "five_hour" -> fiveHour = fiveHour?.updatedWith(window) ?: window
            "seven_day" -> weekly = weekly?.updatedWith(window) ?: window
        }
    }
    return if (fiveHour == null && weekly == null) null else PlanUsage(fiveHour, weekly)
}

/** Claude Code reports utilization either as a fraction or as a percentage. */
private fun toPercent(value: Double): Int = (if (value <= 1) value * 100 else value).roundToInt()

/** A Unix timestamp in seconds or milliseconds. */
private fun toIso(value: Double): String {
    val millis = if (value < 1e12) value * 1000 else value
    return Instant.ofEpochMilli(millis.toLong()).toString()
}

private fun JsonObject.primitive(name: String) = this[name] as? JsonPrimitive
private fun JsonObject.string(name: String) = primitive(name)?.takeIf { it.isString }?.contentOrNull
private fun JsonObject.long(name: String) = primitive(name)?.longOrNull
private fun JsonObject.double(name: String) = primitive(name)?.doubleOrNull
private fun JsonObject.boolean(name: String) = primitive(name)?.booleanOrNull
