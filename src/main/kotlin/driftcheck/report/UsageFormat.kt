package driftcheck.report

import driftcheck.model.PlanWindow
import driftcheck.model.Usage
import driftcheck.model.WindowStatus
import java.util.Locale

fun tokenCounts(usage: Usage): String = String.format(Locale.ENGLISH, "%,d in, %,d out", usage.inputTokens, usage.outputTokens)

/** Reports must not depend on the machine's time zone. */
fun formatUtc(iso: String): String = if (iso.length >= 16) "${iso.substring(0, 10)} ${iso.substring(11, 16)} UTC" else iso

private fun windowState(window: PlanWindow): String {
    val used = window.usedPercent?.let { "$it% used" }
    return when (window.status) {
        WindowStatus.REJECTED -> "limit reached"

        WindowStatus.ALLOWED_WARNING -> {
            val over = window.thresholdPercent?.let { "over $it% used" } ?: used
            "approaching limit" + (over?.let { " ($it)" } ?: "")
        }

        else -> used ?: "OK"
    }
}

private fun formatWindow(name: String, window: PlanWindow?, formatTime: (String) -> String): String? =
    window?.let { "$name ${windowState(it)}" + (it.resetsAt?.let { at -> ", resets ${formatTime(at)}" } ?: "") }

/**
 * Runs count toward the user's Claude plan rather than being billed per token, so the plan's 5-hour and weekly
 * windows are shown instead of Claude Code's dollar estimate.
 */
fun planUsageLabel(usage: Usage, formatTime: (String) -> String = ::formatUtc): String {
    val windows = listOfNotNull(
        formatWindow("5-hour window", usage.plan?.fiveHour, formatTime),
        formatWindow("weekly limit", usage.plan?.weekly, formatTime),
    )
    return if (windows.isEmpty()) "not reported by Claude Code for this run" else windows.joinToString(" · ")
}
