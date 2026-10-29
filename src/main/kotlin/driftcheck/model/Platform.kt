package driftcheck.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Platform(val displayName: String) {
    @SerialName("android")
    ANDROID("Android"),

    @SerialName("ios")
    IOS("iOS"),
    ;

    /** The name used in config files, model output and file names. */
    val id: String get() = name.lowercase()
}
