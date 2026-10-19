package com.kalamos.notebook.hwr

import org.json.JSONObject

/**
 * The handwriting-recognition seam, shared by every app (moved here from kalamos-scribe).
 * MyScript iink is the core engine ([MyScriptRecognizer]); an app can register a fallback
 * engine through [HwrEngines] (Scribe registers ML Kit) — nothing else in an app knows
 * the engine.
 *
 * Stroke format matches the daemon batches JS already has: [[x,y,pressure],...] in box px.
 * Timestamps are optional (the Bigme daemon doesn't provide them) — engines must cope.
 */
interface Recognizer {
    /** 'ready' | 'downloading' | 'absent' | 'unavailable' — synchronous, must be fast. */
    fun statusSync(lang: String): String

    /** Start a model download; returns {reqId} JSON. Events: progress? → done | error. */
    fun download(lang: String): String

    /**
     * Recognize strokes; returns {reqId} JSON. Event:
     *   text: {kind:'hwr', type:'result', mode:'text', candidates:[{text}], words:[...]}
     *   gesture/shape: {kind:'hwr', type:'result', mode, candidates:[{label}]}
     * args: {mode?:'text'|'gesture'|'shape', lang, strokes:[[[x,y,p],...]], area:{w,h}, preContext?}
     */
    fun recognize(args: JSONObject): String
}

/** Fallback when no engine can run (no certificate, unsupported device). Ink stays ink. */
class NoopRecognizer : Recognizer {
    override fun statusSync(lang: String) = "unavailable"
    override fun download(lang: String) = """{"err":"unavailable"}"""
    override fun recognize(args: JSONObject) = """{"err":"unavailable"}"""
}
