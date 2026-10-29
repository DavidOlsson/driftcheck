plugins {
    kotlin("jvm") version "2.4.21"
    // Reads the config and validates all model output against the expected structure
    kotlin("plugin.serialization") version "2.4.21"
    application
    // Checks the code style on every build, so CI fails on formatting errors too
    id("org.jlleitschuh.gradle.ktlint") version "14.2.0"
}

group = "io.github.davidolsson"
version = "0.1.1"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    testImplementation(kotlin("test"))
}

kotlin {
    // Android developers almost always have at least JDK 17 installed
    jvmToolchain(17)
}

application {
    mainClass.set("driftcheck.MainKt")
    applicationName = "driftcheck"
}

tasks.processResources {
    // The version lives in this file only; the CLI reads it from a generated resource
    val version = project.version.toString()
    inputs.property("version", version)
    filesMatching("version.properties") {
        expand("version" to version)
    }
}

ktlint {
    version.set("1.8.0")
}

tasks.test {
    useJUnitPlatform()
    // Lets the version test compare with the build's version instead of a copy that goes stale on every release
    val version = project.version.toString()
    inputs.property("version", version)
    systemProperty("driftcheck.expectedVersion", version)
}
