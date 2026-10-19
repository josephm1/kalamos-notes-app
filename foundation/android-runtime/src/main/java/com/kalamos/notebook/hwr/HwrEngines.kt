package com.kalamos.notebook.hwr

import android.content.Context
import org.json.JSONObject

/**
 * Engine selection for the shared HWR seam — the [com.kalamos.notebook.bookfmt.BookServices]
 * pattern: core owns the preferred engine (MyScript), an app may register a fallback factory
 * at startup (Scribe registers ML Kit), base apps register nothing and degrade to [NoopRecognizer].
 *
 * Selection is per-call, not pick-once: an app with the iink certificate + assets uses MyScript;
 * pull the certificate and the same build silently falls back — no wiring changes.
 */
object HwrEngines {

    /** App-owned fallback engine factory, registered from the app's Application/bridge startup. */
    @Volatile
    var fallbackFactory: ((Context, (JSONObject) -> Unit) -> Recognizer)? = null

    /** The composite recognizer the bridges hand to JS. */
    fun create(context: Context, emit: (JSONObject) -> Unit): Recognizer {
        val primary: Recognizer = try { MyScriptRecognizer(context, emit) }
            catch (t: Throwable) { NoopRecognizer() }   // iink native lib missing on this ABI
        val fallback: Recognizer = try { fallbackFactory?.invoke(context, emit) ?: NoopRecognizer() }
            catch (t: Throwable) { NoopRecognizer() }
        return Composite(primary, fallback)
    }

    private class Composite(
        private val primary: Recognizer,
        private val fallback: Recognizer
    ) : Recognizer {
        // MyScript answers "unavailable" only when it can never run here (no certificate/SDK);
        // "absent" (assets not downloaded yet) stays with MyScript so its download flow is used.
        private fun pick(lang: String): Recognizer =
            if (primary.statusSync(lang) == "unavailable") fallback else primary

        override fun statusSync(lang: String) = pick(lang).statusSync(lang)
        override fun download(lang: String) = pick(lang).download(lang)
        override fun recognize(args: JSONObject) =
            pick(args.optString("lang", "en-US")).recognize(args)
    }
}
