package driftcheck.stability

import driftcheck.model.CompareRun
import driftcheck.model.FindingCategory
import driftcheck.model.Platform
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedFinding
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path
import kotlin.math.roundToInt

/**
 * A development tool, not part of driftcheck: measures how much two runs on the same code agree, so a change meant to
 * make reports more stable is judged by numbers. Run it on two saved `.driftcheck/` folders, such as the results
 * artifacts of the report workflow.
 */
data class RunResults(val specs: Map<Platform, VerifiedFeatureSpec>, val findings: List<VerifiedFinding>)

data class Share(val same: Int, val total: Int) {
    override fun toString() = if (total == 0) "0 of 0" else "$same of $total (${(100.0 * same / total).roundToInt()} %)"
}

data class RunShape(
    /** Keys both platforms use in this run: without them, the comparison has to guess which items belong together. */
    val sharedKeys: Share,
    val differences: Int,
    /** Differences that cover more than one key, i.e. several behaviors bundled into one finding. */
    val bundled: Int,
)

data class Stability(
    val a: RunShape,
    val b: RunShape,
    /** Per platform, the keys both runs gave an item. */
    val sameKeys: Map<Platform, Share>,
    /** Differences in A that B also reports, matched by a shared key. */
    val matchedDifferences: Share,
    val sameCategory: Share,
    val sameSeverity: Share,
)

// Older runs may lack newer fields, and newer runs may have fields this tool does not know; neither should stop it
private val json = Json { ignoreUnknownKeys = true }

private fun <T> read(file: Path, serializer: KSerializer<T>): T = json.decodeFromString(serializer, Files.readString(file))

/** [dir] is a `.driftcheck/` folder or a results artifact with the same layout. */
fun loadResults(dir: Path, feature: String): RunResults = RunResults(
    specs = Platform.entries.associateWith { read(dir.resolve("specs/$feature/${it.id}.json"), VerifiedFeatureSpec.serializer()) },
    findings = read(dir.resolve("findings/$feature.json"), CompareRun.serializer()).findings,
)

private fun differences(run: RunResults) = run.findings.filter { it.category != FindingCategory.EQUAL }

private fun shape(run: RunResults): RunShape {
    val keys = run.specs.mapValues { (_, spec) -> spec.items.map { it.key }.toSet() }
    val android = keys.getValue(Platform.ANDROID)
    val ios = keys.getValue(Platform.IOS)
    val differences = differences(run)
    return RunShape(Share((android intersect ios).size, (android union ios).size), differences.size, differences.count { it.keys.size > 1 })
}

fun stability(a: RunResults, b: RunResults): Stability {
    val sameKeys = Platform.entries.associateWith { platform ->
        val inA = a.specs.getValue(platform).items.map { it.key }.toSet()
        val inB = b.specs.getValue(platform).items.map { it.key }.toSet()
        Share((inA intersect inB).size, (inA union inB).size)
    }
    val inB = differences(b)
    val matches = differences(a).mapNotNull { finding -> inB.firstOrNull { it.keys.any(finding.keys::contains) }?.let { finding to it } }
    return Stability(
        a = shape(a),
        b = shape(b),
        sameKeys = sameKeys,
        matchedDifferences = Share(matches.size, differences(a).size),
        sameCategory = Share(matches.count { (x, y) -> x.category == y.category }, matches.size),
        sameSeverity = Share(matches.count { (x, y) -> x.severity == y.severity }, matches.size),
    )
}

fun format(s: Stability): String = buildString {
    appendLine("Within each run                      A                    B")
    appendLine("  keys shared by Android and iOS     ${s.a.sharedKeys.toString().padEnd(20)} ${s.b.sharedKeys}")
    appendLine("  differences                        ${s.a.differences.toString().padEnd(20)} ${s.b.differences}")
    appendLine("  bundled (more than one key)        ${s.a.bundled.toString().padEnd(20)} ${s.b.bundled}")
    appendLine("Between the runs")
    for ((platform, share) in s.sameKeys) appendLine("  same ${platform.displayName} keys".padEnd(37) + share)
    appendLine("  differences in A also in B         ${s.matchedDifferences}")
    appendLine("  of those, same category            ${s.sameCategory}")
    append("  of those, same severity            ${s.sameSeverity}")
}

/** `./gradlew stability -Pa=<dir> -Pb=<dir> [-Pfeature=search]` */
fun main(args: Array<String>) {
    require(args.size in 2..3 && args.take(2).all { it.isNotBlank() }) {
        "Usage: ./gradlew stability -Pa=<results folder> -Pb=<results folder> [-Pfeature=search]"
    }
    val feature = args.getOrNull(2)?.ifBlank { null } ?: "search"
    println(format(stability(loadResults(Path.of(args[0]), feature), loadResults(Path.of(args[1]), feature))))
}
