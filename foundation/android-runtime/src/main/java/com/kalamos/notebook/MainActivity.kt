package com.kalamos.notebook

import android.os.Bundle
import android.content.Intent
import android.view.KeyEvent
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.kalamos.device.api.DeviceRegistry
import com.kalamos.foundation.runtime.R
import com.kalamos.notebook.storage.StorageConfig
import java.io.File

open class MainActivity : AppCompatActivity() {

    private var publicStorageRequestLaunched = false

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        (supportFragmentManager.findFragmentById(R.id.fragmentContainer) as? AppFragment)
            ?.onNewIntent()
    }

    /** When true the system status + navigation bars are hidden (full-screen reading). Kept as state so
     *  onWindowFocusChanged can re-apply it after a transient swipe-reveal. Toggled by the JS bridge
     *  (Bridge.setImmersive) when the book reader opens/closes. */
    private var immersive = false

    /** Hide (on) / restore (off) the system bars for full-screen reading. Named to avoid hiding the
     *  framework's final-in-practice [android.app.Activity.setImmersive] (the immersive-confirmation flag). */
    fun setReaderImmersive(on: Boolean) {
        immersive = on
        applyImmersive()
    }

    private fun applyImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, !immersive)
        // Use the window's own insets controller (not the deprecated `WindowInsetsControllerCompat(window,
        // view)` constructor, whose hide() can be a silent no-op on some ROMs).
        val ctl = WindowCompat.getInsetsController(window, window.decorView)
        ctl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (immersive) {
            ctl.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            ctl.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && immersive) applyImmersive()   // keep the bars hidden after a transient reveal
    }

    /** The device's hardware page-turn buttons → page nav. PAGE_DOWN = next, PAGE_UP = previous;
     *  in a notebook, page-down on the last page creates a new one. Unrecognised keys are logged so
     *  we can map them if this device uses different codes. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            val dir = when (event.keyCode) {
                KeyEvent.KEYCODE_PAGE_DOWN -> "down"
                KeyEvent.KEYCODE_PAGE_UP -> "up"
                else -> null
            }
            if (dir != null) {
                (supportFragmentManager.findFragmentById(R.id.fragmentContainer) as? AppFragment)?.onPageKey(dir)
                return true
            }
            if (event.keyCode != KeyEvent.KEYCODE_BACK)
                android.util.Log.i("PERF", "DIAG keyDown code=${event.keyCode}")  // DIAG: identify page buttons
        }
        return super.dispatchKeyEvent(event)
    }

    protected open fun createAppFragment(): AppFragment = AppFragment.newInstance()

    override fun onCreate(savedInstanceState: Bundle?) {
        // Pass null so the FragmentManager does NOT auto-restore a prior fragment state; we always
        // start fresh with the single AppFragment (which boots into the library). Work is autosaved.
        super.onCreate(null)
        // Apply the saved rotation-lock preference as early as possible (default: locked to portrait so
        // the accelerometer is ignored). The Settings toggle / bridge can switch it at runtime.
        val rotLocked = getSharedPreferences("kalamos_prefs", android.content.Context.MODE_PRIVATE)
            .getBoolean("rotation_locked", true)
        requestedOrientation =
            if (rotLocked) android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        // A selected vendor provider may report that its ROM ignores per-app orientation. Standard
        // Android relies only on requestedOrientation and never needs Modify system settings.
        val needsSystemRotation = DeviceRegistry.require(this).requiresSystemRotationControl
        if (needsSystemRotation && rotLocked && android.provider.Settings.System.canWrite(this)) {
            try {
                android.provider.Settings.System.putInt(contentResolver,
                    android.provider.Settings.System.ACCELEROMETER_ROTATION, 0)
                android.provider.Settings.System.putInt(contentResolver,
                    android.provider.Settings.System.USER_ROTATION, android.view.Surface.ROTATION_0)
            } catch (e: Exception) { /* ignore */ }
        }
        setContentView(R.layout.activity_main)

        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, createAppFragment())
            .commit()

        // Back is owned by the JS router: editor → library, library → home.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                (supportFragmentManager.findFragmentById(R.id.fragmentContainer) as? AppFragment)
                    ?.handleBack()
            }
        })
    }

    override fun onPostResume() {
        super.onPostResume()
        ensureBooksLibraryAccess()
    }

    /**
     * Books, Learn and Play share one user-visible catalogue. Ask Android for the special broad
     * storage grant on first entry instead of silently splitting that catalogue into private app
     * directories. Returning from Settings re-enters this method and creates the canonical folder.
     */
    private fun ensureBooksLibraryAccess() {
        if (!StorageConfig.requiresBooksLibraryAccess(this)) return
        if (StorageConfig.hasAllFilesAccess()) {
            File(StorageConfig.PUBLIC_ROOT, "books").mkdirs()
            if (publicStorageRequestLaunched) {
                // The first render may have happened while Android still denied the shared folder.
                // Recreate once so every bridge and library view immediately uses the new grant.
                publicStorageRequestLaunched = false
                recreate()
            }
            return
        }
        if (publicStorageRequestLaunched) return
        publicStorageRequestLaunched = true
        android.widget.Toast.makeText(
            this,
            "Allow all-files access so Kalamos can use the shared Books library.",
            android.widget.Toast.LENGTH_LONG
        ).show()
        try {
            startActivity(Intent(
                android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                android.net.Uri.parse("package:$packageName")
            ))
        } catch (_: Exception) {
            try {
                startActivity(Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            } catch (_: Exception) {
                // The app remains on its canonical public path and will retry on its next launch.
            }
        }
    }
}
