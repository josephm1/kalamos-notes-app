package com.kalamos.device.bigme

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Environment
import android.util.Log
import com.kalamos.device.api.SleepScreenController
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/** Bigme standby-image handoff. The destination is overwritten in place for vendor compatibility. */
internal object BigmeSleepScreenController : SleepScreenController {
    private const val PREFS = "kalamos_bigme_sleep_screen"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_PATH = "target_path"
    private const val SOURCE_NAME = "current.jpg"
    private const val TAG = "BigmeSleepScreen"

    override fun status(context: Context): SleepScreenController.Status {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val target = resolveTarget(prefs.getString(KEY_PATH, null).orEmpty()).absolutePath
        return SleepScreenController.Status(
            providerId = "bigme",
            defaultPath = defaultTarget().absolutePath,
            targetPath = target,
            enabled = prefs.getBoolean(KEY_ENABLED, false),
            hasImage = sourceFile(context).isFile,
        )
    }

    override fun configure(
        context: Context,
        enabled: Boolean,
        targetPath: String,
    ): SleepScreenController.Status {
        val target = resolveTarget(targetPath)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putString(KEY_PATH, target.absolutePath)
            .apply()
        if (enabled && sourceFile(context).isFile) copyInPlace(sourceFile(context), target)
        return status(context)
    }

    override fun writeJpeg(
        context: Context,
        targetPath: String,
        bytes: ByteArray,
    ): SleepScreenController.Status {
        require(bytes.size in 4..12_000_000) { "Sleep-screen JPEG must be between 4 bytes and 12 MB" }
        require(bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()) { "Sleep-screen image must be JPEG" }
        val target = resolveTarget(targetPath)
        val source = sourceFile(context)
        source.parentFile?.mkdirs()
        val staged = File(source.parentFile, "$SOURCE_NAME.new")
        FileOutputStream(staged, false).use { output ->
            output.write(bytes)
            output.fd.sync()
        }
        if (!staged.renameTo(source)) {
            FileInputStream(staged).use { input ->
                FileOutputStream(source, false).use { output -> input.copyTo(output); output.fd.sync() }
            }
            staged.delete()
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_PATH, target.absolutePath)
            .apply()
        copyInPlace(source, target)
        return status(context)
    }

    override fun refresh(context: Context) {
        val current = status(context)
        val source = sourceFile(context)
        if (!current.enabled || !source.isFile) return
        runCatching { copyInPlace(source, resolveTarget(current.targetPath)) }
            .onFailure { Log.w(TAG, "Could not refresh standby image", it) }
    }

    override fun openSystemSettings(context: Context): Boolean {
        val intent = Intent(Intent.ACTION_MAIN).apply {
            component = ComponentName(
                "com.xrz.standby",
                "com.xrz.settings.screensaver.ScreenSaverStyleSetActivity",
            )
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return runCatching { context.startActivity(intent); true }
            .getOrElse {
                val fallback = context.packageManager.getLaunchIntentForPackage("com.xrz.standby")
                    ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    ?: return false
                runCatching { context.startActivity(fallback); true }.getOrDefault(false)
            }
    }

    private fun sourceFile(context: Context) = File(context.filesDir, "sleep-screen/$SOURCE_NAME")

    private fun defaultTarget() = File(Environment.getExternalStorageDirectory(), "Pictures/Kalamos/screensaver.jpg")

    private fun resolveTarget(raw: String): File {
        val root = Environment.getExternalStorageDirectory().canonicalFile
        val requested = if (raw.isBlank()) defaultTarget() else File(raw.trim())
        val target = if (requested.extension.equals("jpg", true) || requested.extension.equals("jpeg", true)) {
            requested
        } else {
            File(requested, "screensaver.jpg")
        }.canonicalFile
        require(target.path.startsWith(root.path + File.separator)) {
            "Sleep-screen image must be stored inside ${root.path}"
        }
        return target
    }

    private fun copyInPlace(source: File, target: File) {
        target.parentFile?.mkdirs()
        FileInputStream(source).use { input ->
            FileOutputStream(target, false).use { output ->
                input.copyTo(output)
                output.fd.sync()
            }
        }
    }
}
