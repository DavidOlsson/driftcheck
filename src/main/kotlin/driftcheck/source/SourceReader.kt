package driftcheck.source

import driftcheck.UserException
import java.io.IOException
import java.nio.file.FileSystemException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path

/** Read access to one platform's source tree. Behind an interface so evidence checks can be tested in memory. */
fun interface SourceReader {
    /** The file's text, or null when it does not exist, is not a file, cannot be opened, or lies outside the root. */
    fun read(relativePath: String): String?
}

/**
 * Resolves a path given by the model against a root, refusing anything that would leave it. Model output is
 * untrusted, so "../../.ssh/id_rsa" or an absolute path must never be read. Purely lexical: [FsSourceReader]
 * also checks symlinks.
 */
fun resolveInsideRoot(root: Path, relativePath: String): Path? {
    if (relativePath.isBlank()) return null
    val candidate = try {
        Path.of(relativePath)
    } catch (_: InvalidPathException) {
        return null
    }
    if (candidate.isAbsolute) return null
    val base = root.toAbsolutePath().normalize()
    // startsWith compares whole path segments, so a file named "..config.kt" is not mistaken for ".."
    return base.resolve(candidate).normalize().takeIf { it != base && it.startsWith(base) }
}

class FsSourceReader(private val root: Path) : SourceReader {
    // Checked up front: a missing root would otherwise make every file look missing instead of failing clearly
    private val realRoot: Path = run {
        require(Files.isDirectory(root)) { "The source root $root does not exist or is not a directory" }
        root.toRealPath()
    }

    override fun read(relativePath: String): String? {
        val resolved = resolveInsideRoot(realRoot, relativePath) ?: return null
        return try {
            // A symlink inside the root could still point outside it, so the real paths are compared too
            val realFile = resolved.toRealPath()
            if (!realFile.startsWith(realRoot) || !Files.isRegularFile(realFile)) return null
            // Decoded leniently: a source file in another encoding must not stop the check
            String(Files.readAllBytes(realFile), Charsets.UTF_8)
        } catch (_: FileSystemException) {
            // The path comes from the model: a missing file, a name that is too long, a path through a file, a
            // symlink loop or a file without read access all mean the evidence cannot be confirmed
            null
        } catch (e: IOException) {
            throw UserException("Could not read $relativePath in $root: ${e.message}", e)
        }
    }
}
