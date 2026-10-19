package com.kalamos.device.bigme

import android.util.Log

/**
 * Enables the framework reflection used by Bigme's handwriting client.
 *
 * This belongs beside the reflective client rather than in an app initializer: hosts such as
 * KOReader create [BigmeInkController] directly and do not run Kalamos' [BigmeDeviceProvider]
 * lifecycle. Calling this from both paths is safe and keeps the prerequisite local to the device
 * implementation that needs it.
 */
internal object BigmeHiddenApiAccess {
    @Volatile
    private var enabled = false

    fun ensureEnabled(): Boolean {
        if (enabled) return true
        return synchronized(this) {
            if (enabled) return@synchronized true
            enabled = try {
                org.lsposed.hiddenapibypass.HiddenApiBypass.addHiddenApiExemptions("L")
                Log.i(TAG, "Hidden API access enabled for Bigme framework services")
                true
            } catch (t: Throwable) {
                Log.w(TAG, "Unable to enable hidden API access: ${t.message}", t)
                false
            }
            enabled
        }
    }

    private const val TAG = "BigmeHiddenApiAccess"
}
