package com.kalamos.device.standard

import android.content.Context
import android.util.Log
import android.view.InputDevice
import com.kalamos.device.api.DeviceProvider
import com.kalamos.device.api.ink.InkController

/**
 * Ordinary Android tablet implementation. It uses standard MotionEvent stylus input and normal
 * SurfaceView composition; it never initializes a manufacturer service or changes display policy.
 */
class StandardDeviceProvider : DeviceProvider {
    override val id: String = "standard"

    override fun initialize(context: Context) {
        val stylusDevices = InputDevice.getDeviceIds().asSequence().mapNotNull(InputDevice::getDevice)
            .filter { it.supportsSource(InputDevice.SOURCE_STYLUS) }
            .toList()
        if (stylusDevices.isEmpty()) {
            Log.w(TAG, "No standard Android stylus input device currently reported")
            return
        }
        stylusDevices.forEach { device ->
            val pressure = device.getMotionRange(android.view.MotionEvent.AXIS_PRESSURE)
            val tilt = device.getMotionRange(android.view.MotionEvent.AXIS_TILT)
            val orientation = device.getMotionRange(android.view.MotionEvent.AXIS_ORIENTATION)
            Log.i(
                TAG,
                "Stylus device '${device.name}' pressure=${pressure != null} " +
                    "tilt=${tilt != null} orientation=${orientation != null}",
            )
        }
    }

    override fun createInkController(): InkController = StandardInkController()

    override fun setDefaultDisplay(context: Context) = Unit

    override fun setAnimationDisplay(context: Context, active: Boolean) = Unit

    override fun setInteractiveDisplay(context: Context, active: Boolean) = Unit

    private companion object {
        const val TAG = "StandardDeviceProvider"
    }
}
