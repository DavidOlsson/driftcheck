package driftcheck

import driftcheck.claude.ClaudeClient
import driftcheck.claude.ClaudeRunException
import driftcheck.claude.CliClaudeClient
import driftcheck.commands.Deps
import driftcheck.commands.INIT_NEXT_STEP
import driftcheck.commands.formatSummary
import driftcheck.commands.initProject
import driftcheck.commands.rebuildReport
import driftcheck.commands.runCompare
import driftcheck.commands.verifySpecFile
import driftcheck.config.loadConfig
import driftcheck.model.Usage
import driftcheck.process.ProcessCommandRunner
import driftcheck.report.planUsageLabel
import java.io.PrintStream
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.Properties
import kotlin.system.exitProcess

/** Exit code for a failed command: a problem with the setup, the input or a Claude run. */
const val EXIT_FAILURE = 1

/** Exit code for invalid usage, as most command-line tools use. */
const val EXIT_USAGE = 2

fun version(): String {
    val properties = Properties()
    Thread.currentThread().contextClassLoader.getResourceAsStream("version.properties")?.use { properties.load(it) }
    return properties.getProperty("version") ?: "unknown"
}

fun usage(): String =
    """
    driftcheck ${version()}
    Compares how a feature is implemented in an Android and an iOS app.

    Usage: driftcheck [options] <command>

    Commands:
      init                 create .driftcheck/config.json
      compare <feature>    describe the feature on both platforms with Claude and report the differences
      verify <spec.json>   check a feature description's evidence (file, line, quote) against the source
      report <feature>     rebuild a feature's report from stored results, without Claude

    Options:
      -C, --project <dir>       project root that contains .driftcheck/ (default: current directory)
      -m, --model <model>       Claude model for compare, instead of the configured one
      --allow-external-paths    allow platform paths in the config to point outside the project root
      -f, --force               let init overwrite an existing config
      -h, --help                show this help
      --version                 show the version

    compare runs your own Claude Code (claude) with read-only tools and counts toward your Claude plan.
    """.trimIndent()

/** What the CLI needs from the machine, passed in so it can be tested without a real claude or file system root. */
class Environment(
    val workingDir: Path,
    val claude: () -> ClaudeClient,
    val now: () -> Instant = Instant::now,
    /** Shows plan reset times in the user's own time zone; reports use UTC. */
    val zone: ZoneId = ZoneId.systemDefault(),
) {
    companion object {
        fun system() = Environment(
            workingDir = Path.of("").toAbsolutePath(),
            claude = { CliClaudeClient(ProcessCommandRunner(), System.getenv()) },
        )
    }
}

private class UsageException(message: String) : Exception(message)

private class Options(
    val positional: List<String>,
    val project: String?,
    val model: String?,
    val allowExternalPaths: Boolean,
    val force: Boolean,
    val help: Boolean,
    val version: Boolean,
)

private fun parseOptions(args: List<String>): Options {
    val positional = mutableListOf<String>()
    var project: String? = null
    var model: String? = null
    var allowExternalPaths = false
    var force = false
    var help = false
    var version = false
    val rest = args.iterator()
    fun value(flag: String): String {
        if (!rest.hasNext()) throw UsageException("$flag needs a value.")
        return rest.next()
    }
    while (rest.hasNext()) {
        when (val arg = rest.next()) {
            "-C", "--project" -> project = value(arg)
            "-m", "--model" -> model = value(arg)
            "--allow-external-paths" -> allowExternalPaths = true
            "-f", "--force" -> force = true
            "-h", "--help" -> help = true
            "--version" -> version = true
            "--" -> rest.forEachRemaining { positional += it }
            else -> if (arg.startsWith("-") && arg != "-") throw UsageException("unknown option \"$arg\".") else positional += arg
        }
    }
    return Options(positional, project, model, allowExternalPaths, force, help, version)
}

/**
 * Messages and summaries can contain text from the model or the analyzed repository. Control characters in it could
 * move the cursor or rewrite earlier lines in the terminal, so they are shown as "?".
 */
fun terminalSafe(text: String): String = text.replace(Regex("[\\p{Cc}&&[^\\n\\t]]"), "?")

/** Separate from main() so it can be tested without exiting the JVM. */
fun run(args: List<String>, out: PrintStream, err: PrintStream, env: Environment = Environment.system()): Int {
    try {
        val options = parseOptions(args)
        if (options.version) {
            out.println(version())
            return 0
        }
        if (options.help || options.positional.isEmpty()) {
            out.println(usage())
            return 0
        }
        return runCommand(options, out, env)
    } catch (e: UsageException) {
        err.println("driftcheck: ${terminalSafe(e.message.orEmpty())} Run \"driftcheck --help\".")
        return EXIT_USAGE
    } catch (e: ClaudeRunException) {
        err.println("driftcheck: ${terminalSafe(e.message.orEmpty())}")
        if (e.usage.plan != null) err.println("Plan usage: ${planUsageLabel(e.usage, localTime(env.zone))}")
        return EXIT_FAILURE
    } catch (e: UserException) {
        err.println("driftcheck: ${terminalSafe(e.message.orEmpty())}")
        return EXIT_FAILURE
    }
}

private fun runCommand(options: Options, out: PrintStream, env: Environment): Int {
    val command = options.positional.first()
    val operands = options.positional.drop(1)
    fun operand(name: String): String {
        if (operands.size != 1) throw UsageException("$command expects one $name, got ${operands.size}.")
        return operands.single()
    }
    val projectRoot = options.project?.let { env.workingDir.resolve(it).normalize() } ?: env.workingDir
    fun config() = loadConfig(projectRoot, options.allowExternalPaths).let { c -> options.model?.let(c::withModel) ?: c }
    fun relative(path: Path) = runCatching { env.workingDir.relativize(path) }.getOrDefault(path)

    when (command) {
        "init" -> {
            if (operands.isNotEmpty()) throw UsageException("init takes no arguments.")
            val file = initProject(projectRoot, options.force)
            out.println("Created ${relative(file)}. $INIT_NEXT_STEP")
        }

        "compare" -> {
            val feature = operand("feature")
            val result = runCompare(config(), feature, Deps(env.claude(), env.now, out::println))
            val counts = result.findings.groupingBy { it.category }.eachCount().entries.joinToString(", ") { "${it.value} ${it.key.id}" }
            out.println("Findings: ${counts.ifEmpty { "none" }}")
            out.println("Report: ${relative(result.reportFile)}")
            printUsage(out, result.usage, env)
        }

        "verify" -> {
            val specFile = env.workingDir.resolve(operand("description file"))
            val (spec, summary) = verifySpecFile(config(), specFile)
            out.println(terminalSafe(formatSummary(spec, summary)))
        }

        "report" -> {
            val file = rebuildReport(config(), operand("feature"))
            out.println("Report: ${relative(file)}")
        }

        else -> throw UsageException("unknown command \"$command\".")
    }
    return 0
}

private fun printUsage(out: PrintStream, usage: Usage, env: Environment) {
    out.println("Plan usage: ${planUsageLabel(usage, localTime(env.zone))}")
}

/** In the terminal, reset times are shown in local time; reports use UTC so they read the same for everyone. */
private fun localTime(zone: ZoneId): (String) -> String = { iso ->
    runCatching { DateTimeFormatter.ofPattern("EEE HH:mm", Locale.ENGLISH).withZone(zone).format(Instant.parse(iso)) }.getOrDefault(iso)
}

fun main(args: Array<String>) {
    exitProcess(run(args.toList(), System.out, System.err))
}
