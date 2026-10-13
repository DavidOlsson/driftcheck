package driftcheck.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class WindowStatus {
    @SerialName("allowed") ALLOWED,

    /** Close to the limit. */
    @SerialName("allowed_warning") ALLOWED_WARNING,

    /** The limit is used up. */
    @SerialName("rejected") REJECTED,
}

/** One Claude plan window, as Claude Code last reported it. */
@Serializable
data class PlanWindow(
    val status: WindowStatus? = null,
    /** 0–100. Claude Code only sends it sometimes, e.g. near a limit. */
    val usedPercent: Int? = null,
    /** The warning threshold that was passed, 0–100, when the status is a warning. */
    val thresholdPercent: Int? = null,
    /** ISO 8601, UTC. */
    val resetsAt: String? = null,
) {
    /** Fields a later report leaves out keep their earlier value. */
    fun updatedWith(later: PlanWindow) = PlanWindow(
        later.status ?: status,
        later.usedPercent ?: usedPercent,
        later.thresholdPercent ?: thresholdPercent,
        later.resetsAt ?: resetsAt,
    )
}

@Serializable
data class PlanUsage(val fiveHour: PlanWindow? = null, val weekly: PlanWindow? = null)

/**
 * What a run used. On a subscription the dollar amount is only Claude Code's estimate, so reports show the plan
 * windows instead.
 */
@Serializable
data class Usage(
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val costUsd: Double = 0.0,
    val plan: PlanUsage? = null,
) {
    operator fun plus(other: Usage) = Usage(
        inputTokens + other.inputTokens,
        outputTokens + other.outputTokens,
        costUsd + other.costUsd,
        mergePlan(plan, other.plan),
    )

    companion object {
        val NONE = Usage()
    }
}

private fun mergePlan(a: PlanUsage?, b: PlanUsage?): PlanUsage? {
    if (a == null || b == null) return a ?: b
    return PlanUsage(latest(a.fiveHour, b.fiveHour), latest(a.weekly, b.weekly))
}

/** Usage within a window only grows, so of two readings the more severe and higher one is the more recent. */
private fun latest(a: PlanWindow?, b: PlanWindow?): PlanWindow? {
    if (a == null || b == null) return a ?: b
    val severity = (b.status?.ordinal ?: -1).compareTo(a.status?.ordinal ?: -1)
    if (severity != 0) return if (severity > 0) b else a
    return if ((b.usedPercent ?: -1) >= (a.usedPercent ?: -1)) b else a
}
