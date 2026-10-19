package com.kalamos.foundation.documents

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.file.Files

class KalamosBookDataTest {
    @Test fun readsLongCompleteSectionAndRetainsItsQualifyingConclusion() {
        val root = Files.createTempDirectory("kalamos-long-section").toFile()
        try {
            val directory = root.resolve("book-12345678/sections").also { it.mkdirs() }
            val source = "Opening claim. " + "Context. ".repeat(12_000) + "The conclusion qualifies the opening."
            directory.resolve("toc-1.txt").writeText(source)
            val result = KalamosBookData.readSectionsFrom(root, "book-12345678", JSONArray().put("toc-1"))
            assertEquals(source, result.getJSONObject("sections").getString("toc-1"))
        } finally { root.deleteRecursively() }
    }

    @Test fun catalogsOnlyCompleteMatchingBookDataWithoutReturningMapsOrEvidence() {
        val root = Files.createTempDirectory("kalamos-book-catalog").toFile()
        try {
            fun writeRecord(id: String, cardId: String = id, complete: Boolean = true) {
                val directory = root.resolve(id).also { it.mkdirs() }
                directory.resolve("source.json").writeText(
                    "{\"schema\":\"kalamos.book-source/v1\",\"bookId\":\"$id\",\"path\":\"/storage/emulated/0/Books/$id.epub\",\"fingerprint\":\"10:20\"}"
                )
                directory.resolve("book-card.json").writeText(
                    "{\"schema\":\"kalamos.book-card/v1\",\"bookId\":\"$cardId\",\"title\":\"Alexander the Great\",\"generation\":{\"mode\":\"ai-semantic-routing\"}}"
                )
                directory.resolve("structure-map.json").writeText(
                    "{\"schema\":\"kalamos.learn-structure-map/v1\",\"bookId\":\"$id\",\"provider\":{\"mode\":\"ai-semantic-routing\"}}"
                )
                if (complete) directory.resolve("book-grammar.json").writeText(
                    "{\"schema\":\"kalamos.living-book-grammar/v1\",\"bookId\":\"$id\"}"
                )
                if (complete) directory.resolve("analysis-manifest.json").writeText(
                    "{\"schema\":\"kalamos.book-analysis-manifest/v1\",\"bookId\":\"$id\",\"state\":\"complete\",\"sourceFingerprint\":\"10:20\"}"
                )
                directory.resolve("sections").mkdirs()
                directory.resolve("sections/toc-1.txt").writeText("Private evidence")
            }
            writeRecord("book-12345678")
            writeRecord("book-mismatch1", "book-somewhere-else")
            writeRecord("book-incomplete", complete = false)

            val result = KalamosBookData.catalogFrom(root)
            assertEquals("kalamos.book-data-catalog/v1", result.getString("schema"))
            assertEquals(1, result.getJSONArray("books").length())
            val row = result.getJSONArray("books").getJSONObject(0)
            assertEquals("book-12345678", row.getString("bookId"))
            assertEquals("Alexander the Great", row.getJSONObject("card").getString("title"))
            assertEquals(false, row.has("structureMap"))
            assertEquals(false, result.toString().contains("Private evidence"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test fun readsOnlyRequestedContractFiles() {
        val root = Files.createTempDirectory("kalamos-book-data").toFile()
        try {
            val directory = root.resolve("book-12345678").also { it.mkdirs() }
            directory.resolve("book-card.json").writeText("{\"schema\":\"kalamos.book-card/v1\"}")
            directory.resolve("private.txt").writeText("no")
            val result = KalamosBookData.readFrom(root, "book-12345678", JSONArray().put("book-card.json"))
            assertEquals("kalamos.book-card/v1", result.getJSONObject("files")
                .let { JSONObject(it.getString("book-card.json")) }.getString("schema"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test fun readsTheSourceLinkWithoutTouchingTheBook() {
        val root = Files.createTempDirectory("kalamos-book-source").toFile()
        try {
            val directory = root.resolve("book-12345678").also { it.mkdirs() }
            directory.resolve("source.json").writeText(
                "{\"schema\":\"kalamos.book-source/v1\",\"bookId\":\"book-12345678\",\"path\":\"/storage/emulated/0/My Books/example.epub\"}"
            )
            val result = KalamosBookData.readFrom(root, "book-12345678", JSONArray().put("source.json"))
            val source = JSONObject(result.getJSONObject("files").getString("source.json"))
            assertEquals("/storage/emulated/0/My Books/example.epub", source.getString("path"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsFilesOutsideTheContract() {
        KalamosBookData.readFrom(Files.createTempDirectory("kalamos-book-data").toFile(),
            "book-12345678", JSONArray().put("../secret"))
    }

    @Test fun readsOnlySelectedSectionEvidence() {
        val root = Files.createTempDirectory("kalamos-book-sections").toFile()
        try {
            val sections = root.resolve("book-12345678/sections").also { it.mkdirs() }
            sections.resolve("toc-1.txt").writeText("Selected evidence")
            sections.resolve("toc-2.txt").writeText("Unrelated evidence")
            val result = KalamosBookData.readSectionsFrom(root, "book-12345678", JSONArray().put("toc-1"))
                .getJSONObject("sections")
            assertEquals("Selected evidence", result.getString("toc-1"))
            assertEquals(false, result.has("toc-2"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsSectionPathTraversal() {
        KalamosBookData.readSectionsFrom(Files.createTempDirectory("kalamos-book-sections").toFile(),
            "book-12345678", JSONArray().put("../secret"))
    }

    @Test fun searchesNeutralPdfPageSpansLocallyAndReturnsOnlyBoundedCandidates() {
        val root = Files.createTempDirectory("kalamos-book-search").toFile()
        try {
            val directory = root.resolve("book-12345678").also { it.mkdirs() }
            directory.resolve("structure-map.json").writeText("""{"sourceCatalog":[
                {"id":"pages-1-8","label":"Pages 1–8","page":0},
                {"id":"pages-97-104","label":"Pages 97–104","page":96}
            ]}""")
            val sections = directory.resolve("sections").also { it.mkdirs() }
            sections.resolve("pages-1-8.txt").writeText("General introductory material")
            sections.resolve("pages-97-104.txt").writeText("Retinal detachment may present with flashes and floaters. Retinal detachment needs urgent assessment.")

            val result = KalamosBookData.searchSectionsFrom(root, "book-12345678",
                JSONArray().put("retinal detachment").put("flashes floaters"), 4)
            val candidates = result.getJSONArray("candidates")
            assertEquals(1, candidates.length())
            assertEquals("pages-97-104", candidates.getJSONObject(0).getString("sectionId"))
            assertEquals(96, candidates.getJSONObject(0).getInt("page"))
            assert(candidates.getJSONObject(0).getString("snippet").contains("Retinal detachment"))
        } finally {
            root.deleteRecursively()
        }
    }
}
