import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

// The Play upload key (features/sidecar-android-app, "Releasing"): from a
// git-ignored keystore.properties beside this project locally, or from the
// environment in CI. Without either, a release build is left unsigned (the
// R8 check still runs) and only signing tasks need it.
val uploadKey: Map<String, String>? = run {
  val f = rootProject.file("keystore.properties")
  val p = Properties()
  if (f.exists()) f.inputStream().use { p.load(it) }
  fun v(prop: String, env: String) = p.getProperty(prop) ?: System.getenv(env)
  val store = v("storeFile", "SIDECAR_UPLOAD_STORE_FILE")
  if (store == null) null else mapOf(
    "storeFile" to store,
    "storePassword" to (v("storePassword", "SIDECAR_UPLOAD_STORE_PASSWORD") ?: error("upload key: storePassword missing")),
    "keyAlias" to (v("keyAlias", "SIDECAR_UPLOAD_KEY_ALIAS") ?: "upload"),
    "keyPassword" to (v("keyPassword", "SIDECAR_UPLOAD_KEY_PASSWORD") ?: v("storePassword", "SIDECAR_UPLOAD_STORE_PASSWORD")!!),
  )
}

android {
  namespace = "io.bfstats.sidecar.app"
  compileSdk = 37
  defaultConfig {
    applicationId = "io.bfstats.app"
    // WebView on 8.0+ runs WebGL 2 on most devices; nothing older is a target.
    minSdk = 26
    targetSdk = 37
    // Play needs every upload's versionCode higher than the last: CI passes
    // its run number; a local build is 1.
    versionCode = (System.getenv("SIDECAR_VERSION_CODE") ?: "1").toInt()
    versionName = System.getenv("SIDECAR_VERSION_NAME") ?: "0.1.0"
  }

  signingConfigs {
    if (uploadKey != null) create("upload") {
      storeFile = rootProject.file(uploadKey.getValue("storeFile"))
      storePassword = uploadKey.getValue("storePassword")
      keyAlias = uploadKey.getValue("keyAlias")
      keyPassword = uploadKey.getValue("keyPassword")
    }
  }

  buildTypes {
    release {
      // R8 fails the build on any class Android does not have (core is plain
      // JVM, so the JDK lets e.g. ProcessHandle through): `:app:assembleRelease`
      // is the check. Nothing is renamed, so stack traces stay readable.
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      if (uploadKey != null) signingConfig = signingConfigs.getByName("upload")
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  buildFeatures {
    compose = true
  }
  // Lint over core too, for APIs newer than minSdk (a class Android never had
  // is R8's to catch, above).
  lint {
    checkDependencies = true
    disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
  }
}

kotlin {
  jvmToolchain(17)
}

dependencies {
  implementation(project(":core"))

  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.ui.tooling.preview)
  debugImplementation(libs.androidx.compose.ui.tooling)
  implementation(libs.androidx.webkit)
  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.kotlinx.serialization.json)

  testImplementation(libs.junit)
}
