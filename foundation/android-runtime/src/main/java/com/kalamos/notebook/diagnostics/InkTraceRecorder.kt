package com.kalamos.notebook.diagnostics

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import com.kalamos.device.api.ink.InkDiagnosticSink
import com.kalamos.device.api.ink.InkDiagnostics
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

/** Opt-in diagnostic capture. No policy setters, drawing, invalidation, save or pen injection. */
class InkTraceRecorder(val directory: File, private val imageLimit: Int = 80) : InkDiagnosticSink {
    private val sequence = AtomicInteger()
    private val images = AtomicInteger()
    private val eventWriter = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(512))
    private val imageWriter = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(8))
    private val index = File(directory, "events.jsonl")
    init { directory.mkdirs() }

    private fun record(name: String, fields: Map<String, Any?>): JSONObject = JSONObject(fields).apply {
        put("event", name); put("seq", sequence.incrementAndGet()); put("wallMs", System.currentTimeMillis())
        put("uptimeMs", SystemClock.uptimeMillis()); put("elapsedNs", SystemClock.elapsedRealtimeNanos())
        put("thread", Thread.currentThread().name)
    }
    private fun append(record: JSONObject) { synchronized(index) { index.appendText(record.toString() + "\n") } }
    private fun submit(record: JSONObject, rejected: () -> Unit = {}, action: () -> Unit = {}) {
        try { eventWriter.execute { try { append(record); action() } catch (e: Exception) { Log.w("InkTrace", "trace write failed", e) } } }
        catch (_: java.util.concurrent.RejectedExecutionException) { rejected(); Log.w("InkTrace", "trace queue full; dropped seq=${record.optInt("seq")}") }
    }
    private fun submitImage(record: JSONObject, rejected: () -> Unit = {}, action: () -> Unit) {
        try {
            imageWriter.execute {
                submit(record)
                try { action() } catch (e: Exception) { Log.w("InkTrace", "capture write failed", e) }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            rejected()
            event("capture.skipped", mapOf("capture" to record.optString("event"),
                "captureSeq" to record.optInt("seq"), "reason" to "bounded image queue"))
        }
    }
    override fun event(name: String, fields: Map<String, Any?>) {
        val r = record(name, fields)
        submit(r) {
            if (name.startsWith("owner.") || name == "daemon.connected" || name == "manager.detach") {
                Log.i("InkTrace", "boundary event=$name seq=${r.optInt("seq")} notebook=${r.optString("notebook")} view=${r.optInt("view")}")
            }
        }
    }
    private fun reserve(name: String, fields: Map<String, Any?>): JSONObject? {
        if (images.incrementAndGet() > imageLimit || imageWriter.queue.remainingCapacity() == 0) {
            event("capture.skipped", fields + mapOf("capture" to name, "reason" to "bounded capture budget"))
            return null
        }
        return record(name, fields)
    }
    override fun bitmap(name: String, bitmap: Bitmap, fields: Map<String, Any?>) {
        val r = reserve(name, fields) ?: return
        val start = SystemClock.elapsedRealtimeNanos()
        val copy = bitmap.copy(Bitmap.Config.ARGB_8888, false) ?: return
        val file = File(directory, "${r.getInt("seq")}.png")
        r.put("captureType", "bitmap"); r.put("file", file.name); r.put("width", copy.width); r.put("height", copy.height)
        r.put("density", bitmap.density); r.put("copyNs", SystemClock.elapsedRealtimeNanos() - start)
        submitImage(r, rejected = { copy.recycle() }) {
            try { file.outputStream().use { copy.compress(Bitmap.CompressFormat.PNG, 100, it) }; completed(file, r) }
            finally { copy.recycle() } // only our private diagnostic copy; never a submitted bitmap
        }
    }
    override fun buffer(name: String, pixels: ByteBuffer, width: Int, height: Int, fields: Map<String, Any?>) {
        if (width <= 0 || height <= 0 || width.toLong() * height * 4 > 16 * 1024 * 1024) return
        val r = reserve(name, fields) ?: return
        val start = SystemClock.elapsedRealtimeNanos()
        val reader = pixels.asReadOnlyBuffer().apply { position(0) }
        val bytes = ByteArray(reader.remaining()); reader.get(bytes)
        val file = File(directory, "${r.getInt("seq")}.rgba")
        r.put("captureType", "buffer"); r.put("file", file.name); r.put("width", width); r.put("height", height); r.put("bytes", bytes.size)
        r.put("pixelFormat", "RGBA8888 physical canvas"); r.put("copyNs", SystemClock.elapsedRealtimeNanos() - start)
        submitImage(r) { file.writeBytes(bytes); completed(file, r) }
    }
    private fun completed(file: File, source: JSONObject) {
        val hash = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
        submit(record("capture.complete", mapOf("file" to file.name, "captureSeq" to source.getInt("seq"), "sha256" to hash)))
    }
    /** Host/tests may finish a diagnostic collection; no runtime ink lifecycle depends on this. */
    fun finish() {
        imageWriter.shutdown(); check(imageWriter.awaitTermination(30, TimeUnit.SECONDS))
        eventWriter.shutdown(); check(eventWriter.awaitTermination(30, TimeUnit.SECONDS))
    }

    companion object {
        @Synchronized fun startIfEnabled(context: Context) {
            if (InkDiagnostics.enabled) return
            val app = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
            if (app.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0 || app.metaData?.getBoolean("kalamos.inkTrace", false) != true) return
            val root = context.getExternalFilesDir(null) ?: return
            val recorder = InkTraceRecorder(File(root, "ink-trace/${System.currentTimeMillis()}-${android.os.Process.myPid()}"))
            InkDiagnostics.sink = recorder
            recorder.event("trace.start", mapOf("package" to context.packageName, "pid" to android.os.Process.myPid(),
                "sdk" to android.os.Build.VERSION.SDK_INT, "device" to android.os.Build.MODEL, "imageLimit" to 80,
                "directory" to recorder.directory.absolutePath))
            Log.i("InkTrace", "enabled: ${recorder.directory}")
        }
    }
}
