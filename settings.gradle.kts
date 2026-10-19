pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "kalamos-notes"

val kalamosDevice = providers.gradleProperty("kalamos.device")
    .orElse("standard")
    .get()
    .lowercase()
require(kalamosDevice in setOf("standard", "bigme")) {
    "Unsupported Kalamos device '$kalamosDevice'. Expected standard or bigme."
}

include(":foundation:device-api")
include(":foundation:android-runtime")
include(":foundation:documents")
include(":features:content-components:android")
include(":features:rich-content:android")
include(":features:writing:android")
include(":devices:$kalamosDevice")
if (kalamosDevice == "bigme") {
    include(":integrations:koreader:android-bridge")
}

include(":apps:notes")
project(":apps:notes").projectDir = file("apps/notes/app")
