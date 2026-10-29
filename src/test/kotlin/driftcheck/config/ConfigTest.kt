package driftcheck.config

import driftcheck.model.Platform
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.createDirectory
import kotlin.io.path.createSymbolicLinkPointingTo
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.time.Duration.Companion.minutes

class ConfigTest {
    private val root = Path.of("/work/project")

    private fun config(body: String = "") = """
        {
          "version": 1,
          "name": "Wikipedia",
          "platforms": { "android": { "path": "android" }, "ios": { "path": "apps/ios" } }
          $body
        }
    """.trimIndent()

    @Test
    fun `parses a minimal config with defaults`() {
        val config = parseConfig(config(), root)
        assertEquals("Wikipedia", config.name)
        assertEquals(Path.of("/work/project/android"), config.root(Platform.ANDROID))
        assertEquals(Path.of("/work/project/apps/ios"), config.root(Platform.IOS))
        assertEquals(DEFAULT_MODEL, config.model)
        assertEquals(DEFAULT_MAX_BUDGET_USD, config.maxBudgetUsd)
        assertEquals(DEFAULT_TIMEOUT_MINUTES.minutes, config.agentTimeout)
        assertEquals(emptyList(), config.features)
    }

    @Test
    fun `parses features, model and budget`() {
        val config = parseConfig(
            config(
                """, "features": [{ "id": "search", "name": "Search", "hints": ["SearchFragment"] }],
                "model": "claude-opus-5-5", "maxBudgetUsd": 5, "timeoutMinutes": 60""",
            ),
            root,
        )
        assertEquals(FeatureConfig("search", "Search", listOf("SearchFragment")), config.feature("search"))
        assertEquals("claude-opus-5-5", config.model)
        assertEquals(5.0, config.maxBudgetUsd)
        assertEquals(60.minutes, config.agentTimeout)
    }

    @Test
    fun `the template is a valid config`() {
        parseConfig(CONFIG_TEMPLATE, root)
    }

    @Test
    fun `reports unknown keys, invalid JSON and missing fields`() {
        assertContains(assertFailsWith<ConfigException> { parseConfig(config(""", "modle": "x""""), root) }.message!!, "modle")
        assertFailsWith<ConfigException> { parseConfig("{", root) }
        assertFailsWith<ConfigException> { parseConfig("""{"version": 1}""", root) }
        assertContains(
            assertFailsWith<ConfigException> {
                parseConfig(config().replace("\"name\": \"Wikipedia\",", ""), root)
            }.message!!,
            "name",
        )
        assertContains(assertFailsWith<ConfigException> { parseConfig(config().replace("Wikipedia", " "), root) }.message!!, "app's name")
    }

    @Test
    fun `lists every invalid value at once`() {
        val error = assertFailsWith<ConfigException> {
            parseConfig(
                config(
                    """, "version": 2, "model": "--dangerous", "maxBudgetUsd": 500, "timeoutMinutes": 0,
                    "features": [{ "id": "Search", "name": " " }, { "id": "a", "name": "A" }, { "id": "a", "name": "B" }]""",
                )
                    .replace("\"version\": 1,", ""),
                root,
            )
        }
        val message = error.message!!
        assertContains(message, "version must be 1")
        assertContains(message, "model \"--dangerous\"")
        assertContains(message, "maxBudgetUsd")
        assertContains(message, "timeoutMinutes must be from 1 to $MAX_TIMEOUT_MINUTES, got 0")
        assertContains(message, "feature id \"Search\"")
        assertContains(message, "needs a name")
        assertContains(message, "duplicate feature ids: a")
    }

    @Test
    fun `refuses platform paths outside the project root unless allowed`() {
        val outside = config().replace("\"android\" }", "\"../elsewhere\" }")
        assertContains(assertFailsWith<ConfigException> { parseConfig(outside, root) }.message!!, "--allow-external-paths")
        assertEquals(Path.of("/work/elsewhere"), parseConfig(outside, root, allowExternalPaths = true).root(Platform.ANDROID))
        assertFailsWith<ConfigException> { parseConfig(config().replace("\"android\" }", "\"/etc\" }"), root) }
    }

    @Test
    fun `names the configured features when one is unknown`() {
        val config = parseConfig(config(""", "features": [{ "id": "search", "name": "Search" }]"""), root)
        assertContains(assertFailsWith<ConfigException> { config.feature("login") }.message!!, "Configured features: search")
    }

    @Test
    fun `validates a model given on the command line`() {
        val config = parseConfig(config(), root)
        assertEquals("claude-haiku-5-5", config.withModel("claude-haiku-5-5").model)
        assertFailsWith<ConfigException> { config.withModel("-x") }
    }

    @Test
    fun `loads the file and checks that the platform roots exist`() {
        val dir = Files.createTempDirectory("driftcheck-config")
        assertContains(assertFailsWith<ConfigException> { loadConfig(dir) }.message!!, "driftcheck init")

        dir.resolve(CONFIG_DIR).createDirectory().resolve(CONFIG_FILE).writeText(config())
        assertContains(assertFailsWith<ConfigException> { loadConfig(dir) }.message!!, "Android source root")

        dir.resolve("android").createDirectory()
        dir.resolve("apps/ios").createDirectories()
        assertEquals(dir.toAbsolutePath().normalize().resolve("apps/ios"), loadConfig(dir).root(Platform.IOS))
    }

    @Test
    fun `refuses a platform root that leads outside the project through a symlink`() {
        val dir = Files.createTempDirectory("driftcheck-config")
        val outside = Files.createTempDirectory("driftcheck-outside")
        dir.resolve(CONFIG_DIR).createDirectory().resolve(CONFIG_FILE).writeText(config())
        dir.resolve("android").createSymbolicLinkPointingTo(outside)
        dir.resolve("apps/ios").createDirectories()
        assertContains(assertFailsWith<ConfigException> { loadConfig(dir) }.message!!, "symlink")
        loadConfig(dir, allowExternalPaths = true)
    }
}
