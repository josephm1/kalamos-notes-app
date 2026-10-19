package com.kalamos.device.api

import android.content.Context
import android.content.pm.PackageManager

/**
 * Loads the single device provider declared by the selected device module's manifest.
 *
 * This keeps the shared runtime independent of Bigme/Boox classes while retaining compile-time
 * device selection. A missing or invalid provider is a build/integration error, not a silent no-op.
 */
object DeviceRegistry {
    private const val META_PROVIDER = "com.kalamos.device.PROVIDER"

    @Volatile
    private var installed: DeviceProvider? = null

    fun initialize(context: Context): DeviceProvider {
        installed?.let { return it }
        return synchronized(this) {
            installed?.let { return@synchronized it }
            val appContext = context.applicationContext
            val appInfo = appContext.packageManager.getApplicationInfo(
                appContext.packageName,
                PackageManager.GET_META_DATA
            )
            val className = appInfo.metaData?.getString(META_PROVIDER)
                ?: error("No Kalamos device provider declared in AndroidManifest metadata")
            val provider = Class.forName(className).getDeclaredConstructor().newInstance() as? DeviceProvider
                ?: error("$className does not implement DeviceProvider")
            provider.initialize(appContext)
            installed = provider
            provider
        }
    }

    fun require(context: Context): DeviceProvider = installed ?: initialize(context)
}
