package com.kalamos.device.api

import android.content.Context
import android.view.View
import com.kalamos.device.api.ink.InkController

/**
 * Hardware implementation selected by the application build.
 *
 * Feature and foundation modules depend only on this contract. Manufacturer SDK calls, display
 * constants and detection stay in the selected module under the `devices` directory.
 */
interface DeviceProvider {
    val id: String

    /**
     * Whether this device family ignores per-activity orientation and needs Kalamos to control the
     * system auto-rotate setting. Only such device builds should declare WRITE_SETTINGS.
     */
    val requiresSystemRotationControl: Boolean get() = false

    /**
     * Whether the physical display keeps the last submitted SurfaceView pixels visible after that
     * surface is detached and hidden.
     *
     * Bigme's e-ink panel does, and its proven WebView-tool handoff relies on that persistence.
     * Ordinary Android displays do not: hiding the surface removes its pixels immediately, so the
     * shared runtime must leave a controller-free backing frame visible during the handoff.
     */
    val supportsPersistentDisplayHandoff: Boolean get() = false

    /** Optional vendor integration for a user-selected sleep/power-off image. */
    val sleepScreenController: SleepScreenController? get() = null

    /** One-time process initialization, including any hidden-API or vendor service preparation. */
    fun initialize(context: Context)

    /** Creates a fresh controller for one low-latency writing session. */
    fun createInkController(): InkController

    /** Restore the device's normal reading/writing display policy. */
    fun setDefaultDisplay(context: Context)

    /** Adjust display policy while a bounded web animation is active. */
    fun setAnimationDisplay(context: Context, active: Boolean)

    /** Adjust display policy while a WebView-owned reflow/caret tool is active. */
    fun setInteractiveDisplay(context: Context, active: Boolean)

    /** Optional display setup for one app-owned surface whose controls require fast updates.
     * Applies only to the supplied view; ordinary app and handwriting policies remain separate. */
    fun configureInteractiveSurface(view: View) = Unit

    /** Gives device integrations a final synchronous checkpoint when an app is backgrounded. */
    fun onAppBackground(context: Context) = Unit
}
