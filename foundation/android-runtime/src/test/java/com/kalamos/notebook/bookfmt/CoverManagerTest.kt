package com.kalamos.notebook.bookfmt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CoverManagerTest {
    @Test
    fun `current blocks asset path is not prefixed twice`() {
        assertEquals(
            "assets/cover.webp",
            CoverManager.blocksAssetPath("assets/cover.webp")
        )
    }

    @Test
    fun `legacy blocks asset path receives the assets prefix`() {
        assertEquals("assets/cover.png", CoverManager.blocksAssetPath("cover.png"))
        assertEquals("assets/cover.jpg", CoverManager.blocksAssetPath("./assets/cover.jpg"))
    }

    @Test
    fun `blank blocks asset path is ignored`() {
        assertNull(CoverManager.blocksAssetPath("  "))
    }

    @Test
    fun `huge page raster is decoded near cover size`() {
        assertEquals(32, CoverManager.coverSampleSize(20_000, 30_000))
    }

    @Test
    fun `ordinary cover does not need sampling`() {
        assertEquals(1, CoverManager.coverSampleSize(360, 480))
    }

    @Test
    fun `wide cover samples against its constraining dimension`() {
        assertEquals(8, CoverManager.coverSampleSize(4_000, 500))
    }

    @Test
    fun `opening text fallback keeps title page text and strips markdown`() {
        val section = """{
          "blocks": [
            {"type":"text","md":"# GET INTO MEDICAL SCHOOL\n1000 UKCAT Practice Questions"},
            {"type":"image","src":"assets/ignored.png"},
            {"type":"text","md":"Olivier Picard, Laetitia Tighlit"}
          ]
        }"""

        assertEquals(
            listOf(
                "GET INTO MEDICAL SCHOOL\n1000 UKCAT Practice Questions",
                "Olivier Picard, Laetitia Tighlit"
            ),
            CoverManager.openingTextFromSection(section)
        )
    }
}
