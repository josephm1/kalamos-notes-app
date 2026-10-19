package com.kalamos.notebook.sharing

import android.content.Intent

/** Plain text MIME reaches Android text targets; EXTRA_TEXT retains Markdown syntax verbatim. */
internal object NotesMarkdownShare {
    fun intent(title:String,text:String):Intent {
        require(text.isNotBlank()) { "This note has no Markdown text" }
        require(text.toByteArray(Charsets.UTF_8).size<=200_000) { "Markdown is too large to share as text" }
        require(!text.contains('\u0000')) { "Invalid Markdown text" }
        val send=Intent(Intent.ACTION_SEND).apply {
            type="text/plain"
            putExtra(Intent.EXTRA_TEXT,text)
            putExtra(Intent.EXTRA_TITLE,title.take(200))
            putExtra(Intent.EXTRA_SUBJECT,title.take(200))
        }
        return Intent.createChooser(send,"Share Markdown")
    }
}
