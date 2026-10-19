package com.kalamos.foundation.documents

import java.text.Normalizer
import java.util.Locale

/** Human-readable portable filenames; private storage/revision identities are separate. */
object NotesFilename {
    fun stem(title:String):String = Normalizer.normalize(title,Normalizer.Form.NFKC)
        .replace(Regex("[\\x00-\\x1f\\x7f/\\\\:*?\"<>|]"),"-").trim().trimEnd('.', ' ')
        .take(120).ifBlank { "Notebook" }.let { if(it in setOf(".",".."))"Notebook" else it }
    fun key(title:String):String = stem(title).lowercase(Locale.ROOT)
    fun zip(title:String):String = stem(title)+".notes.zip"
    fun unique(title:String, existing:Collection<String>):String {
        val base=stem(title);val used=existing.map(::key).toSet()
        if(key(base) !in used)return base
        var suffix=2
        while(key("${base.take(110)} ($suffix)") in used)suffix++
        return "${base.take(110)} ($suffix)"
    }
}
