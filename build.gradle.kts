plugins {
    kotlin("jvm") version "2.4.21"
    application
}

group = "io.github.davidolsson"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
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

tasks.test {
    useJUnitPlatform()
}
