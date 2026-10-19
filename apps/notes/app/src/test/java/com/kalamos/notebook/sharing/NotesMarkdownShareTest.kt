package com.kalamos.notebook.sharing

import android.app.Application
import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class NotesMarkdownShareTest {
    @Test fun markdownUsesStandardTextChooserWithoutFilesOrDestination() {
        val text="# Shopping\n\n- [x] Oat milk\n\n**Keep this**"
        val chooser=NotesMarkdownShare.intent("Notebook 29",text)
        assertEquals(Intent.ACTION_CHOOSER,chooser.action)
        val send=chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
        assertEquals(Intent.ACTION_SEND,send.action)
        assertEquals("text/plain",send.type)
        assertEquals(text,send.getStringExtra(Intent.EXTRA_TEXT))
        assertEquals("Notebook 29",send.getStringExtra(Intent.EXTRA_SUBJECT))
        assertNull(send.component);assertNull(send.`package`)
        assertFalse(send.hasExtra(Intent.EXTRA_STREAM));assertNull(send.clipData)
    }
    @Test fun emptyOrOversizedTextNeverLaunches() {
        for(text in listOf(" ","a\u0000b","é".repeat(100_001))) {
            assertThrows(IllegalArgumentException::class.java){NotesMarkdownShare.intent("Test",text)}
        }
    }
}
