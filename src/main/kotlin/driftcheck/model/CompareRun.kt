package driftcheck.model

import kotlinx.serialization.Serializable

/** Everything a compare run produced besides the two descriptions, so its report can be rebuilt without Claude. */
@Serializable
data class CompareRun(
    val feature: String,
    val featureName: String,
    val model: String,
    /** ISO 8601, UTC. */
    val generatedAt: String,
    val usage: Usage,
    val findings: List<VerifiedFinding>,
)
