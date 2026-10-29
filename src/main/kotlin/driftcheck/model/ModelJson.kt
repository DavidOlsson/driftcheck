package driftcheck.model

import kotlinx.serialization.json.Json

/**
 * Reads model output. Extra fields are dropped rather than refused: they are never used, so they cannot do harm.
 * A left-out nullable field counts as null, which is what the model means by leaving it out.
 */
val modelJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

/** Reads and writes driftcheck's own stored results, which are readable and diffable in a pull request. */
val storeJson = Json {
    prettyPrint = true
    encodeDefaults = true
    ignoreUnknownKeys = false
}
