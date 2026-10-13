package driftcheck.model

import kotlinx.serialization.json.Json

/** Reads model output. Extra fields are dropped rather than refused: they are never used, so they cannot do harm. */
val modelJson = Json { ignoreUnknownKeys = true }

/** Reads and writes driftcheck's own stored results, which are readable and diffable in a pull request. */
val storeJson = Json {
    prettyPrint = true
    encodeDefaults = true
    ignoreUnknownKeys = false
}
