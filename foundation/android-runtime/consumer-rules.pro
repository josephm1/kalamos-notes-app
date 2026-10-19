# Shared runtime currently relies on stable bridge method names exposed to WebView JavaScript.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
