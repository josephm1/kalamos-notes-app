package com.kalamos.notebook.storage

import java.security.MessageDigest
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkbookAssetPolicyTest {
    private val png = byteArrayOf(
        0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x00
    )

    @Test
    fun acceptsContentAddressedRasterAsset() {
        val path = pathFor("group_1", png, "png")
        val result = WorkbookAssetPolicy.decode(path, dataUrl("image/png", png))

        assertTrue(result is WorkbookAssetPolicy.Result.Approved)
        assertTrue((result as WorkbookAssetPolicy.Result.Approved).asset.bytes.contentEquals(png))
    }

    @Test
    fun acceptsJpegAndWebpSignatures() {
        val jpeg = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xe0.toByte())
        val webp = byteArrayOf(
            'R'.code.toByte(), 'I'.code.toByte(), 'F'.code.toByte(), 'F'.code.toByte(),
            0, 0, 0, 0,
            'W'.code.toByte(), 'E'.code.toByte(), 'B'.code.toByte(), 'P'.code.toByte()
        )

        assertTrue(
            WorkbookAssetPolicy.decode(pathFor("g", jpeg, "jpg"), dataUrl("image/jpeg", jpeg))
                is WorkbookAssetPolicy.Result.Approved
        )
        assertTrue(
            WorkbookAssetPolicy.decode(pathFor("g", webp, "webp"), dataUrl("image/webp", webp))
                is WorkbookAssetPolicy.Result.Approved
        )
    }

    @Test
    fun rejectsEveryPathOutsideClosedSidecarShape() {
        val hash = hash(png)
        val unsafe = listOf(
            "/sidecar/interactions/g/assets/$hash.png",
            "sidecar/interactions/../assets/$hash.png",
            "sidecar/interactions/g/../../book.pdf",
            "sidecar/interactions/g/assets/$hash.svg",
            "sidecar/interactions/g/assets/${hash.uppercase()}.png",
            "sidecar/interactions/g/assets/abcd.png",
            "sidecar/interactions/group.with.dot/assets/$hash.png"
        )

        unsafe.forEach { path ->
            assertRejected("invalid asset path", WorkbookAssetPolicy.decode(path, dataUrl("image/png", png)))
        }
    }

    @Test
    fun rejectsSvgAndTypeOrSignatureMismatch() {
        val svg = "<svg xmlns='http://www.w3.org/2000/svg'/>".toByteArray()
        assertRejected(
            "unsupported image type",
            WorkbookAssetPolicy.decode(pathFor("g", svg, "png"), dataUrl("image/svg+xml", svg))
        )
        assertRejected(
            "image type does not match asset path",
            WorkbookAssetPolicy.decode(pathFor("g", png, "jpg"), dataUrl("image/png", png))
        )
        assertRejected(
            "image content does not match declared type",
            WorkbookAssetPolicy.decode(pathFor("g", svg, "png"), dataUrl("image/png", svg))
        )
    }

    @Test
    fun rejectsMalformedBase64AndWrongContentHash() {
        val correctPath = pathFor("g", png, "png")
        assertRejected(
            "invalid base64",
            WorkbookAssetPolicy.decode(correctPath, "data:image/png;base64,%%%")
        )
        val wrongHash = "0".repeat(64)
        assertRejected(
            "content hash mismatch",
            WorkbookAssetPolicy.decode(
                "sidecar/interactions/g/assets/$wrongHash.png",
                dataUrl("image/png", png)
            )
        )
    }

    @Test
    fun rejectsPayloadLargerThanTenMegabytesBeforeDecode() {
        val encoded = "A".repeat(((WorkbookAssetPolicy.MAX_DECODED_BYTES + 2) / 3) * 4 + 1)
        val result = WorkbookAssetPolicy.decode(
            "sidecar/interactions/g/assets/${"0".repeat(64)}.png",
            "data:image/png;base64,$encoded"
        )
        assertRejected("asset exceeds 10 MB", result)
    }

    @Test
    fun acceptsOnlySafeBookDirectoryIds() {
        assertTrue(WorkbookAssetPolicy.isSafeBookId("clinical-cases_2026"))
        listOf("", ".", "../book", "book/asset", "book\\asset", "-book").forEach {
            assertTrue("expected unsafe book id: $it", !WorkbookAssetPolicy.isSafeBookId(it))
        }
    }

    private fun pathFor(groupId: String, bytes: ByteArray, extension: String) =
        "sidecar/interactions/$groupId/assets/${hash(bytes)}.$extension"

    private fun dataUrl(mime: String, bytes: ByteArray) =
        "data:$mime;base64,${Base64.getEncoder().encodeToString(bytes)}"

    private fun hash(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun assertRejected(message: String, result: WorkbookAssetPolicy.Result) {
        assertTrue(result is WorkbookAssetPolicy.Result.Rejected)
        assertEquals(message, (result as WorkbookAssetPolicy.Result.Rejected).error)
    }
}
