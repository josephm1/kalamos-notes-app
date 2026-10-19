package com.kalamos.notebook.app

import android.webkit.WebView
import android.app.Application
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class NotesWebViewGesturesTest {
    @Test fun consumesAndroidLongClickWithoutDisablingOrdinaryClicks() {
        val view = WebView(RuntimeEnvironment.getApplication())
        var clicks = 0
        view.setOnClickListener { clicks++ }
        suppressNotesWebViewLongPress(view)
        // ShadowWebView stubs performLongClick; exercise the installed Android listener.
        assertTrue(shadowOf(view).onLongClickListener.onLongClick(view))
        assertEquals(0, clicks)
        shadowOf(view).onClickListener.onClick(view)
        assertEquals(1, clicks)
        view.destroy()
    }
}
