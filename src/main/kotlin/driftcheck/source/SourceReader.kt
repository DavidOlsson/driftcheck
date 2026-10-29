package driftcheck.source

import driftcheck.UserException
import java.io.IOException
import java.nio.file.FileSystemException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path

/** Above this a cited file is not source worth checking, and holding it in memory is a risk; cited paths are untrusted. */
const val MAX_SOURCE_FILE_BYTES = 5L * 1024 * 1024

/** What reading a cited file gave. */
sealed interface SourceFile {
    class Text(val text: String) : SourceFile {
        /** Split once, however many claims cite the file. */
        val lines: List<String> by lazy { text.lines() }
    }

    /** It does not exist, is not a file, cannot be opened, or lies outside the root. */
    data object Missing : SourceFile

    /** It is larger than [MAX_SOURCE_FILE_BYTES]. */
    data object TooLarge : SourceFile
}

/** Read access to one platform's source tree. Behind an interface so evidence checks can be tested in memory. */
fun interface SourceReader {
    fun read(relativePath: String): SourceFile
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

    override fun read(relativePath: String): SourceFile {
        val resolved = resolveInsideRoot(realRoot, relativePath) ?: return SourceFile.Missing
        return try {
            // A symlink inside the root could still point outside it, so the real paths are compared too
            val realFile = resolved.toRealPath()
            if (!realFile.startsWith(realRoot) || !Files.isRegularFile(realFile)) return SourceFile.Missing
            if (Files.size(realFile) > MAX_SOURCE_FILE_BYTES) return SourceFile.TooLarge
            // Decoded leniently: a source file in another encoding must not stop the check
            SourceFile.Text(String(Files.readAllBytes(realFile), Charsets.UTF_8))
        } catch (_: FileSystemException) {
            // The path comes from the model: a missing file, a name that is too long, a path through a file, a
            // symlink loop or a file without read access all mean the evidence cannot be confirmed
            SourceFile.Missing
        } catch (e: IOException) {
            throw UserException("Could not read $relativePath in $root: ${e.message}", e)
        }
    }
}
