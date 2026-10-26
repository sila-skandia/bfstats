plugins {
  alias(libs.plugins.kotlin.jvm)
  alias(libs.plugins.kotlin.serialization)
}

kotlin {
  jvmToolchain(17)
}

dependencies {
  implementation(libs.kotlinx.coroutines.core)
  implementation(libs.kotlinx.serialization.json)
  testImplementation(libs.junit)
}

// The wire layer's live check (ProbeMain.kt): ServerInfo, handshake and a
// clean disconnect against the lab. ./gradlew -q :core:probe [--args="HOST PORT"]
tasks.register<JavaExec>("probe") {
  group = "verification"
  description = "Probe and join-then-leave a BF1942 server with the Kotlin wire layer"
  classpath = sourceSets["main"].runtimeClasspath
  mainClass.set("io.bfstats.sidecar.tools.ProbeMainKt")
  javaLauncher.set(javaToolchains.launcherFor { languageVersion.set(JavaLanguageVersion.of(17)) })
  isIgnoreExitValue = true
}
