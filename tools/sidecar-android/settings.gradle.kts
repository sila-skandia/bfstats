pluginManagement {
  repositories {
    google {
      content {
        includeGroupByRegex("androidx.*")
        includeGroupByRegex("com\\.android.*")
        includeGroupByRegex("com\\.google.*")
      }
    }
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google {
      content {
        includeGroupByRegex("androidx.*")
        includeGroupByRegex("com\\.android.*")
        includeGroupByRegex("com\\.google.*")
      }
    }
    mavenCentral()
  }
}

plugins {
  id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "bfstats-sidecar"

// core: the sidecar itself, plain JVM with no Android APIs, so its tests run
// on any JDK and the same code can later back the desktop app.
// app: the Android shell (server list, WebView, foreground service).
// -PcoreOnly=true leaves the app out: the desktop app's build of the native
// sidecar (tools/sidecar-desktop, npm run build-sidecar) needs no Android SDK.
include(":core")
if (providers.gradleProperty("coreOnly").orNull != "true") include(":app")
