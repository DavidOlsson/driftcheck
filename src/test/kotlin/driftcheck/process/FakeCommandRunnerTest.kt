package driftcheck.process

import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.seconds

class FakeCommandRunnerTest {
    @Test
    fun `records calls and answers with the canned result`() {
        val fake = FakeCommandRunner { CommandResult(0, "out for ${it.args.first()}", "") }
        val result = fake.run("claude", listOf("-p"), timeout = 5.seconds, cwd = Path.of("/repo"), env = mapOf("PATH" to "/usr/bin"), input = "prompt")
        assertEquals("out for -p", result.stdout)
        assertEquals(FakeCommandRunner.Call("claude", listOf("-p"), 5.seconds, Path.of("/repo"), mapOf("PATH" to "/usr/bin"), "prompt"), fake.calls.single())
    }
}
