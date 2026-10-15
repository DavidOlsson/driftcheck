package driftcheck.commands

import driftcheck.UserException
import driftcheck.config.CONFIG_FILE
import driftcheck.config.CONFIG_PATH
import driftcheck.config.CONFIG_TEMPLATE
import driftcheck.compare.sanitizeFindings
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
import driftcheck.report.ReportSubject
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

/**
 * Rebuilds a feature's report from the stored results, without Claude. The stored files may have been edited, so
 * their evidence is verified against the source again instead of trusting the stored statuses.
 */
fun rebuildReport(config: Config, featureId: String): Path {
    val feature = config.feature(featureId)
    val store = Store(config.projectRoot)
    val howToRecreate = "Run \"driftcheck compare ${feature.id}\" to create it."
    val specs = Platform.entries.associateWith { platform ->
        val file = store.spec(feature.id, platform)
        val stored = store.readJson(file, VerifiedFeatureSpec.serializer(), howToRecreate).toSpec()
        val problems = stored.problems() + listOfNotNull(
            "it describes ${stored.platform.id}".takeIf { stored.platform != platform },
            "it describes \"${stored.feature}\"".takeIf { stored.feature != feature.id },
        )
        if (problems.isNotEmpty()) throw UserException("$file is not a valid description: ${problems.take(5).joinToString("; ")}. $howToRecreate")
        verifySpec(stored, FsSourceReader(config.root(platform)))
    }
    val android = specs.getValue(Platform.ANDROID)
    val ios = specs.getValue(Platform.IOS)
    val stored = store.readJson(store.findings(feature.id), CompareRun.serializer(), howToRecreate)
    val run = stored.copy(findings = sanitizeFindings(stored.findings.map { it.toFinding() }, feature.id, android, ios))
    store.writeText(store.report(feature.id), renderCompareReport(reportSubject(config), run, android, ios))
    return store.report(feature.id)
}

/** The app's name and each platform's root relative to the project, never the machine's absolute paths. */
internal fun reportSubject(config: Config) = ReportSubject(
    config.name,
    config.platforms.mapValues { (_, root) -> config.projectRoot.relativize(root).toString().ifEmpty { "." } },
)

/** Shown after init, so the next step is obvious. */
val INIT_NEXT_STEP = "Edit the platform paths and features in $CONFIG_PATH, then run \"driftcheck compare <feature>\"."
