package driftcheck.store

import driftcheck.UserException
import driftcheck.config.CONFIG_DIR
import driftcheck.model.Platform
import driftcheck.model.storeJson
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.util.UUID

/**
 * Where results live inside the analyzed project (`.driftcheck/`), so they can be committed and compared over time.
 * The project may come from someone else, so writes never follow a symlink out of `.driftcheck/`.
 */
class Store(projectRoot: Path) {
    val base: Path = projectRoot.toAbsolutePath().normalize().resolve(CONFIG_DIR)

    fun spec(feature: String, platform: Platform): Path = base.resolve("specs").resolve(feature).resolve("${platform.id}.json")
    fun findings(feature: String): Path = base.resolve("findings").resolve("$feature.json")
    fun report(feature: String): Path = base.resolve("reports").resolve("$feature.html")

    fun writeText(file: Path, text: String) = writeAll(mapOf(file to text))

    /** Stored results are pretty-printed, so they read well and diff well in a pull request. */
    fun <T> json(serializer: KSerializer<T>, value: T): String = storeJson.encodeToString(serializer, value) + "\n"

    /**
     * Writes files that belong together. Every text first goes to a new temporary file next to its target, and only
     * when all of them are written are they moved into place, so a failure never leaves files from different runs.
     * A symlink planted at a target is replaced instead of followed.
     */
    fun writeAll(files: Map<Path, String>) {
        val temps = mutableListOf<Pair<Path, Path>>()
        try {
            for ((file, text) in files) {
                val target = file.toAbsolutePath().normalize()
                require(target.startsWith(base) && target != base) { "Refusing to write $file: results are only written inside $base" }
                ensureRealDirs(target.parent)
                // Checked before anything is moved, so this cannot fail halfway through the moves
                if (Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS)) {
                    throw UserException("$target is a directory. Remove it and run again.")
                }
                val temp = target.resolveSibling("${target.fileName}.${UUID.randomUUID()}.tmp")
                temps += temp to target
                // CREATE_NEW fails if anything, including a symlink, already exists at that path
                Files.writeString(temp, text, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
            }
            for ((temp, target) in temps) Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (e: IOException) {
            throw UserException("Could not write the results to $base: ${e.message}", e)
        } finally {
            for ((temp, _) in temps) runCatching { Files.deleteIfExists(temp) }
        }
    }

    fun <T> writeJson(file: Path, serializer: KSerializer<T>, value: T) = writeText(file, json(serializer, value))

    /** Reads a stored result; a missing or damaged file gets a message that says how to recreate it. */
    fun <T> readJson(file: Path, serializer: KSerializer<T>, howToRecreate: String): T {
        val text = try {
            Files.readString(file)
        } catch (e: NoSuchFileException) {
            throw UserException("$file does not exist. $howToRecreate", e)
        } catch (e: IOException) {
            throw UserException("Could not read $file: ${e.message}", e)
        }
        return try {
            storeJson.decodeFromString(serializer, text)
        } catch (e: SerializationException) {
            throw UserException("$file is not a valid driftcheck result: ${e.message} $howToRecreate", e)
        } catch (e: IllegalArgumentException) {
            throw UserException("$file is not a valid driftcheck result: ${e.message} $howToRecreate", e)
        }
    }

    /** Creates the directories from `.driftcheck/` down to [dir] one level at a time, refusing symlinks. */
    private fun ensureRealDirs(dir: Path) {
        var current = base
        for (part in listOf(null) + base.relativize(dir).toList()) {
            if (part != null) current = current.resolve(part)
            try {
                // Never follows a symlink at `current`, and its parent was checked in the previous step
                Files.createDirectory(current)
            } catch (_: FileAlreadyExistsException) {
                // Checked below
            } catch (e: IOException) {
                throw UserException("Could not create $current: ${e.message}", e)
            }
            if (Files.isSymbolicLink(current) || !Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS)) {
                val what = if (Files.isSymbolicLink(current)) "a symlink" else "not a directory"
                throw UserException(
                    "$current is $what. driftcheck only writes to real directories inside $CONFIG_DIR/; remove it and run again.",
                )
            }
        }
    }
}
