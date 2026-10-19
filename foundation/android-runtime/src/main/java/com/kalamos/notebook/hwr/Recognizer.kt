package com.kalamos.notebook.hwr

import org.json.JSONObject

/**
 * Optional handwriting-recognition contract shared by hosts. A host may register an engine
 * through [HwrEngines]; without one, [NoopRecognizer] reports unavailable and ink stays editable.
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

/** Unavailable provider when no host engine is registered. Ink stays ink. */
class NoopRecognizer : Recognizer {
    override fun statusSync(lang: String) = "unavailable"
    override fun download(lang: String) = """{"err":"unavailable"}"""
    override fun recognize(args: JSONObject) = """{"err":"unavailable"}"""
}
