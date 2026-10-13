package driftcheck.claude

/** The only tools the agent can ever get: it can look at code but never change, run or send anything. */
val READ_ONLY_TOOLS = listOf("Read", "Grep", "Glob")

/** Tools that could write files, run commands or reach the network. Denied explicitly as a second layer. */
val DENIED_TOOLS = listOf("Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent")

/**
 * Environment variables starting with these are never passed on. They could make Claude Code bill an API or cloud
 * account instead of the user's own login (ANTHROPIC_API_KEY, CLAUDE_CODE_USE_BEDROCK), or send the analyzed code
 * somewhere other than Anthropic (ANTHROPIC_BASE_URL). Prefixes rather than names, so variables of the same kind
 * added later are removed too. The user's own login, such as CLAUDE_CODE_OAUTH_TOKEN, is not affected.
 */
val REMOVED_ENV_PREFIXES = listOf("ANTHROPIC_", "CLAUDE_CODE_USE_")

/** Model ids start with a letter or digit, so a value from a config file can never be read as a flag. */
private val MODEL_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:@/\\[\\]-]*$")

/**
 * Everything that varies between runs of `claude -p`. There is deliberately no prompt here: the prompt is
 * written to stdin, never put on the command line, where other users on the machine could read it.
 */
data class ClaudeOptions(
    val systemPrompt: String,
    /** JSON schema the final answer must match. */
    val jsonSchema: String,
    val model: String,
    val maxBudgetUsd: Double,
    /** A subset of [READ_ONLY_TOOLS]; empty for a step that only reasons over text it is given. */
    val tools: List<String> = READ_ONLY_TOOLS,
) {
    init {
        require(tools.all { it in READ_ONLY_TOOLS }) { "Only read-only tools are allowed, got $tools" }
        require(MODEL_ID.matches(model)) { "\"$model\" is not a valid model id" }
        // Infinity would pass "> 0" and reach claude as a budget that never runs out
        require(maxBudgetUsd.isFinite() && maxBudgetUsd > 0) { "The budget must be a positive number, got $maxBudgetUsd" }
    }
}

/**
 * The arguments for one `claude -p` run. Pure, and the only place they are built, so every security-relevant
 * flag is in one spot and covered by tests.
 */
fun claudeArgs(options: ClaudeOptions): List<String> = buildList {
    add("-p")
    // stream-json (which requires --verbose with -p) also carries the plan usage events
    addAll(listOf("--output-format", "stream-json", "--verbose"))
    addAll(listOf("--json-schema", options.jsonSchema))
    addAll(listOf("--system-prompt", options.systemPrompt))
    addAll(listOf("--model", options.model))
    addAll(listOf("--max-budget-usd", options.maxBudgetUsd.toString()))
    // Restricted mode ignores the analyzed repository's settings and confines file tools to the working directory
    add("--restricted")
    // Restricted mode still loads the repository's CLAUDE.md, skills and agents, which are instructions written by
    // the analyzed code. Safe mode turns them off but keeps the user's normal login (unlike --bare).
    add("--safe-mode")
    add("--strict-mcp-config")
    addAll(listOf("--tools", options.tools.joinToString(",")))
    if (options.tools.isNotEmpty()) addAll(listOf("--allowedTools", options.tools.joinToString(",")))
    addAll(listOf("--disallowedTools", DENIED_TOOLS.joinToString(",")))
    addAll(listOf("--permission-mode", "dontAsk"))
    add("--no-session-persistence")
}

/** The environment for `claude`: everything driftcheck got, except what [REMOVED_ENV_PREFIXES] covers. */
fun claudeEnv(env: Map<String, String>): Map<String, String> =
    // Ignoring case because Windows treats environment variable names that way
    env.filterKeys { name -> REMOVED_ENV_PREFIXES.none { name.startsWith(it, ignoreCase = true) } }
