package driftcheck.stability

import driftcheck.model.CompareRun
import driftcheck.model.FindingCategory
import driftcheck.model.Platform
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedFinding
import driftcheck.model.modelJson
import kotlinx.serialization.KSerializer
import java.nio.file.Files
import java.nio.file.Path
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * A development tool, not part of driftcheck: measures how much two runs on the same code agree, so a change meant to
 * make reports more stable is judged by numbers. Run it on two saved `.driftcheck/` folders, such as the results
 * artifacts of the report workflow.
 *
 * Agreement alone can hide a report that misses the same thing every time. To measure recall, pass a run from before
 * the change as B: "B's differences also in A" is then how much of what was found before A still finds.
 */
data class RunResults(val specs: Map<Platform, VerifiedFeatureSpec>, val findings: List<VerifiedFinding>)

data class Share(val same: Int, val total: Int) {
    override fun toString() = if (total == 0) "0 of 0" else "$same of $total (${(100.0 * same / total).roundToInt()} %)"
}

data class RunShape(
    val items: Map<Platform, Int>,
    /**
     * Keys only this platform has. When one platform is described with the other's keys, a sharp drop here, or in
     * [filesCited], is a sign that it only looked for what the other platform has.
     */
    val ownKeys: Map<Platform, Int>,
    val filesCited: Map<Platform, Int>,
    /** Keys both platforms use in this run: without them, the comparison has to guess which items belong together. */
    val sharedKeys: Share,
    val differences: Int,
    val missing: Int,
    /**
     * Differences with more than one key from the same platform, i.e. several behaviors bundled into one finding. One key
     * per platform is the same behavior named differently, which the comparison may do.
     */
    val bundled: Int,
)

data class Stability(
    val a: RunShape,
    val b: RunShape,
    /** Per platform, the keys both runs gave an item. */
    val sameKeys: Map<Platform, Share>,
    /** Differences in A that B also reports, by [sameDifference]. */
    val aFoundInB: Share,
    /** Differences in B that A also reports: A's recall when B is a reference run. */
    val bFoundInA: Share,
    /** Among A's differences also in B. */
    val sameCategory: Share,
    val sameSeverity: Share,
)

/** Two runs cite the same code at slightly different lines, so this many lines apart still counts as the same place. */
const val SAME_PLACE_LINES = 10

private data class Place(val platform: Platform, val file: String, val line: Int)

private fun places(finding: VerifiedFinding) =
    Platform.entries.flatMap { platform -> finding.side(platform)?.evidence.orEmpty().map { Place(platform, it.file, it.line) } }

/** A shared key, or evidence at the same place: keys are invented anew in every run, the cited code much less so. */
fun sameDifference(x: VerifiedFinding, y: VerifiedFinding): Boolean = x.keys.any(y.keys::contains) ||
    places(x).any { p -> places(y).any { it.platform == p.platform && it.file == p.file && abs(it.line - p.line) <= SAME_PLACE_LINES } }

private fun <T> read(file: Path, serializer: KSerializer<T>): T = modelJson.decodeFromString(serializer, Files.readString(file))

/** [dir] is a `.driftcheck/` folder or a results artifact with the same layout. */
fun loadResults(dir: Path, feature: String): RunResults = RunResults(
    specs = Platform.entries.associateWith { read(dir.resolve("specs/$feature/${it.id}.json"), VerifiedFeatureSpec.serializer()) },
    findings = read(dir.resolve("findings/$feature.json"), CompareRun.serializer()).findings,
)

private fun differences(run: RunResults) = run.findings.filter { it.category != FindingCategory.EQUAL }

private fun keys(run: RunResults, platform: Platform) = run.specs.getValue(platform).items.map { it.key }.toSet()

private fun shape(run: RunResults): RunShape {
    val android = keys(run, Platform.ANDROID)
    val ios = keys(run, Platform.IOS)
    val differences = differences(run)
    return RunShape(
        items = run.specs.mapValues { (_, spec) -> spec.items.size },
        ownKeys = mapOf(Platform.ANDROID to (android - ios).size, Platform.IOS to (ios - android).size),
        filesCited = run.specs.mapValues { (_, spec) -> spec.items.flatMap { item -> item.evidence.map { it.file } }.toSet().size },
        sharedKeys = Share((android intersect ios).size, (android union ios).size),
        differences = differences.size,
        missing = differences.count { it.category == FindingCategory.MISSING },
        bundled = differences.count { finding -> listOf(android, ios).any { platform -> finding.keys.count(platform::contains) > 1 } },
    )
}

private fun found(from: List<VerifiedFinding>, `in`: List<VerifiedFinding>) = Share(
    from.count { x ->
        `in`.any { sameDifference(x, it) }
    },
    from.size,
)

fun stability(a: RunResults, b: RunResults): Stability {
    val inA = differences(a)
    val inB = differences(b)
    val matches = inA.mapNotNull { x -> inB.firstOrNull { sameDifference(x, it) }?.let { x to it } }
    return Stability(
        a = shape(a),
        b = shape(b),
        sameKeys = Platform.entries.associateWith { platform ->
            Share((keys(a, platform) intersect keys(b, platform)).size, (keys(a, platform) union keys(b, platform)).size)
        },
        aFoundInB = found(inA, inB),
        bFoundInA = found(inB, inA),
        sameCategory = Share(matches.count { (x, y) -> x.category == y.category }, matches.size),
        sameSeverity = Share(matches.count { (x, y) -> x.severity == y.severity }, matches.size),
    )
}

fun format(s: Stability): String = buildString {
    fun row(label: String, a: Any, b: Any) = appendLine("  ${label.padEnd(35)}${a.toString().padEnd(21)}$b")
    appendLine("Within each run".padEnd(37) + "A".padEnd(21) + "B")
    for (platform in Platform.entries) {
        row("${platform.displayName} items", s.a.items.getValue(platform), s.b.items.getValue(platform))
        row("  keys only on ${platform.displayName}", s.a.ownKeys.getValue(platform), s.b.ownKeys.getValue(platform))
        row("  files cited", s.a.filesCited.getValue(platform), s.b.filesCited.getValue(platform))
    }
    row("keys shared by Android and iOS", s.a.sharedKeys, s.b.sharedKeys)
    row("differences", s.a.differences, s.b.differences)
    row("  missing on one side", s.a.missing, s.b.missing)
    row("  bundled (2+ keys on a platform)", s.a.bundled, s.b.bundled)
    appendLine("Between the runs (same difference: shared key, or evidence within $SAME_PLACE_LINES lines)")
    for ((platform, share) in s.sameKeys) appendLine("  ${"same ${platform.displayName} keys".padEnd(35)}$share")
    appendLine("  ${"A's differences also in B".padEnd(35)}${s.aFoundInB}")
    appendLine("  ${"B's differences also in A".padEnd(35)}${s.bFoundInA}   <- A's recall if B is a reference run")
    appendLine("  ${"  of A's in B, same category".padEnd(35)}${s.sameCategory}")
    append("  ${"  of A's in B, same severity".padEnd(35)}${s.sameSeverity}")
}

/** `./gradlew stability -Pa=<dir> -Pb=<dir> [-Pfeature=search]` */
fun main(args: Array<String>) {
    require(args.size in 2..3 && args.take(2).all { it.isNotBlank() }) {
        "Usage: ./gradlew stability -Pa=<results folder> -Pb=<results folder> [-Pfeature=search]"
    }
    val feature = args.getOrNull(2)?.ifBlank { null } ?: "search"
    println(format(stability(loadResults(Path.of(args[0]), feature), loadResults(Path.of(args[1]), feature))))
}
