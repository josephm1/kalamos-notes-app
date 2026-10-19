package com.kalamos.device.bigme

import android.view.InputDevice

/** Identifies Bigme's dedicated pen device when firmware reports its tool type as a finger. */
object BigmePenInput {
    @JvmStatic
    fun isPenDevice(deviceId: Int): Boolean = isPenDeviceName(InputDevice.getDevice(deviceId)?.name)

    internal fun isPenDeviceName(name: String?): Boolean =
        name?.equals("fts_ts_pen", ignoreCase = true) == true
}
