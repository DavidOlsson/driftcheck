package driftcheck.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The fixed structure every feature description follows. Using the same sections on both platforms is what
 * makes two descriptions comparable item by item.
 */
@Serializable
enum class Section {
    @SerialName("entry_points")
    ENTRY_POINTS,

    @SerialName("input_handling")
    INPUT_HANDLING,

    @SerialName("api")
    API,

    @SerialName("localization")
    LOCALIZATION,

    @SerialName("presentation")
    PRESENTATION,

    @SerialName("storage")
    STORAGE,

    @SerialName("other")
    OTHER,

    @SerialName("constants")
    CONSTANTS,
    ;

    val id: String get() = name.lowercase()
}

@Serializable
data class Evidence(
    /** Path relative to the platform root, with forward slashes. */
    val file: String,
    /** 1-based. */
    val line: Int,
    /** A short verbatim snippet from the cited line, used to verify the claim. */
    val quote: String? = null,
)

@Serializable
data class SpecItem(
    /**
     * Stable, platform-neutral identifier such as "input_handling.debounce_ms". The same behavior must get the same
     * key on both platforms so the items can be paired.
     */
    val key: String,
    val section: Section,
    val description: String,
    /** The concrete value when there is one (a number, a limit, an endpoint), as text. */
    val value: String? = null,
    @MinItems(1)
    val evidence: List<Evidence>,
)

@Serializable
enum class CoverageStatus {
    @SerialName("covered")
    COVERED,

    @SerialName("not_found")
    NOT_FOUND,

    /** Makes gaps visible instead of looking like the platform has nothing there. */
    @SerialName("not_inspected")
    NOT_INSPECTED,
}

@Serializable
data class SectionCoverage(
    val section: Section,
    val status: CoverageStatus,
    /** Files read for this section, relative to the platform root. */
    val filesRead: List<String> = emptyList(),
    val note: String? = null,
)

/** What the agent returns for one platform. */
@Serializable
data class FeatureSpec(
    val feature: String,
    val platform: Platform,
    val summary: String,
    val items: List<SpecItem>,
    /** Things the agent looked for but did not find, so absence is explicit rather than silent. */
    val notFound: List<String> = emptyList(),
    /** One entry per section, so a report can show which parts of the feature were actually examined. */
    val coverage: List<SectionCoverage> = emptyList(),
)

private val KEY = Regex("^[a-z0-9_]+(\\.[a-z0-9_]+)*$")

/**
 * Rules the JSON schema cannot express or the model may ignore. Model output is untrusted, so a description is only
 * used when this list is empty.
 */
fun FeatureSpec.problems(): List<String> = buildList {
    if (feature.isBlank()) add("feature is empty")
    if (summary.isBlank()) add("summary is empty")
    items.forEachIndexed { i, item ->
        val where = "items[$i] (${item.key})"
        if (!KEY.matches(item.key)) add("$where: key must be lowercase dot-separated snake_case")
        if (item.description.isBlank()) add("$where: description is empty")
        if (item.evidence.isEmpty()) add("$where: needs at least one piece of evidence")
        item.evidence.forEachIndexed { j, e -> evidenceProblem(e)?.let { add("$where.evidence[$j]: $it") } }
    }
}

fun evidenceProblem(e: Evidence): String? = when {
    e.file.isBlank() -> "file is empty"
    e.line < 1 -> "line must be 1 or more, got ${e.line}"
    else -> null
}
