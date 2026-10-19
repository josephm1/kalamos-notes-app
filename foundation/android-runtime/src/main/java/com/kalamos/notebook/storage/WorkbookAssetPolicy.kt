package com.kalamos.notebook.storage

import java.security.MessageDigest
import java.util.Base64
import java.util.Locale

/**
 * Closed validation policy for raster assets derived while building a study workbook.
 *
 * Model/provider output never chooses an arbitrary file destination. The only writable shape is a
 * content-addressed file inside one interaction group's asset sidecar. Keeping decoding and format
 * checks here also makes the policy independently testable without a WebView or Android context.
 */
object WorkbookAssetPolicy {
    const val MAX_DECODED_BYTES: Int = 10 * 1024 * 1024

    private val assetPath = Regex(
        "^sidecar/interactions/([A-Za-z0-9][A-Za-z0-9_-]{0,127})/assets/([0-9a-f]{64})\\.(png|jpg|webp)$"
    )

    data class ApprovedAsset(
        val relativePath: String,
        val bytes: ByteArray
    )

    sealed class Result {
        data class Approved(val asset: ApprovedAsset) : Result()
        data class Rejected(val error: String) : Result()
    }

    /** Validate the complete untrusted bridge request and return bytes only after every check. */
    fun decode(relativePath: String, dataUrl: String): Result {
        val pathMatch = assetPath.matchEntire(relativePath)
            ?: return Result.Rejected("invalid asset path")

        val comma = dataUrl.indexOf(',')
        if (comma <= 0) return Result.Rejected("invalid data URL")
        val prefix = dataUrl.substring(0, comma + 1)
        val expectedExtension = when (prefix) {
            "data:image/png;base64," -> "png"
            "data:image/jpeg;base64," -> "jpg"
            "data:image/webp;base64," -> "webp"
            else -> return Result.Rejected("unsupported image type")
        }
        if (pathMatch.groupValues[3] != expectedExtension) {
            return Result.Rejected("image type does not match asset path")
        }

        val encoded = dataUrl.substring(comma + 1)
        if (encoded.isEmpty()) return Result.Rejected("empty image")
        // Four encoded characters represent at most three decoded bytes. Reject before allocating
        // a decoded array, then enforce the exact size after strict Base64 decoding.
        val maxEncodedLength = ((MAX_DECODED_BYTES + 2L) / 3L) * 4L
        if (encoded.length.toLong() > maxEncodedLength) {
            return Result.Rejected("asset exceeds 10 MB")
        }
        val bytes = try {
            Base64.getDecoder().decode(encoded)
        } catch (_: IllegalArgumentException) {
            return Result.Rejected("invalid base64")
        }
        validateBytes(relativePath, bytes)?.let { return Result.Rejected(it) }

        return Result.Approved(ApprovedAsset(relativePath, bytes))
    }

    /** Book identifiers are directory names here; reject separators, dot-prefixes and traversal. */
    fun isSafeBookId(bookId: String): Boolean =
        Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$").matches(bookId)

    /** Defense in depth for callers below the bridge boundary. */
    fun isSafeAssetPath(relativePath: String): Boolean = assetPath.matches(relativePath)

    /** Repeatable defense-in-depth check used at the storage boundary after bridge decoding. */
    fun validateBytes(relativePath: String, bytes: ByteArray): String? {
        val pathMatch = assetPath.matchEntire(relativePath) ?: return "invalid asset path"
        if (bytes.isEmpty()) return "empty image"
        if (bytes.size > MAX_DECODED_BYTES) return "asset exceeds 10 MB"
        val extension = pathMatch.groupValues[3]
        if (!hasExpectedSignature(extension, bytes)) {
            return "image content does not match declared type"
        }
        val expectedHash = pathMatch.groupValues[2]
        val actualHash = MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(Locale.US, it.toInt() and 0xff) }
        return if (actualHash == expectedHash) null else "content hash mismatch"
    }

    private fun hasExpectedSignature(extension: String, bytes: ByteArray): Boolean = when (extension) {
        "png" -> bytes.startsWith(
            intArrayOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        )
        "jpg" -> bytes.startsWith(intArrayOf(0xff, 0xd8, 0xff))
        "webp" -> bytes.size >= 12 &&
            bytes.copyOfRange(0, 4).contentEquals("RIFF".toByteArray(Charsets.US_ASCII)) &&
            bytes.copyOfRange(8, 12).contentEquals("WEBP".toByteArray(Charsets.US_ASCII))
        else -> false
    }

    private fun ByteArray.startsWith(prefix: IntArray): Boolean =
        size >= prefix.size && prefix.indices.all { index ->
            (this[index].toInt() and 0xff) == prefix[index]
        }
}
