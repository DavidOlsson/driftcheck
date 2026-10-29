package driftcheck.store

import driftcheck.UserException
import driftcheck.model.Platform
import driftcheck.model.Usage
import java.nio.file.Files
import kotlin.io.path.createDirectories
import kotlin.io.path.createDirectory
import kotlin.io.path.createSymbolicLinkPointingTo
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class StoreTest {
    private val project = Files.createTempDirectory("driftcheck-store")
    private val store = Store(project)

    @Test
    fun `writes results inside driftcheck, creating the directories`() {
        store.writeText(store.report("search"), "# Report\n")
        store.writeJson(store.findings("search"), Usage.serializer(), Usage(1, 2, 0.5))

        assertEquals("# Report\n", project.resolve(".driftcheck/reports/search.md").readText())
        assertEquals(Usage(1, 2, 0.5), store.readJson(store.findings("search"), Usage.serializer(), "Run compare."))
        assertEquals(project.toAbsolutePath().resolve(".driftcheck/specs/search/ios.json"), store.spec("search", Platform.IOS))
        // No temporary files are left behind
        assertEquals(1, project.resolve(".driftcheck/reports").listDirectoryEntries().size)
    }

    @Test
    fun `refuses to write outside driftcheck`() {
        assertFailsWith<IllegalArgumentException> { store.writeText(project.resolve("README.md"), "x") }
        assertFailsWith<IllegalArgumentException> { store.writeText(store.base.resolve("../escape.md"), "x") }
    }

    @Test
    fun `never writes through a symlinked directory`() {
        val outside = Files.createTempDirectory("driftcheck-outside")
        project.resolve(".driftcheck").createDirectory().resolve("reports").createSymbolicLinkPointingTo(outside)

        val error = assertFailsWith<UserException> { store.writeText(store.report("search"), "x") }
        assertContains(error.message!!, "symlink")
        assertFalse(outside.resolve("search.md").exists())
    }

    @Test
    fun `replaces a symlink at the target instead of following it`() {
        val outside = Files.createTempFile("driftcheck-outside", ".md").apply { writeText("keep") }
        project.resolve(".driftcheck/reports").createDirectories().resolve("search.md").createSymbolicLinkPointingTo(outside)

        store.writeText(store.report("search"), "new")

        assertEquals("keep", outside.readText())
        assertFalse(Files.isSymbolicLink(store.report("search")))
        assertEquals("new", store.report("search").readText())
    }

    @Test
    fun `explains a missing or damaged result`() {
        assertContains(
            assertFailsWith<UserException> { store.readJson(store.findings("x"), Usage.serializer(), "Run compare.") }.message!!,
            "Run compare.",
        )
        store.writeText(store.findings("x"), "{not json")
        assertFailsWith<UserException> { store.readJson(store.findings("x"), Usage.serializer(), "Run compare.") }
    }
}
