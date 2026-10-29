package driftcheck.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** In report order. */
@Serializable
enum class FindingCategory {
    /** Users get different behavior on the two platforms. */
    @SerialName("behavior") BEHAVIOR,

    /** Looks like a defect or gap on one platform. */
    @SerialName("bug") BUG,

    /** Exists on one platform only. */
    @SerialName("missing") MISSING,

    /** Different presentation or interaction, same underlying behavior. */
    @SerialName("ui") UI,

    /** The platforms agree. Reported so a reader can see what was checked. */
    @SerialName("equal") EQUAL,
    ;

    val id: String get() = name.lowercase()
}

/** Most severe first. */
@Serializable
enum class Severity {
    @SerialName("high") HIGH,
    @SerialName("medium") MEDIUM,
    @SerialName("low") LOW,
    @SerialName("info") INFO,
    ;

    val id: String get() = name.lowercase()
}

@Serializable
data class PlatformSide(
    val summary: String,
    val evidence: List<Evidence>,
    /** The concrete value on this platform in a few words, such as "200 ms", so a reader sees the difference at a glance. */
    val value: String? = null,
)

/** One finding as the comparison step returns it. */
@Serializable
data class Finding(
    val category: FindingCategory,
    val severity: Severity,
    val title: String,
    /** The description item keys this finding is about. */
    val keys: List<String>,
    /** Null when the behavior does not exist on that platform. */
    val android: PlatformSide?,
    val ios: PlatformSide?,
    /** An open question for the team, e.g. whether a difference is intentional. */
    val question: String? = null,
)

/** What the comparison step returns. */
@Serializable
data class CompareOutput(val findings: List<Finding>)

@Serializable
data class VerifiedPlatformSide(val summary: String, val evidence: List<VerifiedEvidence>, val value: String? = null)

/**
 * A finding whose evidence was replaced by the matching checked evidence from the descriptions, so a report can tell
 * references that were confirmed against the source from ones that were not.
 */
@Serializable
data class VerifiedFinding(
    val feature: String,
    val category: FindingCategory,
    val severity: Severity,
    val title: String,
    val keys: List<String>,
    val android: VerifiedPlatformSide?,
    val ios: VerifiedPlatformSide?,
    val question: String? = null,
) {
    fun side(platform: Platform): VerifiedPlatformSide? = if (platform == Platform.ANDROID) android else ios

    /** The finding without its checked statuses, so it can be matched with freshly verified descriptions. */
    fun toFinding(): Finding {
        fun VerifiedPlatformSide.plain() = PlatformSide(summary, evidence.map { Evidence(it.file, it.line, it.quote) }, value)
        return Finding(category, severity, title, keys, android?.plain(), ios?.plain(), question)
    }
}

fun CompareOutput.problems(): List<String> = buildList {
    findings.forEachIndexed { i, f ->
        if (f.title.isBlank()) add("findings[$i]: title is empty")
        if (f.keys.isEmpty()) add("findings[$i]: needs at least one key")
        if (f.android == null && f.ios == null) add("findings[$i]: needs an Android or an iOS side")
    }
}
