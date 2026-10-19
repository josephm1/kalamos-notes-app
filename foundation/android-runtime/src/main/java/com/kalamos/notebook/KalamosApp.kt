package com.kalamos.notebook

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.kalamos.device.api.DeviceRegistry
import com.kalamos.device.api.ink.PerfCounters
import com.kalamos.device.api.ink.PerfSink

/** `open` so app-owned subclasses can extend it (AD-1) — e.g. kalamos-books' `BooksApp` registers
 *  the pdfbox-backed [com.kalamos.notebook.bookfmt.PdfTextService] from its own `onCreate` after
 *  calling through to this one via `super.onCreate()`. Plain `KalamosApp` remains the manifest
 *  default for apps with no app-owned Application subclass (notes/todo/scribe). */
open class KalamosApp : Application() {
    override fun onCreate() {
        super.onCreate()

        // App-wide immersive display policy: every activity starts edge-to-edge with BOTH Android
        // system bars (status/notification + navigation) hidden, and the policy is restored after
        // any transient system reveal. Owned here so all Kalamos apps share the same full-screen
        // behavior (previously this lived only in kalamos-write's WriteApp). Subclasses inherit it
        // for free as long as they call through via super.onCreate().
        registerActivityLifecycleCallbacks(immersivePolicy)

        // The selected device module owns vendor initialization. Keeping this behind the registry
        // prevents Bigme/Boox APIs from leaking into the shared application runtime.
        DeviceRegistry.initialize(this)
        PerfCounters.sink = PerfSink { _, _ -> }  // disable hot-path metrics in production

        // One-time: shrink old bloated notebook files (pressure/timestamp + pretty-print) to the
        // compact format so cold opens read less off disk. Background thread — never blocks launch.
        Thread {
            try {
                com.kalamos.notebook.storage.StorageManager(this).compactAllNotebooksOnce()
            } catch (t: Throwable) {
                Log.w(TAG, "notebook compaction failed: ${t.message}")
            }
        }.apply { priority = Thread.MIN_PRIORITY; start() }
    }

    /** Hides the status + navigation bars on every activity and keeps them hidden. Ported verbatim
     *  from kalamos-write's WriteApp so full-screen behavior is identical across all apps. */
    private val immersivePolicy = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityPreCreated(activity: Activity, savedInstanceState: Bundle?) =
            installImmersivePolicy(activity)

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) =
            installImmersivePolicy(activity)

        override fun onActivityResumed(activity: Activity) = hideSystemBars(activity)

        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }

    private fun installImmersivePolicy(activity: Activity) {
        val decor = activity.window.decorView
        @Suppress("DEPRECATION")
        decor.setOnSystemUiVisibilityChangeListener { visibility ->
            if (visibility and View.SYSTEM_UI_FLAG_HIDE_NAVIGATION == 0) {
                decor.post { hideSystemBars(activity) }
            }
        }
        hideSystemBars(activity)
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars(activity: Activity) {
        val window = activity.window
        val decor = window.decorView
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, decor).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }

        // Keep the ROM's legacy navigation implementation in sync with WindowInsetsController.
        // Bigme/HiBreak still consult these flags when deciding whether the bottom bar stays shown.
        val immersiveFlags =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        if (decor.systemUiVisibility and immersiveFlags != immersiveFlags) {
            decor.systemUiVisibility = decor.systemUiVisibility or immersiveFlags
        }
    }

    companion object {
        private const val TAG = "KalamosApp"
    }
}
