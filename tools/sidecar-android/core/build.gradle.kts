import java.io.File
import java.security.MessageDigest

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

// The level tables' code version (template-table.mjs tableVersion): the sha1,
// first 12 hex digits, of the three files that compute a table, each read as
// latin1 with CRLF as LF. A downloaded bake carries the version that baked it,
// and the sidecar refetches a copy baked by other code (LevelTables).
val tableVersion = tasks.register("tableVersion") {
  val outDir = layout.buildDirectory.dir("generated/table-version").get().asFile
  val models = rootProject.layout.projectDirectory.dir("../bf1942-models")
  val files = listOf("sidecar_tid_table.py", "bf42/template_table.py", "sidecar/ghost/derive-children.mjs").map { models.file(it).asFile }
  files.forEach { if (it.exists()) inputs.file(it) }
  outputs.dir(outDir)
  doLast {
    val md = MessageDigest.getInstance("SHA-1")
    for (f in files) {
      if (f.exists()) md.update(String(f.readBytes(), Charsets.ISO_8859_1).replace("\r\n", "\n").toByteArray(Charsets.ISO_8859_1))
      else md.update(f.canonicalPath.toByteArray(Charsets.UTF_8))
    }
    val hex = md.digest().joinToString("") { b -> "%02x".format(b) }.take(12)
    val out = File(outDir, "sidecar/table-version.txt")
    out.parentFile.mkdirs()
    out.writeText(hex)
  }
}
sourceSets.main { resources.srcDir(tableVersion) }

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
