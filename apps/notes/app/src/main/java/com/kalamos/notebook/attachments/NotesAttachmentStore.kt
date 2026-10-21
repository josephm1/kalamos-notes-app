package com.kalamos.notebook.attachments

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import com.kalamos.notebook.storage.StorageConfig
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

/** Immutable, content-addressed files under the active Notes data root. Page copies and Undo
 * retain valid references. Nothing here touches the ink surface or asks for broad permissions. */
internal class NotesAttachmentStore(private val context: Context) {
    private val directory get() = File(StorageConfig.getRoot(context), "attachments").also { it.mkdirs() }

    fun importUri(uri: Uri, kind: String): JSONObject {
        require(kind in setOf("image", "audio", "file")) { "Unknown attachment type" }
        val resolver = context.contentResolver
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } ?: "Attachment"
        val mime = resolver.getType(uri)?.takeUnless { it == "application/octet-stream" }
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
        return requireNotNull(resolver.openInputStream(uri)) { "The selected file cannot be read" }.use {
            importStream(it, name, mime, kind)
        }
    }

    internal fun importStream(input: InputStream, name: String, mime: String, kind: String): JSONObject {
        require(kind in setOf("image", "audio", "file"))
        require(mime.matches(Regex("[\\w.+-]+/[\\w.+-]+"))) { "Invalid attachment type" }
        require(kind != "audio" || mime.startsWith("audio/")) { "Choose an audio file" }
        val root = directory
        var staged = File(root, ".${UUID.randomUUID()}.part")
        try {
            staged.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                var size = 0L
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    size += count
                    require(size <= MAX_BYTES) { "Attachments must be 100 MiB or smaller" }
                    output.write(buffer, 0, count)
                }
                require(size > 0) { "The selected file is empty" }
            }
            val metadata = JSONObject().put("name", safeName(name)).put("mime", mime)
            if (kind == "image") {
                val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(staged)) { decoder, info, _ ->
                    val scale = minOf(1.0, 1600.0 / maxOf(info.size.width, info.size.height))
                    decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
                val encoded = File(root, ".${UUID.randomUUID()}.part")
                try {
                    val png = bitmap.hasAlpha()
                    encoded.outputStream().use { check(bitmap.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 88, it)) }
                    require(encoded.length() <= MAX_IMAGE_BYTES) { "This image is too large to display" }
                    metadata.put("mime", if (png) "image/png" else "image/jpeg")
                        .put("width", bitmap.width).put("height", bitmap.height)
                    staged.delete(); staged = encoded
                } finally {
                    bitmap.recycle()
                    if (staged != encoded) encoded.delete()
                }
            }
            if (kind == "audio") {
                val retriever = MediaMetadataRetriever()
                try {
                    retriever.setDataSource(staged.absolutePath)
                    retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                        ?.takeIf { it >= 0 }?.let { metadata.put("durationMs", it) }
                } catch (_: Exception) { /* Playback can still provide duration for formats without readable tags. */ }
                finally { runCatching { retriever.release() } }
            }
            val digest = MessageDigest.getInstance("SHA-256")
            digest.update(metadata.getString("mime").toByteArray()); digest.update(0.toByte())
            staged.inputStream().use { inputFile ->
                val buffer = ByteArray(64 * 1024)
                while (true) { val size = inputFile.read(buffer); if (size < 0) break; digest.update(buffer, 0, size) }
            }
            val id = digest.digest().joinToString("") { "%02x".format(it) }
            val target = File(root, "$id.bin")
            synchronized(this) {
                if (!target.exists()) check(staged.renameTo(target)) { "The attachment could not be saved" }
                metadata.put("id", id)
                val record = File(root, "$id.json")
                if (!record.exists()) {
                    val temp = File(root, ".${UUID.randomUUID()}.part")
                    try { temp.writeText(metadata.toString()); check(temp.renameTo(record)) } finally { temp.delete() }
                }
            }
            return JSONObject().put("kind", kind).put("attachment", metadata)
        } finally { staged.delete() }
    }

    fun metadata(id: String): JSONObject {
        file(id) // Validate both identity and availability before reading metadata.
        return JSONObject(File(directory, "$id.json").readText())
    }

    fun file(id: String): File {
        require(id.matches(Regex("[a-f0-9]{64}"))) { "Invalid attachment" }
        val root = directory.canonicalFile
        return File(root, "$id.bin").canonicalFile.also {
            require(it.parentFile == root && it.isFile) { "Attachment not found" }
        }
    }

    fun image(id: String): JSONObject {
        val metadata = metadata(id)
        val mime = metadata.getString("mime")
        require(mime in setOf("image/png", "image/jpeg", "image/webp")) { "Not an image attachment" }
        val file = file(id)
        require(file.length() <= MAX_IMAGE_BYTES) { "The attached image is too large" }
        return JSONObject().put("source", "data:$mime;base64," + Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
    }

    fun openCopy(id: String): Pair<File, String> {
        val metadata = metadata(id)
        val folder = File(context.cacheDir, "notes-attachment-open/$id").also { it.mkdirs() }
        val copy = File(folder, safeName(metadata.getString("name")))
        if (!copy.isFile) file(id).copyTo(copy, overwrite = true)
        return copy to metadata.getString("mime")
    }

    companion object {
        const val MAX_BYTES = 100L * 1024 * 1024
        const val MAX_IMAGE_BYTES = 8L * 1024 * 1024
        internal fun safeName(name: String): String = name.replace(Regex("[\\p{Cntrl}/\\\\]"), "_").trim().take(180)
            .takeUnless { it.isBlank() || it == "." || it == ".." } ?: "Attachment"
    }
}
