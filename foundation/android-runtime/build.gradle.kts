plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kalamos.foundation.runtime"
    compileSdk = 34

    defaultConfig {
        minSdk = 29
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { viewBinding = true }
}

dependencies {
    api(project(":foundation:device-api"))
    implementation(project(":foundation:documents"))
    api("androidx.appcompat:appcompat:1.6.1")
    api("androidx.fragment:fragment-ktx:1.6.2")
    api("androidx.webkit:webkit:1.9.0")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    api("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.myscript:iink:4.5.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20231013")
    testImplementation("xpp3:xpp3:1.1.4c")
}
