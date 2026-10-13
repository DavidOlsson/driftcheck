package driftcheck.commands

import driftcheck.claude.ClaudeClient
import driftcheck.claude.ClaudeRunException
import driftcheck.compare.compareSpecs
import driftcheck.config.Config
import driftcheck.evidence.summarize
import driftcheck.evidence.verifySpec
import driftcheck.extract.extractFeature
import driftcheck.model.CompareRun
import driftcheck.model.Platform
import driftcheck.model.Usage
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.VerifiedFinding
import driftcheck.report.renderCompareReport
import driftcheck.source.FsSourceReader
import driftcheck.store.Store
import java.math.BigDecimal
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors

/** What a command needs from the outside world, passed in so commands can be tested without it. */
class Deps(
    val claude: ClaudeClient,
    val now: () -> Instant = Instant::now,
    val log: (String) -> Unit = {},
)

data class CompareResult(val findings: List<VerifiedFinding>, val reportFile: Path, val usage: Usage)

private class Described(val spec: VerifiedFeatureSpec, val usage: Usage)

/**
 * Describes the feature on both platforms, verifies every claim, compares the descriptions and writes the
 * descriptions, the findings and the report to `.driftcheck/`.
 */
fun runCompare(config: Config, featureId: String, deps: Deps): CompareResult {
    val feature = config.feature(featureId)
    deps.log("Comparing \"${feature.name}\" with ${config.model} via Claude Code (at most ${budget(config.maxBudgetUsd)} USD per run, 3 runs)…")

    val described = describeBoth { platform ->
        val result = extractFeature(deps.claude, config, feature, platform)
        val verified = verifySpec(result.output, FsSourceReader(config.root(platform)))
        val summary = summarize(verified)
        deps.log("  ${platform.displayName}: ${summary.items} items, ${summary.verifiedItems} verified against the source")
        Described(verified, result.usage)
    }
    val android = described.getValue(Platform.ANDROID).spec
    val ios = described.getValue(Platform.IOS).spec
    val describedUsage = described.values.fold(Usage.NONE) { sum, d -> sum + d.usage }

    // An empty directory: the comparison has no tools, and nothing project-specific should be within reach
    val workDir = Files.createTempDirectory("driftcheck-compare")
    val compared = try {
        compareSpecs(deps.claude, config, android, ios, workDir)
    } catch (e: ClaudeRunException) {
        throw ClaudeRunException(e.message!!, describedUsage + e.usage, e)
    } finally {
        Files.deleteIfExists(workDir)
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
    // Written only after every step succeeded, so the stored files always belong to the same run
    val store = Store(config.projectRoot)
    store.writeJson(store.spec(feature.id, Platform.ANDROID), VerifiedFeatureSpec.serializer(), android)
    store.writeJson(store.spec(feature.id, Platform.IOS), VerifiedFeatureSpec.serializer(), ios)
    store.writeJson(store.findings(feature.id), CompareRun.serializer(), run)
    store.writeText(store.report(feature.id), renderCompareReport(run, android, ios))
    return CompareResult(run.findings, store.report(feature.id), usage)
}

private fun budget(usd: Double) = BigDecimal.valueOf(usd).stripTrailingZeros().toPlainString()

/**
 * Describes both platforms at the same time. When a run fails, the other one is still waited for, and the error
 * carries what both used, because a failed run counts toward the plan too.
 */
private fun describeBoth(describe: (Platform) -> Described): Map<Platform, Described> {
    val executor = Executors.newFixedThreadPool(Platform.entries.size)
    try {
        val futures = Platform.entries.associateWith { platform -> executor.submit<Described> { describe(platform) } }
        val outcomes = futures.mapValues { (_, future) ->
            try {
                Result.success(future.get())
            } catch (e: ExecutionException) {
                Result.failure(e.cause ?: e)
            }
        }
        val failure = outcomes.values.firstNotNullOfOrNull { it.exceptionOrNull() } ?: return outcomes.mapValues { it.value.getOrThrow() }
        if (failure !is ClaudeRunException) throw failure
        val used = outcomes.values.fold(Usage.NONE) { sum, outcome ->
            sum + (outcome.getOrNull()?.usage ?: (outcome.exceptionOrNull() as? ClaudeRunException)?.usage ?: Usage.NONE)
        }
        throw ClaudeRunException(failure.message!!, used, failure)
    } finally {
        executor.shutdownNow()
    }
}
