package com.kalamos.notebook.sharing

import android.app.Application
import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class MarkdownImportTest {
    private val context get()=RuntimeEnvironment.getApplication()
    @Test fun preservesMarkdownAndUsesTitleOrFirstHeading() {
        val source="# Draft\n\n- [x] **Keep** this"
        val intent=Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,source)
        val value=MarkdownImport.read(context,intent)
        assertEquals(source,value.getString("text"));assertEquals("Draft",value.getString("name"))
        intent.putExtra(Intent.EXTRA_TITLE,"Shared title")
        assertEquals("Shared title",MarkdownImport.read(context,intent).getString("name"))
    }
    @Test fun rejectsInvalidAndOversizedContentWithoutTruncating() {
        for(text in listOf(" ","bad\u0000text","é".repeat(524_289))) {
            assertThrows(IllegalArgumentException::class.java){MarkdownImport.read(context,Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,text))}
        }
        assertThrows(IllegalArgumentException::class.java){MarkdownImport.read(context,Intent(Intent.ACTION_SEND).setType("image/jpeg"))}
    }
    @Test fun grantedMarkdownFileTakesPrecedenceOverCaptionAndValidatesUtf8() {
        val uri=android.net.Uri.parse("content://test-shared/document.md")
        val resolver=org.robolectric.Shadows.shadowOf(context.contentResolver)
        val intent=Intent(Intent.ACTION_SEND).setType("text/markdown").putExtra(Intent.EXTRA_STREAM,uri).putExtra(Intent.EXTRA_TEXT,"Caption")
        resolver.registerInputStream(uri,java.io.ByteArrayInputStream("# File\n\n**Text**".toByteArray()))
        assertEquals("# File\n\n**Text**",MarkdownImport.read(context,intent).getString("text"))
        resolver.registerInputStream(uri,java.io.ByteArrayInputStream(byteArrayOf(0xc3.toByte(),0x28)))
        assertThrows(java.nio.charset.CharacterCodingException::class.java){MarkdownImport.read(context,intent)}
        resolver.registerInputStream(uri,java.io.ByteArrayInputStream(ByteArray(1_048_577){65}))
        assertThrows(IllegalArgumentException::class.java){MarkdownImport.read(context,intent)}
    }
    @Test fun manifestResolvesOnlySupportedTextShareTypes() {
        for(type in listOf("text/plain","text/markdown","text/x-markdown")) {
            val activities=context.packageManager.queryIntentActivities(Intent(Intent.ACTION_SEND).setType(type),0)
            assertTrue(activities.any{it.activityInfo.name==MarkdownImportActivity::class.java.name})
        }
        assertFalse(context.packageManager.queryIntentActivities(Intent(Intent.ACTION_SEND).setType("image/jpeg"),0).any{it.activityInfo.name==MarkdownImportActivity::class.java.name})
    }
    @Test fun pendingRequestRetainsStableNotebookUntilAcknowledgedAndRejectsOtherIds() {
        val id=UUID.randomUUID().toString();val intent=Intent().putExtra(MarkdownImport.EXTRA,id)
        MarkdownImport.file(context,id).writeText("""{"name":"Note","text":"# Note","notebookId":"shared-$id"}""")
        assertEquals("shared-$id",MarkdownImport.pending(context,intent).getString("notebookId"))
        assertEquals(id,MarkdownImport.pending(context,intent).getString("requestId"))
        assertThrows(IllegalArgumentException::class.java){MarkdownImport.acknowledge(context,intent,UUID.randomUUID().toString())}
        MarkdownImport.acknowledge(context,intent,id)
        assertEquals(0,MarkdownImport.pending(context,intent).length())
    }
}
