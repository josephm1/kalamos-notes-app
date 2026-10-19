package com.kalamos.notebook.bookfmt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EmbeddedBookMetadataTest {

    @Test
    fun `epub3 package metadata is normalized with series refinements`() {
        val metadata = OpfMetadataParser.parse(
            """
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
              <metadata>
                <dc:title>The Example Book</dc:title>
                <dc:creator>Alex Writer</dc:creator>
                <dc:creator>Sam Writer</dc:creator>
                <dc:language>en-IE</dc:language>
                <dc:subject>History</dc:subject>
                <dc:subject>Ireland</dc:subject>
                <dc:description>&lt;p&gt;A useful publisher description.&lt;/p&gt;</dc:description>
                <dc:identifier>urn:isbn:9780000000001</dc:identifier>
                <dc:publisher>Example Press</dc:publisher>
                <dc:date>2024-06-12</dc:date>
                <meta property="belongs-to-collection" id="series-id">Example Series</meta>
                <meta property="collection-type" refines="#series-id">series</meta>
                <meta property="group-position" refines="#series-id">2.5</meta>
              </metadata>
            </package>
            """.trimIndent()
        )

        assertEquals("The Example Book", metadata.title)
        assertEquals(listOf("Alex Writer", "Sam Writer"), metadata.authors)
        assertEquals("Example Series", metadata.series)
        assertEquals(2.5, metadata.seriesIndex!!, 0.0)
        assertEquals(listOf("History", "Ireland"), metadata.keywords)
        assertEquals("A useful publisher description.", metadata.description)
        assertEquals("embedded", metadata.descriptionSource)
        assertEquals("Example Press", metadata.publisher)
        assertEquals("2024-06-12", metadata.publicationDate)
    }

    @Test
    fun `epub2 calibre series metadata is supported`() {
        val metadata = OpfMetadataParser.parse(
            """
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
              <metadata>
                <dc:title>Legacy Book</dc:title>
                <meta name="calibre:series" content="Legacy Series"/>
                <meta name="calibre:series_index" content="7"/>
              </metadata>
            </package>
            """.trimIndent()
        )

        assertEquals("Legacy Series", metadata.series)
        assertEquals(7.0, metadata.seriesIndex!!, 0.0)
    }

    @Test
    fun `epub3 set collections are not mislabeled as a series`() {
        val metadata = OpfMetadataParser.parse(
            """
            <package>
              <metadata>
                <meta property="belongs-to-collection" id="set-id">Collected Essays</meta>
                <meta property="collection-type" refines="#set-id">set</meta>
              </metadata>
            </package>
            """.trimIndent()
        )

        assertEquals(null, metadata.series)
    }

    @Test
    fun `metadata merge preserves user sidecar values`() {
        val target = JSONObject()
            .put("favourite", true)
            .put("readingProgress", 0.42)

        EmbeddedBookMetadata(
            title = "Embedded title",
            authors = listOf("One Author"),
            subjects = listOf("Medicine"),
            publicationDate = "2021-03"
        ).applyTo(target)

        assertTrue(target.getBoolean("favourite"))
        assertEquals(0.42, target.getDouble("readingProgress"), 0.0)
        assertEquals("Embedded title", target.getString("title"))
        assertEquals("One Author", target.getString("author"))
        assertEquals(2021, target.getInt("publicationYear"))
    }

    @Test
    fun `description fallback skips boilerplate and labels a source excerpt`() {
        val excerpt = BookDescriptionFallback.fromCandidates(
            sequenceOf(
                "Contents " + "Chapter and page listing ".repeat(20),
                "Copyright 2024. All rights reserved. " + "Legal notice ".repeat(20),
                "This is the first meaningful passage in the book. " +
                    "It contains enough real prose to serve as a truthful preview when the publisher " +
                    "did not include a description in the document metadata. " +
                    "Nothing in this fallback is generated or inferred; it is copied from the source."
            )
        )

        assertTrue(excerpt!!.startsWith("From the book: This is the first meaningful passage"))
    }

    @Test
    fun `online merge fills gaps but keeps embedded values until user accepts overwrite`() {
        val local = EmbeddedBookMetadata(
            title = "Local title",
            titleSource = "embedded",
            authors = listOf("Local Author"),
            description = "From the book: local excerpt",
            descriptionSource = "excerpt"
        )
        val online = EmbeddedBookMetadata(
            title = "Catalogue title",
            authors = listOf("Catalogue Author"),
            description = "Publisher description",
            descriptionSource = "online",
            publisher = "Example Press"
        )

        val merged = local.mergeOnline(online)

        assertEquals("Local title", merged.title)
        assertEquals(listOf("Local Author"), merged.authors)
        assertEquals("Publisher description", merged.description)
        assertEquals("Example Press", merged.publisher)
    }

    @Test
    fun `blocks manifest vocabulary is normalized for catalogue lookup`() {
        val metadata = EmbeddedBookMetadata.fromJson(
            JSONObject(
                """
                {
                  "title":"Special Book",
                  "author":"A. Writer",
                  "isbn":"978-0-14-032872-1",
                  "genres":["Reference"],
                  "summary":"Manifest description",
                  "year":2024
                }
                """.trimIndent()
            )
        )

        assertEquals("Special Book", metadata.title)
        assertEquals(listOf("A. Writer"), metadata.authors)
        assertEquals(listOf("978-0-14-032872-1"), metadata.identifiers)
        assertEquals(listOf("Reference"), metadata.subjects)
        assertEquals("Manifest description", metadata.description)
        assertEquals("2024", metadata.publicationDate)
    }
}
