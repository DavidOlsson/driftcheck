package driftcheck.claude

import driftcheck.model.Usage
import kotlinx.serialization.json.Json

/** Records every request and answers with a canned result; never runs claude. */
class FakeClaudeClient(private val respond: (ClaudeRequest) -> ClaudeResult) : ClaudeClient {
    val requests = mutableListOf<ClaudeRequest>()

    override fun run(request: ClaudeRequest): ClaudeResult {
        synchronized(requests) { requests += request }
        return respond(request)
    }

    companion object {
        /** Answers every request with [json] and [usage]. */
        fun answering(json: String, usage: Usage = Usage(100, 10, 0.5)) =
            FakeClaudeClient { ClaudeResult(Json.parseToJsonElement(json), usage) }
    }
}
