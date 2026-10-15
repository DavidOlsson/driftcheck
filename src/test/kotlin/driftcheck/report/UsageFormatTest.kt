package driftcheck.report

import driftcheck.model.PlanUsage
import driftcheck.model.PlanWindow
import driftcheck.model.Usage
import driftcheck.model.WindowStatus
import kotlin.test.Test
import kotlin.test.assertEquals

class UsageFormatTest {
    @Test
    fun `labels plan usage, also when Claude Code did not report it`() {
        assertEquals("not reported by Claude Code for this run", planUsageLabel(Usage()))
        assertEquals(
            "5-hour window 42% used · weekly limit limit reached, resets 2026-10-20 00:00 UTC",
            planUsageLabel(Usage(plan = PlanUsage(PlanWindow(usedPercent = 42), PlanWindow(WindowStatus.REJECTED, resetsAt = "2026-10-20T00:00:00Z")))),
        )
    }

    @Test
    fun `formats tokens and times the same on every machine`() {
        assertEquals("1,234,567 in, 89 out", tokenCounts(Usage(1_234_567, 89)))
        assertEquals("2026-10-13 08:30 UTC", formatUtc("2026-10-13T08:30:00Z"))
    }
}
