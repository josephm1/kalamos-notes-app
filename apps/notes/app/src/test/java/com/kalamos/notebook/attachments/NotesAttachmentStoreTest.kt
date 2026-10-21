package com.kalamos.notebook.attachments

import org.robolectric.RuntimeEnvironment
import com.kalamos.notebook.storage.StorageConfig
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.After
import java.util.UUID
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import android.graphics.Bitmap
import java.io.ByteArrayOutputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotesAttachmentStoreTest {
    private val context = RuntimeEnvironment.getApplication()
    private val store = NotesAttachmentStore(context)
    private lateinit var root: File
    @Before fun prepareRoot() {
        root = File(context.filesDir, "attachment-test-${UUID.randomUUID()}").also { it.mkdirs() }
        StorageConfig.setRoot(context, root.absolutePath)
    }
    @After fun cleanup() { root.deleteRecursively() }

    @Test fun copiedAttachmentsSurviveSourceLossAndDeduplicateWithoutSidecarBytes() {
        val bytes = "An attached document".toByteArray()
        val first = store.importStream(ByteArrayInputStream(bytes), "document.txt", "text/plain", "file")
        val second = store.importStream(ByteArrayInputStream(bytes), "another.txt", "text/plain", "file")
        val id = first.getJSONObject("attachment").getString("id")
        assertEquals(id, second.getJSONObject("attachment").getString("id"))
        assertTrue(id.matches(Regex("[a-f0-9]{64}")))
        assertArrayEquals(bytes, store.file(id).readBytes())
        assertFalse(first.toString().contains(context.filesDir.absolutePath))
        assertFalse(first.toString().contains("data:"))
    }

    @Test fun declaredTypesCannotCollideForTheSameBytes() {
        val bytes = "data".toByteArray()
        val text = store.importStream(ByteArrayInputStream(bytes), "x.txt", "text/plain", "file")
        val audio = store.importStream(ByteArrayInputStream(bytes), "x.mp3", "audio/mpeg", "audio")
        assertNotEquals(text.getJSONObject("attachment").getString("id"), audio.getJSONObject("attachment").getString("id"))
    }

    @Test fun openCopyIsInsideTheNarrowProviderCacheAndPreservesBytes() {
        val saved = store.importStream(ByteArrayInputStream(byteArrayOf(1, 2, 3)), "../../clip.mp3", "audio/mpeg", "audio")
        val id = saved.getJSONObject("attachment").getString("id")
        val (copy, mime) = store.openCopy(id)
        assertEquals(File(context.cacheDir, "notes-attachment-open/$id").canonicalFile, copy.canonicalFile.parentFile)
        assertEquals("audio/mpeg", mime)
        assertArrayEquals(byteArrayOf(1, 2, 3), copy.readBytes())
    }

    @Test fun identityTraversalAndWrongAudioTypesAreRejected() {
        for (id in listOf("../meta", "A".repeat(64), "a".repeat(63), "a".repeat(64) + "/../")) {
            assertThrows(IllegalArgumentException::class.java) { store.file(id) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            store.importStream(ByteArrayInputStream(byteArrayOf(1)), "x.txt", "text/plain", "audio")
        }
    }

    @Test fun emptyAndOversizedImportsLeaveNoPartialFiles() {
        assertThrows(IllegalArgumentException::class.java) {
            store.importStream(ByteArrayInputStream(byteArrayOf()), "empty.txt", "text/plain", "file")
        }
        val large = object : InputStream() {
            var remaining = NotesAttachmentStore.MAX_BYTES + 1
            override fun read(): Int = if (remaining-- > 0) 0 else -1
            override fun read(buffer: ByteArray, off: Int, len: Int): Int {
                if (remaining <= 0) return -1
                val count = minOf(remaining, len.toLong()).toInt()
                buffer.fill(0, off, off + count); remaining -= count; return count
            }
        }
        assertThrows(IllegalArgumentException::class.java) { store.importStream(large, "large.bin", "application/octet-stream", "file") }
        assertTrue(File(StorageConfig.getRoot(context), "attachments").listFiles().orEmpty().none { it.name.endsWith(".part") })
    }

    @Test fun undecodableImageIsRejectedWithoutCreatingANoteObject() {
        assertThrows(Exception::class.java) {
            store.importStream(ByteArrayInputStream("not an image".toByteArray()), "x.jpg", "image/jpeg", "image")
        }
    }

    @Test fun realImagesAreDecodedIntoPortablePreviewBytes() {
        val bitmap = Bitmap.createBitmap(8, 4, Bitmap.Config.ARGB_8888)
        val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        bitmap.recycle()
        val value = store.importStream(ByteArrayInputStream(bytes), "photo.png", "image/png", "image")
        val metadata = value.getJSONObject("attachment")
        assertEquals(8, metadata.getInt("width")); assertEquals(4, metadata.getInt("height"))
        assertTrue(store.image(metadata.getString("id")).getString("source").startsWith("data:image/png;base64,"))
    }

    @Test fun namesNeverBecomePaths() {
        assertEquals("Attachment", NotesAttachmentStore.safeName(".."))
        assertFalse(NotesAttachmentStore.safeName("/a\\b\nc").contains('/'))
        assertTrue(NotesAttachmentStore.safeName("a".repeat(400)).length <= 180)
    }
}
