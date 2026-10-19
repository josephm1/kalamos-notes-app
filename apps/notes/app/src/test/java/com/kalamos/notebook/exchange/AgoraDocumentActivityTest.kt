package com.kalamos.notebook.exchange

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.webkit.WebView
import android.widget.Button
import com.kalamos.foundation.runtime.R as RuntimeR
import com.kalamos.notebook.MainActivity
import com.kalamos.notebook.R
import com.kalamos.notebook.storage.StorageConfig
import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class AgoraDocumentActivityTest {
    @Before fun storage() {
        val context = RuntimeEnvironment.getApplication()
        StorageConfig.setRoot(context, File(context.filesDir, "notes-${UUID.randomUUID()}").apply { mkdirs() }.path)
    }
    private fun intent() = Intent(RuntimeEnvironment.getApplication(), AgoraDocumentActivity::class.java)
        .putExtra("requestId", UUID.randomUUID().toString()).putExtra("operation", "pick")

    @Test fun unknownOperationCannotFallThroughToAnEmptyNotebook() {
        val controller=Robolectric.buildActivity(AgoraDocumentActivity::class.java,
            intent().putExtra("operation","unknown")).setup()
        val activity=controller.get()
        assertFalse(activity.pending.has("notebookId"))
        assertTrue(activity.pending.optBoolean("loading"))
        assertEquals("failed",activity.diagnosticReport().getString("stage"))
        assertEquals("Unsupported Notes operation",activity.diagnosticReport().getString("error"))
        controller.pause().stop().destroy()
    }
    @Test fun pickerBackReturnsCancelledWithoutOpeningTheOrdinaryNotesShelf() {
        val controller = Robolectric.buildActivity(AgoraDocumentActivity::class.java, intent()).setup()
        val activity = controller.get()
        assertFalse(activity.findViewById<Button>(R.id.agoraAttach).isEnabled)
        assertEquals(android.view.View.GONE, activity.findViewById<Button>(R.id.agoraAttach).visibility)
        assertEquals(android.view.View.GONE, activity.findViewById<Button>(R.id.agoraOptions).visibility)
        val header = activity.findViewById<Button>(R.id.agoraAttach).parent as android.view.View
        assertEquals((48 * activity.resources.displayMetrics.density).toInt(), header.layoutParams.height)
        assertEquals(android.view.View.GONE, activity.findViewById<android.widget.TextView>(R.id.agoraSessionSubtitle).visibility)
        activity.onBackPressedDispatcher.onBackPressed()
        assertEquals(android.view.View.GONE, header.visibility)
        assertTrue(shadowOf(activity.findViewById<WebView>(RuntimeR.id.webView)).lastEvaluatedJavascript.contains("KalamosNotesAgora.back()"))
        activity.cancelSession()
        assertTrue(activity.isFinishing)
        assertEquals(Activity.RESULT_CANCELED, shadowOf(activity).resultCode)
        controller.pause().stop().destroy()
    }
    @Test fun externalEditorDoesNotStealOrReleaseTheNormalNotesWebView() {
        val normal = Robolectric.buildActivity(MainActivity::class.java).setup()
        val normalView = normal.get().findViewById<WebView>(RuntimeR.id.webView)
        val originalParent = normalView.parent
        normal.pause().stop()
        val external = Robolectric.buildActivity(AgoraDocumentActivity::class.java, intent()).setup()
        val externalView = external.get().findViewById<WebView>(RuntimeR.id.webView)
        assertNotSame(normalView, externalView)
        assertSame(originalParent, normalView.parent)
        external.pause().stop().destroy()
        assertSame(originalParent, normalView.parent)
        normal.start().resume()
        assertSame(normalView, normal.get().findViewById<WebView>(RuntimeR.id.webView))
        normal.pause().stop().destroy()
    }
    @Test fun aSecondActivityCannotAcquireTheSameMutableNotebook() {
        val normal = Robolectric.buildActivity(MainActivity::class.java).setup()
        val external = Robolectric.buildActivity(AgoraDocumentActivity::class.java, intent()).setup()
        assertTrue(NotesEditorOwners.acquire("one-note", normal.get()))
        assertFalse(NotesEditorOwners.acquire("one-note", external.get()))
        assertTrue(NotesEditorOwners.acquire("different-note", external.get()))
        NotesEditorOwners.release("one-note", normal.get())
        assertTrue(NotesEditorOwners.acquire("one-note", external.get()))
        external.pause().stop().destroy()
        normal.pause().stop().destroy()
    }
    @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    @Test fun narrowHeaderReservesSpaceAboveTheWritingSurface() {
        val controller = Robolectric.buildActivity(AgoraDocumentActivity::class.java, intent()).setup()
        val activity = controller.get()
        activity.selectNotebook(AgoraDocuments(activity).newNotebook("Selected note"))
        val density = activity.resources.displayMetrics.density
        val width = (360 * density).toInt()
        val height = (640 * density).toInt()
        val decor = activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
        decor.measure(android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY),
            android.view.View.MeasureSpec.makeMeasureSpec(height, android.view.View.MeasureSpec.EXACTLY))
        decor.layout(0, 0, width, height)
        val attach = activity.findViewById<Button>(R.id.agoraAttach)
        val options = activity.findViewById<Button>(R.id.agoraOptions)
        val title = activity.findViewById<android.widget.TextView>(R.id.agoraSessionTitle)
        val editor = activity.findViewById<android.view.View>(RuntimeR.id.fragmentContainer)
        assertTrue("Attach button width=${attach.width}, density=$density", attach.width >= (100 * density).toInt())
        assertTrue(attach.height >= (48 * density).toInt())
        assertTrue(title.width > 0)
        assertTrue(options.right <= attach.left)
        assertTrue(editor.top >= (60 * density).toInt())
        val header = attach.parent as android.view.View
        val bitmap = android.graphics.Bitmap.createBitmap(width, header.height, android.graphics.Bitmap.Config.ARGB_8888)
        header.draw(android.graphics.Canvas(bitmap))
        assertEquals("Attachment control has white paper, never a filled highlight", android.graphics.Color.WHITE, bitmap.getPixel(attach.left + 8, attach.top + 8))
        activity.setSessionBusy(true)
        header.draw(android.graphics.Canvas(bitmap))
        assertEquals("Busy control must also stay white", android.graphics.Color.WHITE, bitmap.getPixel(attach.left + 8, attach.top + 8))
        activity.setSessionBusy(false)
        File("build/outputs/ui-qa/native-header.png").apply { parentFile.mkdirs() }.outputStream().use {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
        controller.pause().stop().destroy()
    }
    @Test fun selectedNoteBackUsesTheExchangeContractInsteadOfTheSharedRouter() {
        val controller = Robolectric.buildActivity(AgoraDocumentActivity::class.java, intent()).setup()
        val activity = controller.get()
        activity.selectNotebook(AgoraDocuments(activity).newNotebook("Selected note"))
        assertTrue(activity.findViewById<Button>(R.id.agoraAttach).isEnabled)
        activity.onBackPressedDispatcher.onBackPressed()
        val script = shadowOf(activity.findViewById<WebView>(RuntimeR.id.webView)).lastEvaluatedJavascript
        assertTrue(script.contains("KalamosNotesAgora.back()"))
        assertFalse(activity.isFinishing)
        controller.pause().stop().destroy()
    }
    @Test fun multipleNotesReturnOneResultWithEveryGrantedContentUri() {
        val launch = intent()
        val controller = Robolectric.buildActivity(AgoraDocumentActivity::class.java, launch).setup()
        val activity = controller.get()
        val repo = AgoraDocuments(activity)
        val bundles = listOf("First", "Second").map { title ->
            val id = repo.newNotebook(title)
            val pages = repo.inspect(id).getJSONArray("pages")
            repo.export(id, (0 until pages.length()).map { pages.getJSONObject(it).getString("id") }.toSet())
        }
        activity.returnDocuments(bundles)
        val result = shadowOf(activity).resultIntent
        assertEquals(Activity.RESULT_OK, shadowOf(activity).resultCode)
        assertEquals(launch.getStringExtra("requestId"), result.getStringExtra("requestId"))
        assertEquals(2, result.getIntExtra("documentCount", 0))
        assertEquals(2, result.clipData!!.itemCount)
        assertEquals(result.data, result.clipData!!.getItemAt(0).uri)
        assertNotEquals(result.data, result.clipData!!.getItemAt(1).uri)
        assertTrue(result.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        for (i in 0..1) assertEquals("content", result.clipData!!.getItemAt(i).uri.scheme)
        controller.pause().stop().destroy()
    }

    @Test fun returningToPickerRetiresEditorNavigationButKeepsTheSavedNotebook() {
        val launch = intent()
        val controller = Robolectric.buildActivity(AgoraDocumentActivity::class.java, launch).setup()
        val activity = controller.get()
        val id = AgoraDocuments(activity).newNotebook("Retained note")
        activity.selectNotebook(id)
        assertTrue(activity.pending.has("notebookId"))
        activity.showPicker()
        assertFalse(activity.pending.has("notebookId"))
        val header = activity.findViewById<Button>(R.id.agoraAttach).parent as android.view.View
        assertEquals(android.view.View.GONE, header.visibility)
        assertTrue(com.kalamos.notebook.storage.StorageManager(activity).loadLibrary().notebooks.any { it.notebookId == id })
        controller.pause().stop().destroy()
        val recreated = Robolectric.buildActivity(AgoraDocumentActivity::class.java, launch).setup()
        assertFalse(recreated.get().pending.has("notebookId"))
        assertEquals("pick", recreated.get().pending.getString("operation"))
        recreated.pause().stop().destroy()
    }

}
