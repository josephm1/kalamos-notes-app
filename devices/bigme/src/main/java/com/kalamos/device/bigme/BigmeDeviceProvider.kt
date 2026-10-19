package com.kalamos.device.bigme

import android.content.Context
import android.view.View
import com.kalamos.device.api.DeviceProvider
import com.kalamos.device.api.SleepScreenController
import com.kalamos.device.api.ink.InkController

/** Bigme-specific implementation selected by the Bigme application build. */
class BigmeDeviceProvider : DeviceProvider {
    override val id: String = "bigme"
    override val requiresSystemRotationControl: Boolean = true
    // The existing Bigme handoff intentionally hides the SurfaceView while the e-ink panel retains
    // its last frame. Keep this capability explicit so normal LCD/OLED builds never enter that path.
    override val supportsPersistentDisplayHandoff: Boolean = true
    override val sleepScreenController: SleepScreenController = BigmeSleepScreenController

    override fun initialize(context: Context) {
        // Bigme's reflective handwriting daemon touches hidden framework APIs on Android 14+.
        // Keep this exemption in the device module so Standard/Boox builds do not inherit it.
        BigmeHiddenApiAccess.ensureEnabled()
        EinkCenter.init(context)
        EinkCenter.setDefaultMode()
    }

    override fun isPenInputDevice(deviceId: Int): Boolean = BigmePenInput.isPenDevice(deviceId)

    override fun createInkController(): InkController = BigmeInkController()

    override fun setDefaultDisplay(context: Context) {
        EinkCenter.init(context)
        EinkCenter.setDefaultMode()
    }

    override fun setAnimationDisplay(context: Context, active: Boolean) {
        EinkCenter.init(context)
        if (active) {
            EinkCenter.setAutoClean(false)
            EinkCenter.setAntiFlicker(false)
        } else {
            EinkCenter.setDefaultMode()
        }
    }

    override fun setInteractiveDisplay(context: Context, active: Boolean) {
        EinkCenter.init(context)
        if (active) EinkCenter.enterAnimationMode() else EinkCenter.setDefaultMode()
    }

    override fun configureInteractiveSurface(view: View) {
        BigmeInteractiveSurface.configure(view)
    }

    override fun onAppBackground(context: Context) {
        BigmeSleepScreenController.refresh(context)
    }
}
