package com.kalamos.notebook.hwr

import android.content.Context
import org.json.JSONObject

/** Optional host-owned recognition provider. Ink and AI page formatting do not require one. */
object HwrEngines {
    @Volatile
    var factory: ((Context, (JSONObject) -> Unit) -> Recognizer)? = null

    fun create(context: Context, emit: (JSONObject) -> Unit): Recognizer =
        try { factory?.invoke(context, emit) ?: NoopRecognizer() }
        catch (_: Exception) { NoopRecognizer() }
}
