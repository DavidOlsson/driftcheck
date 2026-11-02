package driftcheck.commands

import driftcheck.claude.ClaudeClient
import driftcheck.claude.ClaudeRunException
import driftcheck.compare.compareSpecs
import driftcheck.config.Config
import driftcheck.evidence.summarize
import driftcheck.evidence.verifySpec
import driftcheck.extract.KnownItem
import driftcheck.extract.extractFeature
import driftcheck.model.CompareRun
import driftcheck.model.Platform
import driftcheck.model.Usage
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedFinding
import driftcheck.report.renderCompareReport
import driftcheck.source.FsSourceReader
import driftcheck.store.Store
import java.io.IOException
import java.math.BigDecimal
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.temporal.ChronoUnit

/** What a command needs from the outside world, passed in so commands can be tested without it. */
class Deps(val claude: ClaudeClient, val now: () -> Instant = Instant::now, val log: (String) -> Unit = {})

data class CompareResult(val findings: List<VerifiedFinding>, val reportFile: Path, val usage: Usage)

private class Described(val spec: VerifiedFeatureSpec, val usage: Usage)

/**
 * Describes the feature on both platforms, verifies every claim, compares the descriptions and writes the
 * descriptions, the findings and the report to `.driftcheck/`.
 */
fun runCompare(config: Config, featureId: String, deps: Deps): CompareResult {
    val feature = config.feature(featureId)
    // One description per platform, then the comparison
    val runs = Platform.entries.size + 1
    deps.log(
        "Comparing \"${feature.name}\" with ${config.model} via Claude Code: $runs runs of at most ${budget(config.maxBudgetUsd)} USD " +
            "each, so at most ${budget(config.maxBudgetUsd * runs)} USD in total…",
    )

    fun describe(platform: Platform, known: List<KnownItem>): Described {
        val result = extractFeature(deps.claude, config, feature, platform, known)
        val verified = verifySpec(result.output, FsSourceReader(config.root(platform)))
        val summary = summarize(verified)
        deps.log("  ${platform.displayName}: ${summary.items} items, ${summary.verifiedItems} verified against the source")
        return Described(verified, result.usage)
    }

    // One after the other, so iOS can reuse Android's keys: the same behavior then gets the same key on both platforms,
    // and the comparison pairs items by key instead of guessing. It takes longer, but costs the same.
    val androidRun = describe(Platform.ANDROID, emptyList())
    val iosRun = try {
        describe(Platform.IOS, androidRun.spec.items.map { KnownItem(it.key, it.description) })
    } catch (e: ClaudeRunException) {
        // The Android run counts toward the plan too
        throw ClaudeRunException(e.message!!, androidRun.usage + e.usage, e)
    }
    val android = androidRun.spec
    val ios = iosRun.spec
    val describedUsage = androidRun.usage + iosRun.usage

    // An empty directory: the comparison has no tools, and nothing project-specific should be within reach
    val workDir = try {
        Files.createTempDirectory("driftcheck-compare")
    } catch (e: IOException) {
        throw ClaudeRunException(
            "Could not create a temporary directory for the comparison: ${e.message}. Check that the system temp directory " +
                "(java.io.tmpdir) exists and is writable.",
            describedUsage,
            e,
        )
    }
    val compared = try {
        compareSpecs(deps.claude, config, android, ios, workDir)
    } catch (e: ClaudeRunException) {
        throw ClaudeRunException(e.message!!, describedUsage + e.usage, e)
    } finally {
        // Best effort: a leftover temp file must never replace the real error or the result
        runCatching { workDir.toFile().deleteRecursively() }
    }
    val usage = describedUsage + compared.usage

    val run = CompareRun(
        feature = feature.id,
        featureName = feature.name,
        model = config.model,
        generatedAt = deps.now().truncatedTo(ChronoUnit.SECONDS).toString(),
        usage = usage,
        findings = compared.output,
    )
    // Written together and only after every step succeeded, so a failed run never replaces earlier results
    val store = Store(config.projectRoot)
    store.writeAll(
        mapOf(
            store.spec(feature.id, Platform.ANDROID) to store.json(VerifiedFeatureSpec.serializer(), android),
            store.spec(feature.id, Platform.IOS) to store.json(VerifiedFeatureSpec.serializer(), ios),
            store.findings(feature.id) to store.json(CompareRun.serializer(), run),
            store.report(feature.id) to renderCompareReport(reportSubject(config), run, android, ios),
        ),
    )
    return CompareResult(run.findings, store.report(feature.id), usage)
}

private fun budget(usd: Double) = BigDecimal.valueOf(usd).stripTrailingZeros().toPlainString()
