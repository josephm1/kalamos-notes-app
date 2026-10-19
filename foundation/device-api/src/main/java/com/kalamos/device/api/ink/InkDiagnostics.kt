package com.kalamos.device.api.ink

import android.graphics.Bitmap
import java.nio.ByteBuffer

/** Optional passive observer. Default builds install no sink; observers never control ink state. */
interface InkDiagnosticSink {
    fun event(name: String, fields: Map<String, Any?>)
    fun bitmap(name: String, bitmap: Bitmap, fields: Map<String, Any?>)
    fun buffer(name: String, pixels: ByteBuffer, width: Int, height: Int, fields: Map<String, Any?>)
}

object InkDiagnostics {
    @Volatile var sink: InkDiagnosticSink? = null
    val enabled: Boolean get() = sink != null
    fun event(name: String, fields: Map<String, Any?> = emptyMap()) {
        try { sink?.event(name, fields) } catch (_: Exception) { /* diagnostics cannot break input */ }
    }
    fun bitmap(name: String, bitmap: Bitmap, fields: Map<String, Any?> = emptyMap()) {
        try { sink?.bitmap(name, bitmap, fields) } catch (_: Exception) { }
    }
    fun buffer(name: String, pixels: ByteBuffer, width: Int, height: Int, fields: Map<String, Any?> = emptyMap()) {
        try { sink?.buffer(name, pixels, width, height, fields) } catch (_: Exception) { }
    }
}
