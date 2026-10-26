plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

android {
  namespace = "io.bfstats.sidecar.app"
  compileSdk = 37
  defaultConfig {
    applicationId = "io.bfstats.sidecar"
    // WebView on 8.0+ runs WebGL 2 on most devices; nothing older is a target.
    minSdk = 26
    targetSdk = 37
    versionCode = 1
    versionName = "0.1.0"
  }

  buildTypes {
    release {
      // R8 fails the build on any class Android does not have (core is plain
      // JVM, so the JDK lets e.g. ProcessHandle through): `:app:assembleRelease`
      // is the check. Nothing is renamed, so stack traces stay readable.
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
