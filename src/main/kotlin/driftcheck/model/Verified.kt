package driftcheck.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The result of checking one piece of evidence against the source. */
@Serializable
enum class EvidenceStatus {
    /** The file and line exist and the quote was found near the line. */
    @SerialName("verified")
    VERIFIED,

    /** The file and line exist, but there was no quote to check. */
    @SerialName("line_exists")
    LINE_EXISTS,

    @SerialName("quote_not_found")
    QUOTE_NOT_FOUND,

    @SerialName("line_out_of_range")
    LINE_OUT_OF_RANGE,

    /** Missing, or outside the platform root. */
    @SerialName("file_not_found")
    FILE_NOT_FOUND,
    ;

    val id: String get() = name.lowercase()
}

@Serializable
data class VerifiedEvidence(val file: String, val line: Int, val quote: String? = null, val status: EvidenceStatus) {
    /** Where it points, used to match a finding's citation with the checked one. */
    val location: String get() = "$file:$line"
}

@Serializable
data class VerifiedSpecItem(
    val key: String,
    val section: Section,
    val description: String,
    val value: String? = null,
    val evidence: List<VerifiedEvidence>,
    /** True when at least one piece of evidence was verified against the source. */
    val verified: Boolean,
)

/** A [FeatureSpec] after verification; this is what is stored and compared. */
@Serializable
data class VerifiedFeatureSpec(
    val feature: String,
    val platform: Platform,
    val summary: String,
    val items: List<VerifiedSpecItem>,
    val notFound: List<String> = emptyList(),
    val coverage: List<SectionCoverage> = emptyList(),
) {
    fun toSpec(): FeatureSpec = FeatureSpec(
        feature,
        platform,
        summary,
        items.map { item ->
            SpecItem(item.key, item.section, item.description, item.value, item.evidence.map { Evidence(it.file, it.line, it.quote) })
        },
        notFound,
        coverage,
    )
}
