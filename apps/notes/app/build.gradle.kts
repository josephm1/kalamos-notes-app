plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val kalamosDevice = providers.gradleProperty("kalamos.device").orElse("standard").get().lowercase()

android {
    // Notes retains the historical namespace and application ID so existing on-device notebook
    // storage and preferences continue to resolve unchanged.
    namespace = "com.kalamos.notebook"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kalamos.notebook"
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        manifestPlaceholders["inkTrace"] = providers.gradleProperty("kalamos.inkTrace").orElse("false").get()
        ndk { abiFilters += "arm64-v8a" }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { viewBinding = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
        jniLibs { pickFirsts += "**/libc++_shared.so" }
    }
}

dependencies {
    implementation(project(":foundation:android-runtime"))
    implementation(project(":foundation:documents"))
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    implementation(project(":features:content-components:android"))
    implementation(project(":features:writing:android"))
    implementation(project(":devices:$kalamosDevice"))
}
