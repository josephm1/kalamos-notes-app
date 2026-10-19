package com.kalamos.notebook.hwr

import android.content.Context
import android.util.Log
import com.myscript.iink.Engine
import com.myscript.iink.MimeType
import com.myscript.iink.Recognizer as IinkRecognizer
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import java.util.zip.ZipInputStream

/**
 * MyScript iink implementation of [Recognizer] — fully on-device, no Play services.
 *
 * Needs two app-owned pieces to go live (absent → clean "unavailable"/"absent", never a crash):
 *  1. The license certificate from developer.myscript.com, dropped in as the standard
 *     `com.myscript.certificate.MyCertificate` class (looked up by reflection so every app
 *     builds without one).
 *  2. Language packs (text recognition assets): either bundled in the APK under
 *     `assets/myscript/conf/` or fetched at runtime by [download] from MyScript's public CDN
 *     into `<filesDir>/myscript/` (needs INTERNET; apps without it bundle instead).
 *
 * The engine + per-language recognizers are process-wide singletons (sessions come and go with
 * the WebView; the native engine shouldn't). All iink calls run on one background executor —
 * statusSync answers from a cache so the JS-bridge thread never touches native code.
 */
class MyScriptRecognizer(
    private val context: Context,
    private val emit: (JSONObject) -> Unit
) : Recognizer {

    private val seq = AtomicLong(1)
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("kalamos_hwr", Context.MODE_PRIVATE)

    private fun ev(id: String, type: String) =
        JSONObject().put("id", id).put("kind", "hwr").put("type", type)

    /** iink wants en_US; the JS contract (inherited from ML Kit) sends en-US. */
    private fun iinkLang(lang: String) = lang.replace('-', '_')

    private fun downloadedConf(lang: String) =
        File(app.filesDir, "myscript/recognition-assets/conf/${iinkLang(lang)}.conf")

    private fun bundledConfExists(lang: String): Boolean = try {
        app.assets.list("myscript/conf")?.contains("${iinkLang(lang)}.conf") == true
    } catch (t: Throwable) { false }

    private fun bundledConfExistsExact(name: String): Boolean = try {
        app.assets.list("myscript/conf")?.contains("$name.conf") == true
    } catch (t: Throwable) { false }

    private fun langAssetsPresent(lang: String) =
        downloadedConf(lang).exists() || bundledConfExists(lang)

    override fun statusSync(lang: String): String {
        val cached = state[lang]
        if (cached == null) {
            // Provisional answer from the remembered download + a cheap file stat; the engine
            // itself is only touched on the executor (refresh) so this stays bridge-thread fast.
            state[lang] = when {
                engineFailed -> "unavailable"
                prefs.getBoolean("ms_$lang", false) || langAssetsPresent(lang) -> "ready"
                else -> "absent"
            }
            exec.execute { refresh(lang) }
        }
        return state[lang] ?: "absent"
    }

    private fun refresh(lang: String) {
        if (engine() == null) { state[lang] = "unavailable"; return }
        if (state[lang] == "downloading") return
        val present = langAssetsPresent(lang)
        state[lang] = if (present) "ready" else "absent"
        prefs.edit().putBoolean("ms_$lang", present).apply()
    }

    override fun download(lang: String): String {
        val reqId = "hd" + seq.getAndIncrement()
        if (engineFailed) return """{"err":"unavailable"}"""
        state[lang] = "downloading"
        exec.execute {
            try {
                if (engine() == null) throw IllegalStateException("no MyScript certificate")
                if (!langAssetsPresent(lang)) fetchLangPack(lang, reqId)
                state[lang] = "ready"
                prefs.edit().putBoolean("ms_$lang", true).apply()
                emit(ev(reqId, "done"))
            } catch (t: Throwable) {
                state[lang] = if (langAssetsPresent(lang)) "ready" else "absent"
                emit(ev(reqId, "error").put("message", t.message ?: "download failed"))
            }
        }
        return JSONObject().put("reqId", reqId).toString()
    }

    /** Pull `myscript-iink-recognition-text-<lang>.zip` off MyScript's public CDN and unpack
     *  its recognition-assets entries under `<filesDir>/myscript/`. ~15 MB for en_US. */
    private fun fetchLangPack(lang: String, reqId: String) {
        val url = URL("$CDN/myscript-iink-recognition-text-${iinkLang(lang)}.zip")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        try {
            if (conn.responseCode != 200) throw IllegalStateException("no language pack for $lang (HTTP ${conn.responseCode})")
            val total = conn.contentLength.toLong()
            var read = 0L
            var lastPct = -1
            val base = File(app.filesDir, "myscript")
            ZipInputStream(conn.inputStream.buffered()).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    val name = entry.name
                    // Only recognition-assets/**, and keep the path inside our folder.
                    if (!entry.isDirectory && name.startsWith("recognition-assets/") && !name.contains("..")) {
                        val out = File(base, name)
                        out.parentFile?.mkdirs()
                        out.outputStream().use { o ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = zip.read(buf)
                                if (n < 0) break
                                o.write(buf, 0, n)
                                read += n
                                if (total > 0) {
                                    val pct = ((read * 100) / total).toInt().coerceAtMost(99)
                                    if (pct >= lastPct + 10) {
                                        lastPct = pct
                                        emit(ev(reqId, "progress").put("pct", pct))
                                    }
                                }
                            }
                        }
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
            if (!downloadedConf(lang).exists())
                throw IllegalStateException("language pack for $lang unpacked without a conf")
        } finally {
            conn.disconnect()
        }
    }

    override fun recognize(args: JSONObject): String {
        val reqId = "hr" + seq.getAndIncrement()
        if (engineFailed) return """{"err":"unavailable"}"""
        val lang = args.optString("lang", "en-US")
        val mode = when (args.optString("mode", "text").lowercase()) {
            "gesture" -> "gesture"
            "shape" -> "shape"
            else -> "text"
        }
        val strokes = try { args.getJSONArray("strokes") } catch (e: Exception) {
            return """{"err":"bad-strokes: missing"}"""
        }
        exec.execute {
            try {
                val rec = recognizerFor(mode, lang) ?: throw IllegalStateException(
                    if (engine() == null) "no MyScript certificate" else "no assets for $mode")
                rec.clear()
                feedStrokes(rec, strokes)
                rec.waitForIdle()
                val jiix = rec.getResult(MimeType.JIIX)
                rec.clear()
                emit(jiixResult(reqId, mode, jiix))
            } catch (t: Throwable) {
                emit(ev(reqId, "error").put("message", t.message ?: "recognition failed"))
            }
        }
        return JSONObject().put("reqId", reqId).toString()
    }

    private fun feedStrokes(rec: IinkRecognizer, strokes: JSONArray) {
        // The daemon gives no per-point timestamps — synthesise a plausible monotone clock
        // (engines use timing loosely; ~5ms per point is inside normal writing speed).
        var t = System.currentTimeMillis() - strokes.length() * 400L
        for (i in 0 until strokes.length()) {
            val pts = strokes.getJSONArray(i)
            if (pts.length() == 0) continue
            for (j in 0 until pts.length()) {
                val p = pts.getJSONArray(j)
                val x = p.getDouble(0).toFloat()
                val y = p.getDouble(1).toFloat()
                val f = (if (p.length() > 2) p.optDouble(2, 0.0) else 0.0).toFloat().coerceIn(0f, 1f)
                when (j) {
                    0 -> rec.pointerDown(x, y, t, f)
                    pts.length() - 1 -> rec.pointerUp(x, y, t, f)
                    else -> rec.pointerMove(x, y, t, f)
                }
                t += 5
            }
            if (pts.length() == 1) {
                // single-point stroke: iink needs the up event too
                val p = pts.getJSONArray(0)
                rec.pointerUp(p.getDouble(0).toFloat(), p.getDouble(1).toFloat(), t, 0f)
            }
            t += 120                                  // inter-stroke pen-up gap
        }
    }

    /** Convert MyScript's JIIX into the stable, deliberately small web contract. Text keeps its
     * legacy phrase candidates and adds word-level alternatives; gesture/shape return labels that
     * the web layer filters against commands allowed in the current spatial context. */
    private fun jiixResult(reqId: String, mode: String, jiix: String): JSONObject {
        val result = ev(reqId, "result").put("mode", mode)
        if (mode != "text") {
            val labels = linkedSetOf<String>()
            try { collectLabels(JSONObject(jiix), mode, labels) } catch (_: Exception) {}
            val cands = JSONArray()
            labels.take(6).forEach { cands.put(JSONObject().put("label", it)) }
            return result.put("candidates", cands)
        }

        val cands = JSONArray()
        val outWords = JSONArray()
        try {
            val o = JSONObject(jiix)
            val label = o.optString("label", "")
            cands.put(JSONObject().put("text", label))
            val words = o.optJSONArray("words")
            if (words != null) for (i in 0 until words.length()) {
                val word = words.optJSONObject(i) ?: continue
                val wordOut = JSONObject().put("label", word.optString("label", ""))
                val alternatives = JSONArray()
                val alts = word.optJSONArray("candidates")
                if (alts != null) for (k in 0 until minOf(alts.length(), 4)) {
                    alternatives.put(alts.optString(k))
                }
                wordOut.put("candidates", alternatives)
                word.optJSONObject("bounding-box")?.let { bb ->
                    wordOut.put("boundingBox", JSONObject()
                        .put("x", bb.optDouble("x"))
                        .put("y", bb.optDouble("y"))
                        .put("width", bb.optDouble("width"))
                        .put("height", bb.optDouble("height")))
                }
                outWords.put(wordOut)
            }
            if (words != null && words.length() == 1) {
                val alts = words.getJSONObject(0).optJSONArray("candidates")
                if (alts != null) for (k in 0 until minOf(alts.length(), 4)) {
                    val alt = alts.getString(k)
                    if (alt != label) cands.put(JSONObject().put("text", alt))
                }
            }
        } catch (e: Exception) {
            if (cands.length() == 0) cands.put(JSONObject().put("text", jiix.trim()))
        }
        return result.put("candidates", cands).put("words", outWords)
    }

    private fun collectLabels(value: Any?, mode: String, out: MutableSet<String>) {
        when (value) {
            is JSONObject -> {
                if (mode == "gesture") {
                    val type = value.optString("type", "")
                    if (type in setOf("tap", "double-tap", "long-press", "top-bottom", "bottom-top",
                            "left-right", "right-left", "scratch", "surround")) out.add(type)
                } else {
                    val shape = value.optString("shape", "")
                    if (shape.isNotBlank()) out.add(shape)
                    val label = value.optString("label", "")
                    if (label.isNotBlank() && label.length < 48) out.add(label)
                }
                val keys = value.keys()
                while (keys.hasNext()) { val key = keys.next(); collectLabels(value.opt(key), mode, out) }
            }
            is JSONArray -> for (i in 0 until value.length()) collectLabels(value.opt(i), mode, out)
        }
    }

    // ---- process-wide engine + recognizer cache -------------------------------------------------

    private fun engine(): Engine? = engineFor(app)

    private fun recognizerFor(mode: String, lang: String): IinkRecognizer? {
        val eng = engine() ?: return null
        if (mode == "text" && !langAssetsPresent(lang)) return null
        if (mode == "shape" && !bundledConfExistsExact("shape") &&
            !File(app.filesDir, "myscript/recognition-assets/conf/shape.conf").exists()) return null
        val key = "$mode:${iinkLang(lang)}"
        return recognizers.getOrPut(key) {
            // createRecognizer uses the recognizer-specific configuration namespace. Setting only
            // `lang` configures Editor recognition but leaves batch IRecognizer on its default.
            if (mode == "text") eng.configuration.setString("recognizer.lang", iinkLang(lang))
            eng.configuration.setBoolean("export.jiix.bounding-box", true)
            eng.configuration.setBoolean("export.jiix.text.words", true)
            eng.configuration.setBoolean("export.jiix.shape.candidates", true)
            // px → mm scale from the physical display density.
            val dm = app.resources.displayMetrics
            val scaleX = 25.4f / (if (dm.xdpi > 0) dm.xdpi else 300f)
            val scaleY = 25.4f / (if (dm.ydpi > 0) dm.ydpi else 300f)
            eng.createRecognizer(scaleX, scaleY, mode.replaceFirstChar { it.uppercase() })
        }
    }

    companion object {
        private const val TAG = "KalamosHwr"
        private const val CDN = "https://download.myscript.com/iink/recognitionAssets_iink_4.1"

        private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "kalamos-hwr") }
        private val state = ConcurrentHashMap<String, String>()
        private val recognizers = ConcurrentHashMap<String, IinkRecognizer>()

        @Volatile private var sharedEngine: Engine? = null
        @Volatile private var engineFailed = false

        /** The portal-issued certificate class every iink app ships. Reflection so apps
         *  without a license still compile and run (they just report "unavailable"). */
        private fun certificateBytes(): ByteArray? = try {
            val cls = Class.forName("com.myscript.certificate.MyCertificate")
            cls.getMethod("getBytes").invoke(null) as? ByteArray
        } catch (t: Throwable) {
            Log.e(TAG, "MyScript certificate lookup failed", t)
            null
        }

        @Synchronized
        private fun engineFor(app: Context): Engine? {
            if (sharedEngine != null) return sharedEngine
            if (engineFailed) return null
            try {
                val cert = certificateBytes() ?: throw IllegalStateException("no certificate")
                val eng = Engine.create(cert)
                val conf = eng.configuration
                val searchPaths = arrayOf(
                    File(app.filesDir, "myscript/recognition-assets/conf").absolutePath,
                    "zip://${app.packageCodePath}!/assets/myscript/conf"
                )
                // Kalamos uses Engine.createRecognizer (batch recognition), whose MyScript 4.x
                // configuration lives under `recognizer.*`. Keep the unprefixed path too because it
                // is the Editor/OffScreenEditor namespace. Removing the prefixed key makes status
                // misleadingly report ready while actual requests fail with an empty search path.
                conf.setStringArray("configuration-manager.search-path", searchPaths)
                conf.setStringArray("recognizer.configuration-manager.search-path", searchPaths)
                conf.setString("content-package.temp-folder",
                    File(app.cacheDir, "myscript-tmp").apply { mkdirs() }.absolutePath)
                sharedEngine = eng
                Log.i(TAG, "MyScript engine initialized for ${app.packageName}")
            } catch (t: Throwable) {
                engineFailed = true
                Log.e(TAG, "MyScript engine initialization failed for ${app.packageName}", t)
            }
            return sharedEngine
        }
    }
}
