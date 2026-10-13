package driftcheck.commands

import driftcheck.UserException
import driftcheck.config.CONFIG_FILE
import driftcheck.config.CONFIG_PATH
import driftcheck.config.CONFIG_TEMPLATE
import driftcheck.config.Config
import driftcheck.evidence.VerificationSummary
import driftcheck.evidence.summarize
import driftcheck.evidence.verifySpec
import driftcheck.model.CompareRun
import driftcheck.model.FeatureSpec
import driftcheck.model.Platform
import driftcheck.model.VerifiedFeatureSpec
import driftcheck.model.modelJson
import driftcheck.model.problems
import driftcheck.report.renderCompareReport
import driftcheck.source.FsSourceReader
import driftcheck.store.Store
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path

/** Creates `.driftcheck/config.json` from the template. */
fun initProject(projectRoot: Path, force: Boolean): Path {
    val store = Store(projectRoot)
    val file = store.base.resolve(CONFIG_FILE)
    if (!force && Files.exists(file)) throw UserException("$file already exists. Pass --force to overwrite it.")
    store.writeText(file, CONFIG_TEMPLATE)
    return file
}

/**
 * Checks a stored or hand-written feature description against the platform's source. The verified status in a
 * stored description is ignored and checked again.
 */
fun verifySpecFile(config: Config, specFile: Path): Pair<VerifiedFeatureSpec, VerificationSummary> {
    val text = try {
        Files.readString(specFile)
    } catch (e: NoSuchFileException) {
        throw UserException("$specFile does not exist.", e)
    } catch (e: IOException) {
        throw UserException("Could not read $specFile: ${e.message}", e)
    }
    val spec = try {
        modelJson.decodeFromString<FeatureSpec>(text)
    } catch (e: SerializationException) {
        throw UserException("$specFile is not a valid feature description: ${e.message}", e)
    } catch (e: IllegalArgumentException) {
        throw UserException("$specFile is not a valid feature description: ${e.message}", e)
    }
    val problems = spec.problems()
    if (problems.isNotEmpty()) throw UserException("$specFile is not a valid feature description: ${problems.take(5).joinToString("; ")}")
    val verified = verifySpec(spec, FsSourceReader(config.root(spec.platform)))
    return verified to summarize(verified)
}

fun formatSummary(spec: VerifiedFeatureSpec, summary: VerificationSummary): String = buildList {
    add("${spec.feature} (${spec.platform.id}): ${summary.verifiedItems}/${summary.items} items verified against the source")
    summary.evidence.filterValues { it > 0 }.forEach { (status, count) -> add("  ${status.id}: $count") }
    val unverified = spec.items.filterNot { it.verified }
    if (unverified.isNotEmpty()) {
        add("Unverified items:")
        unverified.forEach { item -> add("  - ${item.key}: ${item.evidence.joinToString(", ") { "${it.location} (${it.status.id})" }}") }
    }
}.joinToString("\n")

/** Rebuilds a feature's report from the stored results, without Claude. */
fun rebuildReport(config: Config, featureId: String): Path {
    val feature = config.feature(featureId)
    val store = Store(config.projectRoot)
    val howToRecreate = "Run \"driftcheck compare ${feature.id}\" to create it."
    val android = store.readJson(store.spec(feature.id, Platform.ANDROID), VerifiedFeatureSpec.serializer(), howToRecreate)
    val ios = store.readJson(store.spec(feature.id, Platform.IOS), VerifiedFeatureSpec.serializer(), howToRecreate)
    val run = store.readJson(store.findings(feature.id), CompareRun.serializer(), howToRecreate)
    store.writeText(store.report(feature.id), renderCompareReport(run, android, ios))
    return store.report(feature.id)
}

/** Shown after init, so the next step is obvious. */
val INIT_NEXT_STEP = "Edit the platform paths and features in $CONFIG_PATH, then run \"driftcheck compare <feature>\"."
