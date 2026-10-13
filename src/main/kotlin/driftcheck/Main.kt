package driftcheck

import java.io.PrintStream
import java.util.Properties
import kotlin.system.exitProcess

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

    Usage: driftcheck [--help | --version]

    driftcheck is under development and has no commands yet.
    """.trimIndent()

/** Separate from main() so it can be tested without exiting the JVM. */
fun run(args: List<String>, out: PrintStream, err: PrintStream): Int {
    if (args.size > 1) {
        err.println("driftcheck: expected at most one argument, got ${args.size}. Run \"driftcheck --help\".")
        return EXIT_USAGE
    }
    return when (val arg = args.firstOrNull()) {
        null, "--help", "-h" -> {
            out.println(usage())
            0
        }
        "--version" -> {
            out.println(version())
            0
        }
        else -> {
            err.println("driftcheck: unknown argument \"$arg\". Run \"driftcheck --help\".")
            EXIT_USAGE
        }
    }
}

fun main(args: Array<String>) {
    exitProcess(run(args.toList(), System.out, System.err))
}
