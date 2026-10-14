package driftcheck.source

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class FsSourceReaderTest {
    private val workspace: Path = Files.createTempDirectory("driftcheck-source").toRealPath()
    private val root: Path = workspace.resolve("android").createDirectories()
    private val reader = FsSourceReader(root)

    init {
        root.resolve("search").createDirectories()
        root.resolve("search/Search.kt").writeText("val debounce = 200")
        root.resolve("..config.kt").writeText("val dots = true")
        workspace.resolve("secret.txt").writeText("outside the root")
    }

    @Test
    fun `reads files inside the root, also when the path takes a detour`() {
        assertEquals("val debounce = 200", reader.read("search/Search.kt"))
        assertEquals("val debounce = 200", reader.read("./search/../search/Search.kt"))
    }

    @Test
    fun `accepts file names that merely start with two dots`() {
        assertEquals("val dots = true", reader.read("..config.kt"))
    }

    @Test
    fun `refuses paths that leave the root`() {
        assertNull(reader.read("../secret.txt"))
        assertNull(reader.read("search/../../secret.txt"))
        assertNull(reader.read(workspace.resolve("secret.txt").toString()))
        assertNull(reader.read(""))
        assertNull(reader.read("."))
    }

    @Test
    fun `refuses symlinks that point outside the root but follows those that stay inside`() {
        Files.createSymbolicLink(root.resolve("leak.txt"), workspace.resolve("secret.txt"))
        Files.createSymbolicLink(root.resolve("shortcut.kt"), root.resolve("search/Search.kt"))
        assertNull(reader.read("leak.txt"))
        assertEquals("val debounce = 200", reader.read("shortcut.kt"))
    }

    @Test
    fun `returns null for missing files and directories`() {
        assertNull(reader.read("search/Missing.kt"))
        assertNull(reader.read("search"))
    }

    @Test
    fun `refuses paths that are not valid on this system`() {
        assertNull(reader.read("search/Search.kt\u0000.txt"))
    }

    @Test
    fun `refuses a root that does not exist or is not a directory`() {
        for (badRoot in listOf(workspace.resolve("missing"), workspace.resolve("secret.txt"))) {
            val error = assertFailsWith<IllegalArgumentException> { FsSourceReader(badRoot) }
            assertContains(error.message!!, "does not exist or is not a directory")
        }
    }

    @Test
    fun `treats paths the file system cannot open as missing instead of failing`() {
        assertNull(reader.read("search/Search.kt/inside-a-file.kt"))
        assertNull(reader.read("x".repeat(300) + ".kt"))
        root.resolve("loop").let { Files.createSymbolicLink(it, it) }
        assertNull(reader.read("loop"))
    }
}
