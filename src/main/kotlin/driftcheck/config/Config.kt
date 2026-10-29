package driftcheck.config

import driftcheck.UserException
import driftcheck.claude.isModelId
import driftcheck.model.Platform
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.IOException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

const val CONFIG_DIR = ".driftcheck"
const val CONFIG_FILE = "config.json"
const val CONFIG_PATH = "$CONFIG_DIR/$CONFIG_FILE"
const val DEFAULT_MODEL = "claude-sonnet-5-5"
const val DEFAULT_MAX_BUDGET_USD = 2.0

/**
 * The config lives in the analyzed repository, which driftcheck does not control, so it must not be able to
 * make a run arbitrarily expensive.
 */
const val MAX_BUDGET_USD_LIMIT = 20.0

/** An agent run reads a lot of code; a healthy one finishes well within this. */
const val DEFAULT_TIMEOUT_MINUTES = 30

/** Long enough for very large apps, short enough that a hanging run cannot block CI for hours. */
const val MAX_TIMEOUT_MINUTES = 120

class ConfigException(message: String, cause: Throwable? = null) : UserException(message, cause)

private val FEATURE_ID = Regex("^[a-z0-9][a-z0-9-]*$")

/** Hints go into the prompt as they are, so they are kept to short pointers. */
const val MAX_HINTS = 20
const val MAX_HINT_LENGTH = 200

@Serializable
data class FeatureConfig(
    /** Stable id used on the command line and in file names, e.g. "search". */
    val id: String,
    val name: String,
    /** Optional pointers that help the agent find the feature faster: class names, folders, screens. */
    val hints: List<String> = emptyList(),
)

@Serializable
private data class RawPlatform(val path: String)

@Serializable
private data class RawPlatforms(val android: RawPlatform, val ios: RawPlatform)

@Serializable
private data class RawConfig(
    val version: Int,
    val name: String,
    val platforms: RawPlatforms,
    val features: List<FeatureConfig> = emptyList(),
    val model: String = DEFAULT_MODEL,
    /** USD per Claude run. */
    val maxBudgetUsd: Double = DEFAULT_MAX_BUDGET_USD,
    /** How long one platform's description may take before it is stopped. */
    val timeoutMinutes: Int = DEFAULT_TIMEOUT_MINUTES,
)

data class Config(
    /** The name of the app, shown at the top of every report so it is clear what was analyzed. */
    val name: String,
    /** The directory that contains `.driftcheck/`; platform paths are resolved against it. */
    val projectRoot: Path,
    /** Absolute, normalized source roots. */
    val platforms: Map<Platform, Path>,
    val features: List<FeatureConfig>,
    val model: String,
    val maxBudgetUsd: Double,
    /** The time limit for each platform's description run. */
    val agentTimeout: Duration = DEFAULT_TIMEOUT_MINUTES.minutes,
) {
    fun root(platform: Platform): Path = platforms.getValue(platform)

    fun feature(id: String): FeatureConfig = features.find { it.id == id } ?: throw ConfigException(
        "Unknown feature \"$id\". Configured features: ${features.joinToString(", ") { it.id }.ifEmpty { "none" }}. " +
            "Add it to $CONFIG_PATH.",
    )

    fun withModel(model: String): Config {
        checkModel(model, "--model")
        return copy(model = model)
    }
}

// Unknown keys are refused, so a misspelled option is reported instead of silently ignored
private val configJson = Json { ignoreUnknownKeys = false }

private fun checkModel(model: String, where: String) {
    if (!isModelId(model)) throw ConfigException("$where \"$model\" is not a model id such as $DEFAULT_MODEL")
}

/**
 * Parses and validates a config file's text. Only lexical path checks happen here, so it needs no file system;
 * [loadConfig] adds the checks against the real directories.
 */
fun parseConfig(text: String, projectRoot: Path, allowExternalPaths: Boolean = false): Config {
    val raw = try {
        configJson.decodeFromString<RawConfig>(text)
    } catch (e: SerializationException) {
        throw ConfigException("$CONFIG_PATH is invalid: ${e.message}", e)
    } catch (e: IllegalArgumentException) {
        throw ConfigException("$CONFIG_PATH is invalid: ${e.message}", e)
    }
    val problems = buildList {
        if (raw.version != 1) add("version must be 1, got ${raw.version}")
        if (raw.name.isBlank()) add("name must be the app's name, such as \"Wikipedia\"")
        if (!isModelId(raw.model)) add("model \"${raw.model}\" is not a model id such as $DEFAULT_MODEL")
        if (!raw.maxBudgetUsd.isFinite() || raw.maxBudgetUsd <= 0 || raw.maxBudgetUsd > MAX_BUDGET_USD_LIMIT) {
            add("maxBudgetUsd must be above 0 and at most $MAX_BUDGET_USD_LIMIT USD per run, got ${raw.maxBudgetUsd}")
        }
        if (raw.timeoutMinutes !in 1..MAX_TIMEOUT_MINUTES) {
            add("timeoutMinutes must be from 1 to $MAX_TIMEOUT_MINUTES, got ${raw.timeoutMinutes}")
        }
        for (feature in raw.features) {
            if (!FEATURE_ID.matches(feature.id)) add("feature id \"${feature.id}\" must be lowercase letters, digits and dashes")
            if (feature.name.isBlank()) add("feature \"${feature.id}\" needs a name")
            if (feature.hints.size > MAX_HINTS) add("feature \"${feature.id}\" has ${feature.hints.size} hints, at most $MAX_HINTS")
            if (feature.hints.any { it.isBlank() }) add("feature \"${feature.id}\" has an empty hint")
            if (feature.hints.any { it.length > MAX_HINT_LENGTH }) {
                add("feature \"${feature.id}\" has a hint longer than $MAX_HINT_LENGTH characters; hints are short pointers")
            }
        }
        val duplicates = raw.features.groupingBy { it.id }.eachCount().filterValues { it > 1 }.keys
        if (duplicates.isNotEmpty()) add("duplicate feature ids: ${duplicates.joinToString(", ")}")
    }
    if (problems.isNotEmpty()) throw ConfigException("$CONFIG_PATH is invalid:\n" + problems.joinToString("\n") { "  - $it" })

    val root = projectRoot.toAbsolutePath().normalize()
    val platforms = mapOf(
        Platform.ANDROID to platformRoot(root, raw.platforms.android.path, Platform.ANDROID, allowExternalPaths),
        Platform.IOS to platformRoot(root, raw.platforms.ios.path, Platform.IOS, allowExternalPaths),
    )
    checkPlatformRoots(root, platforms)
    return Config(raw.name.trim(), root, platforms, raw.features, raw.model, raw.maxBudgetUsd, raw.timeoutMinutes.minutes)
}

private fun platformRoot(projectRoot: Path, path: String, platform: Platform, allowExternal: Boolean): Path {
    val resolved = try {
        projectRoot.resolve(path).normalize()
    } catch (e: InvalidPathException) {
        throw ConfigException("$CONFIG_PATH: platforms.${platform.id}.path \"$path\" is not a valid path", e)
    }
    // The analyzed repository writes this file, so by default it may only point the agent at its own code
    if (!allowExternal && !resolved.startsWith(projectRoot)) {
        throw ConfigException(
            "$CONFIG_PATH: platforms.${platform.id}.path \"$path\" points outside the project root $projectRoot. " +
                "Pass --allow-external-paths if that is intended.",
        )
    }
    return resolved
}

/**
 * Each agent may only read its own app. A root that contains `.driftcheck/` would let it read earlier results, which
 * biases the new description, and overlapping roots would let one platform's agent describe the other's code.
 */
private fun checkPlatformRoots(projectRoot: Path, platforms: Map<Platform, Path>) {
    val problems = buildList {
        for ((platform, root) in platforms) {
            if (projectRoot.resolve(CONFIG_DIR).startsWith(root)) {
                add("platforms.${platform.id}.path must point at the app's source folder, not at a folder that contains $CONFIG_DIR/")
            }
        }
        val android = platforms.getValue(Platform.ANDROID)
        val ios = platforms.getValue(Platform.IOS)
        if (android.startsWith(ios) || ios.startsWith(android)) {
            add("platforms.android.path and platforms.ios.path must be separate folders, not the same or one inside the other")
        }
    }
    if (problems.isNotEmpty()) throw ConfigException("$CONFIG_PATH is invalid:\n" + problems.joinToString("\n") { "  - $it" })
}

/** Reads `.driftcheck/config.json` under [projectRoot] and checks that both platform roots exist. */
fun loadConfig(projectRoot: Path, allowExternalPaths: Boolean = false): Config {
    val file = projectRoot.resolve(CONFIG_DIR).resolve(CONFIG_FILE)
    val text = try {
        Files.readString(file)
    } catch (e: NoSuchFileException) {
        throw ConfigException("No $CONFIG_PATH in ${projectRoot.toAbsolutePath().normalize()}. Run \"driftcheck init\" to create one.", e)
    } catch (e: IOException) {
        throw ConfigException("Could not read $file: ${e.message}", e)
    }
    val config = parseConfig(text, projectRoot, allowExternalPaths)
    val realProjectRoot = config.projectRoot.toRealPath()
    for ((platform, root) in config.platforms) {
        if (!Files.isDirectory(root)) {
            throw ConfigException(
                "The ${platform.displayName} source root $root does not exist. Fix platforms.${platform.id}.path in $CONFIG_PATH.",
            )
        }
        // A symlink inside the project could still lead the agent somewhere else on the machine
        if (!allowExternalPaths && !root.toRealPath().startsWith(realProjectRoot)) {
            throw ConfigException(
                "The ${platform.displayName} source root $root leads outside the project root through a symlink. " +
                    "Pass --allow-external-paths if that is intended.",
            )
        }
    }
    return config
}

val CONFIG_TEMPLATE = """
    {
      "version": 1,
      "name": "My App",
      "platforms": {
        "android": { "path": "android" },
        "ios": { "path": "ios" }
      },
      "features": [
        { "id": "search", "name": "Search", "hints": [] }
      ],
      "model": "$DEFAULT_MODEL",
      "maxBudgetUsd": ${DEFAULT_MAX_BUDGET_USD}
    }
""".trimIndent() + "\n"
