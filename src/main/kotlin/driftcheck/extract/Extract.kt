package driftcheck.extract

import driftcheck.claude.ClaudeClient
import driftcheck.claude.ClaudeRunException
import driftcheck.claude.READ_ONLY_TOOLS
import driftcheck.claude.Structured
import driftcheck.claude.StructuredTask
import driftcheck.claude.runStructured
import driftcheck.config.Config
import driftcheck.config.FeatureConfig
import driftcheck.model.FeatureSpec
import driftcheck.model.Platform
import driftcheck.model.problems
import driftcheck.model.withoutUnsupportedItems

/** Lets a read-only agent in the platform's source root describe the feature, and validates the answer. */
fun extractFeature(client: ClaudeClient, config: Config, feature: FeatureConfig, platform: Platform): Structured<FeatureSpec> {
    val task = StructuredTask(
        serializer = FeatureSpec.serializer(),
        systemPrompt = EXTRACT_SYSTEM_PROMPT,
        prompt = extractPrompt(platform, feature),
        tools = READ_ONLY_TOOLS,
        cwd = config.root(platform),
        timeout = config.agentTimeout,
        where = "the ${platform.displayName} description",
        problems = { it.problems() },
    )
    val result = client.runStructured(task, config.model, config.maxBudgetUsd)
    // The agent is told which feature and platform to describe, but the caller is the source of truth
    val spec = result.output
    if (spec.feature != feature.id || spec.platform != platform) {
        throw ClaudeRunException(
            "The ${platform.displayName} agent described \"${spec.feature}\"/${spec.platform.id} instead of \"${feature.id}\"/${platform.id}.",
            result.usage,
        )
    }
    val supported = spec.withoutUnsupportedItems()
    // Comparing an empty description would spend another run only to report everything as missing
    if (supported.items.isEmpty()) {
        throw ClaudeRunException(
            "The ${platform.displayName} agent found nothing with evidence for \"${feature.id}\". Check that the feature exists in " +
                "${config.root(platform)}, and add hints (class names, folders, screens) for it in .driftcheck/config.json.",
            result.usage,
        )
    }
    return result.copy(output = supported)
}
