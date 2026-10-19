package com.kalamos.device.bigme

import android.content.Context
import android.os.IBinder
import android.util.Log

/**
 * Wrapper over the Bigme "E-Ink Center" per-app display policy
 * (`xrz.framework.manager.IDisplayPolicyManager`, service `xrz_display_policy_service`). Lets the app
 * set its OWN package's refresh mode, e-ink animation, auto-clean, anti-flicker, contrast, etc. — the
 * same knobs the E-Ink Center settings app exposes.
 *
 * Fully reflective + best-effort: every call no-ops on a non-Bigme device or if the hidden API is
 * absent, so it's safe to ship. Discovered via on-device reflection (see EINKPROBE).
 */
object EinkCenter {
    private const val TAG = "EinkCenter"

    // EinkRefreshMode waveforms / modes (values read from xrz.framework.manager.EinkRefreshMode).
    const val MODE_DU = 2            // direct update — fast, non-flashy, grey→B/W
    const val MODE_GC16 = 4          // full 16-grey (flashes)
    const val MODE_A2 = 16           // fast 1-bit animation waveform
    const val MODE_GL16 = 32
    const val MODE_GLR16 = 64
    const val MODE_GLD16 = 128
    const val MODE_GU16 = 132        // 16-grey, no-flash
    const val MODE_GU4 = 136
    const val MODE_CLEAN = 176       // full clean
    const val MODE_DEFAULT = 178     // device default (reading)
    const val MODE_FAST = 179        // "video" — fastest page redraw, for animation
    const val MODE_COMIC = 180       // comic — faster than default, still clean (our app default)
    const val MODE_HANDWRITE = 1029  // low-latency pen
    const val MODE_AUTO = 32768

    private var mgr: Any? = null
    private var pkg = ""
    private var triedInit = false

    val available: Boolean get() = mgr != null

    fun init(context: Context) {
        if (triedInit) return
        triedInit = true
        pkg = context.packageName
        try {
            val sm = Class.forName("android.os.ServiceManager")
            val binder = sm.getMethod("getService", String::class.java)
                .invoke(null, "xrz_display_policy_service") as? IBinder ?: return
            val stub = Class.forName("xrz.framework.manager.IDisplayPolicyManager\$Stub")
            mgr = stub.getMethod("asInterface", IBinder::class.java).invoke(null, binder)
            Log.i(TAG, "init: available=${mgr != null} pkg=$pkg")
        } catch (e: Throwable) {
            Log.w(TAG, "init failed (non-Bigme or hidden API absent): ${e.message}")
        }
    }

    /** Call a `<name>ForPackage(String, int): boolean`-shaped policy setter for our own package. */
    private fun pkgInt(method: String, value: Int): Boolean {
        val m = mgr ?: return false
        return try {
            val accepted = m.javaClass.getMethod(method, String::class.java, Int::class.javaPrimitiveType)
                .invoke(m, pkg, value) == true
            if (!accepted) Log.w(TAG, "$method($value) rejected for $pkg")
            accepted
        } catch (e: Throwable) {
            Log.w(TAG, "$method($value): ${e.message}")
            false
        }
    }

    // ---- The full E-Ink Center knob set (all per-package) ----
    fun setRefreshMode(mode: Int): Boolean {
        val settingAccepted = pkgInt("setIsRefreshSettingForPackage", 1)
        val modeAccepted = pkgInt("setRefreshModeForPackage", mode)
        return settingAccepted && modeAccepted
    }
    fun setRefreshFrequency(hz: Int) = pkgInt("setRefreshFrequencyForPackage", hz)
    fun setEinkAnimation(on: Boolean) = pkgInt("setEinkAnimationForPackage", if (on) 1 else 0)
    fun setAutoClean(on: Boolean) = pkgInt("setAutoCleanForPackage", if (on) 1 else 0)
    fun setAntiFlicker(on: Boolean) = pkgInt("setAntiFlickerForPackage", if (on) 1 else 0)
    fun setAnimFilter(on: Boolean) = pkgInt("setAnimFilterForPackage", if (on) 1 else 0)
    fun setContrast(v: Int) = pkgInt("setContrastForPackage", v)
    fun setColorMode(v: Int) = pkgInt("setColorModeForPackage", v)
    fun setColorEnhance(v: Int) = pkgInt("setColorEnhanceForPackage", v)
    fun setDarkLevel(v: Int) = pkgInt("setDarkLevelForPackage", v)
    fun setBrightnessLevel(v: Int) = pkgInt("setBrightnessLevelForPackage", v)
    fun setTextEnhance(on: Boolean) = pkgInt("setTextEnhanceForPackage", if (on) 1 else 0)
    fun setScrollFlip(on: Boolean) = pkgInt("setScrollFlipForPackage", if (on) 1 else 0)
    fun setBleachMode(on: Boolean) = pkgInt("setBleachModeForPackage", if (on) 1 else 0)

    fun setEinkAnimationTimeout(flag: Int, timeoutMs: Long) {
        val m = mgr ?: return
        try {
            m.javaClass.getMethod("setEinkAnimationTimeout", Int::class.javaPrimitiveType, Long::class.javaPrimitiveType)
                .invoke(m, flag, timeoutMs)
        } catch (e: Throwable) { Log.w(TAG, "setEinkAnimationTimeout: ${e.message}") }
    }

    fun getRefreshMode(): Int {
        val m = mgr ?: return -1
        return try {
            m.javaClass.getMethod("getRefreshModeForPackage", String::class.java).invoke(m, pkg) as? Int ?: -1
        } catch (e: Throwable) { -1 }
    }

    // ---- High-level presets used by the editor ----

    /** Put the app into a fast, non-flashing mode for a page that has an animation.
     *  The visible animation is driven by the daemon's per-frame inValidate(rect, animRefreshMode)
     *  (sysprop-tunable — that's the lever to experiment with). These global knobs are the stable
     *  baseline around it: MODE_FAST is the device "video" waveform, autoClean off stops the periodic
     *  full-refresh flash, and antiFlicker off lets the panel refresh aggressively during playback. */
    fun enterAnimationMode() {
        setEinkAnimation(true)                 // engage the device's native e-ink animation pipeline
        setEinkAnimationTimeout(1, 600000L)    // don't let it auto-expire while the page is shown
        setRefreshMode(MODE_FAST)              // "video" waveform
        setAutoClean(false)                    // stop the periodic full-refresh flash
        setAntiFlicker(false)
        Log.i(TAG, "enterAnimationMode (FAST, autoClean off)")
    }

    /** The app's everyday refresh mode: COMIC — faster page redraw than the device default while
     *  staying clean. Used for reading/writing pages and reverted to whenever an animation stops. */
    fun setDefaultMode() {
        setEinkAnimation(false)
        val accepted = setRefreshMode(MODE_COMIC)
        setAutoClean(true)
        setAntiFlicker(true)
        Log.i(TAG, "setDefaultMode requested=$MODE_COMIC accepted=$accepted observed=${getRefreshMode()} (autoClean requested on)")
    }

    /** Restore the everyday mode after an animation. */
    fun exitAnimationMode() = setDefaultMode()
}
