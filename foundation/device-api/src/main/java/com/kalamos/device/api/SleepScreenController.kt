package com.kalamos.device.api

import android.content.Context

/** Neutral contract for vendor sleep/power-off screen integrations. */
interface SleepScreenController {
    data class Status(
        val providerId: String,
        val defaultPath: String,
        val targetPath: String,
        val enabled: Boolean,
        val hasImage: Boolean,
    )

    fun status(context: Context): Status
    fun configure(context: Context, enabled: Boolean, targetPath: String): Status
    fun writeJpeg(context: Context, targetPath: String, bytes: ByteArray): Status
    fun refresh(context: Context)
    fun openSystemSettings(context: Context): Boolean
}
