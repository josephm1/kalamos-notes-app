package com.kalamos.foundation.documents

import android.os.Environment
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Read-only access to the small, generated KOReader book-data exchange.
 *
 * KOReader owns and opens the source book wherever the user keeps it. Kalamos never writes beside
 * that book: all maps, evidence, annotations and the source link live under
 * `/sdcard/Kalamos/BookData/<book-id>/`.
 */
object KalamosBookData {
    const val SHARED_DIRECTORY = "Kalamos/BookData"
    private val allowedFiles = setOf(
        "source.json", "book-card.json", "structure-map.json", "book-grammar.json",
        "analysis-manifest.json", "ink-annotations.json"
    )
    private val bookId = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$")

    fun readShared(id: String, requested: JSONArray): JSONObject = readFrom(
        File(Environment.getExternalStorageDirectory(), SHARED_DIRECTORY), id, requested
    )

    fun readSharedSections(id: String, requested: JSONArray): JSONObject = readSectionsFrom(
        File(Environment.getExternalStorageDirectory(), SHARED_DIRECTORY), id, requested
    )

    fun searchSharedSections(id: String, queries: JSONArray, limit: Int = 12): JSONObject =
        searchSectionsFrom(File(Environment.getExternalStorageDirectory(), SHARED_DIRECTORY), id, queries, limit)

    fun catalogShared(): JSONObject = catalogFrom(
        File(Environment.getExternalStorageDirectory(), SHARED_DIRECTORY)
    )

    /**
     * Returns only complete, internally consistent records and only their small discovery cards.
     * Maps, grammar and evidence remain lazy reads after a card has been selected.
     */
    fun catalogFrom(root: File): JSONObject {
        val books = JSONArray()
        var cardBytes = 0L
        root.listFiles().orEmpty()
            .asSequence()
            .filter(File::isDirectory)
            .filter { bookId.matches(it.name) }
            .sortedBy { it.name }
            .take(MAX_CATALOG_BOOKS)
            .forEach { directory ->
                val id = directory.name
                val source = readContractJson(directory, "source.json") ?: return@forEach
                val cardFile = directory.resolve("book-card.json")
                val card = readContractJson(directory, "book-card.json") ?: return@forEach
                val map = readContractJson(directory, "structure-map.json") ?: return@forEach
                val grammar = readContractJson(directory, "book-grammar.json") ?: return@forEach
                val manifest = readContractJson(directory, "analysis-manifest.json") ?: return@forEach
                if (source.optString("schema") != "kalamos.book-source/v1" ||
                    card.optString("schema") != "kalamos.book-card/v1" ||
                    map.optString("schema") != "kalamos.learn-structure-map/v1" ||
                    grammar.optString("schema") != "kalamos.living-book-grammar/v1" ||
                    manifest.optString("schema") != "kalamos.book-analysis-manifest/v1" ||
                    listOf(source, card, map, grammar, manifest).any { it.optString("bookId") != id } ||
                    manifest.optString("state") != "complete" ||
                    manifest.optString("sourceFingerprint") != source.optString("fingerprint") ||
                    map.optJSONObject("provider")?.optString("mode") != "ai-semantic-routing" ||
                    card.optJSONObject("generation")?.optString("mode") != "ai-semantic-routing" ||
                    source.optString("path").isBlank()
                ) return@forEach
                if (cardBytes + cardFile.length() > MAX_CATALOG_CARD_BYTES) return@forEach
                cardBytes += cardFile.length()
                books.put(JSONObject().put("bookId", id).put("card", card))
            }
        return JSONObject().put("schema", "kalamos.book-data-catalog/v1").put("books", books)
    }

    fun readFrom(root: File, id: String, requested: JSONArray): JSONObject {
        require(bookId.matches(id)) { "Invalid book id" }
        require(requested.length() in 1..allowedFiles.size) { "A bounded book-data file list is required" }
        val files = JSONObject()
        var total = 0L
        for (index in 0 until requested.length()) {
            val name = requested.getString(index)
            require(name in allowedFiles) { "Unsupported book-data file" }
            val file = File(File(root, id), name)
            if (!file.isFile) continue
            require(file.length() <= MAX_FILE_BYTES) { "$name is too large" }
            total += file.length()
            require(total <= MAX_TOTAL_BYTES) { "Book data is too large" }
            files.put(name, file.readText())
        }
        return JSONObject().put("bookId", id).put("files", files)
    }

    fun readSectionsFrom(root: File, id: String, requested: JSONArray): JSONObject {
        require(bookId.matches(id)) { "Invalid book id" }
        require(requested.length() in 1..MAX_SECTION_COUNT) { "A bounded section list is required" }
        val sections = JSONObject()
        var total = 0L
        for (index in 0 until requested.length()) {
            val sectionId = requested.getString(index)
            require(SECTION_ID.matches(sectionId)) { "Invalid section id" }
            val file = File(File(File(root, id), "sections"), "$sectionId.txt")
            if (!file.isFile) continue
            require(file.length() <= MAX_SECTION_BYTES) { "$sectionId is too large" }
            total += file.length()
            require(total <= MAX_SECTION_TOTAL_BYTES) { "Selected book sections are too large" }
            sections.put(sectionId, file.readText())
        }
        return JSONObject().put("bookId", id).put("sections", sections)
    }

    /**
     * Searches locally extracted evidence without sending the book to an AI. The result is a small
     * candidate list; a companion app may ask its model to choose among these candidates and only
     * then hydrate the selected section files.
     */
    fun searchSectionsFrom(root: File, id: String, queries: JSONArray, limit: Int = 12): JSONObject {
        require(bookId.matches(id)) { "Invalid book id" }
        require(queries.length() in 1..MAX_SEARCH_QUERIES) { "A bounded search query list is required" }
        require(limit in 1..MAX_SEARCH_RESULTS) { "Invalid section search limit" }
        val queryTexts = (0 until queries.length()).map { queries.getString(it).trim().lowercase() }
            .filter { it.length >= 2 }.distinct()
        require(queryTexts.isNotEmpty()) { "A usable section search query is required" }
        val queryTokens = queryTexts.map { text -> WORD.findAll(text).map(MatchResult::value).filter { it.length >= 3 }.toList() }
        val terms = queryTokens.flatten().distinct().take(MAX_SEARCH_TERMS)
        require(terms.isNotEmpty()) { "A usable section search query is required" }
        val phrases = queryTokens.flatMap { tokens ->
            (2..3).flatMap { width -> tokens.windowed(width).map { it.joinToString(" ") } }
        }.distinct().take(MAX_SEARCH_PHRASES)

        val directory = File(root, id)
        val catalog = readContractJson(directory, "structure-map.json")?.optJSONArray("sourceCatalog")
        val metadata = mutableMapOf<String, JSONObject>()
        if (catalog != null) for (index in 0 until catalog.length()) {
            val row = catalog.optJSONObject(index) ?: continue
            val sectionId = row.optString("id")
            if (SECTION_ID.matches(sectionId)) metadata[sectionId] = row
        }
        var scannedBytes = 0L
        val documents = directory.resolve("sections").listFiles().orEmpty().asSequence()
            .filter { it.isFile && it.extension == "txt" && SECTION_ID.matches(it.nameWithoutExtension) }
            .sortedBy { it.name }
            .take(MAX_SEARCH_SECTIONS)
            .mapNotNull { file ->
                if (file.length() !in 1..MAX_SECTION_BYTES || scannedBytes + file.length() > MAX_SEARCH_BYTES) return@mapNotNull null
                scannedBytes += file.length()
                val content = file.readText()
                Triple(file, content, content.lowercase())
            }.toList()
        val documentFrequency = terms.associateWith { term -> documents.count { (_, _, normalized) -> normalized.contains(term) }.coerceAtLeast(1) }
        val matches = documents.asSequence().mapNotNull { (file, content, normalized) ->
                val phraseHits = phrases.sumOf { phrase -> occurrences(normalized, phrase) }
                val termScore = terms.sumOf { term ->
                    val hits = occurrences(normalized, term).coerceAtMost(8)
                    hits * (1000 / documentFrequency.getValue(term))
                }
                if (phraseHits == 0 && termScore == 0) return@mapNotNull null
                val bestPhrase = phrases.filter { normalized.contains(it) }.maxByOrNull { phrase ->
                    phrase.split(' ').sumOf { term -> 1000 / (documentFrequency[term] ?: documents.size.coerceAtLeast(1)) }
                }
                val bestTerm = terms.filter { normalized.contains(it) }.maxByOrNull { term ->
                    1000 / documentFrequency.getValue(term)
                }
                val first = normalized.indexOf(bestPhrase ?: bestTerm ?: "").coerceAtLeast(0)
                val start = (first - SEARCH_SNIPPET_CHARS / 3).coerceAtLeast(0)
                val row = metadata[file.nameWithoutExtension]
                JSONObject()
                    .put("sectionId", file.nameWithoutExtension)
                    .put("label", row?.optString("label")?.ifBlank { row.optString("title") }
                        ?.ifBlank { file.nameWithoutExtension } ?: file.nameWithoutExtension)
                    .put("path", row?.optJSONArray("path") ?: JSONArray())
                    .put("page", row?.opt("page") ?: JSONObject.NULL)
                    .put("xpointer", row?.opt("xpointer") ?: JSONObject.NULL)
                    .put("score", phraseHits * 4000 + termScore)
                    .put("snippet", content.substring(start, (start + SEARCH_SNIPPET_CHARS).coerceAtMost(content.length))
                        .replace(Regex("\\s+"), " ").trim())
            }.sortedWith(compareByDescending<JSONObject> { it.getInt("score") }.thenBy { it.getString("sectionId") })
            .take(limit).toList()
        return JSONObject().put("schema", "kalamos.section-search/v1").put("bookId", id)
            .put("candidates", JSONArray(matches)).put("scannedBytes", scannedBytes)
    }

    private fun occurrences(haystack: String, needle: String): Int {
        var count = 0
        var offset = 0
        while (count < MAX_HITS_PER_TERM) {
            val found = haystack.indexOf(needle, offset)
            if (found < 0) break
            count++
            offset = found + needle.length.coerceAtLeast(1)
        }
        return count
    }

    private fun readContractJson(directory: File, name: String): JSONObject? {
        val file = directory.resolve(name)
        if (!file.isFile || file.length() !in 1..MAX_FILE_BYTES) return null
        return try { JSONObject(file.readText()) } catch (_: Exception) { null }
    }

    private const val MAX_FILE_BYTES = 2L * 1024 * 1024
    private const val MAX_TOTAL_BYTES = 4L * 1024 * 1024
    private const val MAX_SECTION_COUNT = 8
    private const val MAX_SECTION_BYTES = 1024L * 1024
    private const val MAX_SECTION_TOTAL_BYTES = 8L * 1024 * 1024
    private const val MAX_SEARCH_QUERIES = 8
    private const val MAX_SEARCH_TERMS = 32
    private const val MAX_SEARCH_PHRASES = 64
    private const val MAX_SEARCH_RESULTS = 20
    private const val MAX_SEARCH_SECTIONS = 4096
    private const val MAX_SEARCH_BYTES = 24L * 1024 * 1024
    private const val MAX_HITS_PER_TERM = 100
    private const val SEARCH_SNIPPET_CHARS = 700
    private const val MAX_CATALOG_BOOKS = 500
    private const val MAX_CATALOG_CARD_BYTES = 8L * 1024 * 1024
    private val SECTION_ID = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$")
    private val WORD = Regex("[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*")
}
