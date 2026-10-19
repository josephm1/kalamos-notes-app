package com.kalamos.notebook.bookfmt

import org.json.JSONArray
import org.json.JSONObject

/**
 * Small, format-neutral metadata record extracted from a book itself.
 *
 * This deliberately mirrors the useful subset KOReader normalizes for its book-info cache while
 * retaining a few publication fields already consumed by the Books hierarchy. Reader progress,
 * favourites, folders and other user-owned values do not belong here and remain in `meta.json`.
 */
data class EmbeddedBookMetadata(
    val title: String? = null,
    val titleSource: String? = null,
    val authors: List<String> = emptyList(),
    val series: String? = null,
    val seriesIndex: Double? = null,
    val language: String? = null,
    val subjects: List<String> = emptyList(),
    val keywords: List<String> = emptyList(),
    val description: String? = null,
    val descriptionSource: String? = null,
    val identifiers: List<String> = emptyList(),
    val publisher: String? = null,
    val publicationDate: String? = null,
    val rights: String? = null,
    val documentCreatedAt: String? = null,
    val documentModifiedAt: String? = null,
    val creatorTool: String? = null,
    val producer: String? = null,
    val coverUrl: String? = null,
    val onlineRecordUrl: String? = null
) {
    val primaryAuthor: String get() = authors.joinToString(", ")

    /** Write only source-owned fields, leaving progress/folder/favourite sidecar values intact. */
    fun applyTo(target: JSONObject): JSONObject {
        title.clean()?.let { target.put("title", it) }
        titleSource.clean()?.let { target.put("titleSource", it) }
        cleanList(authors).takeIf { it.isNotEmpty() }?.let {
            target.put("author", it.joinToString(", "))
            target.put("authors", JSONArray(it))
        }
        series.clean()?.let { target.put("series", it) }
        seriesIndex?.takeIf { it.isFinite() }?.let {
            target.put("seriesIndex", it)
            target.put("series_index", it)
        }
        language.clean()?.let { target.put("language", it) }
        cleanList(subjects).takeIf { it.isNotEmpty() }?.let { target.put("subjects", JSONArray(it)) }
        cleanList(keywords).takeIf { it.isNotEmpty() }?.let { target.put("keywords", JSONArray(it)) }
        description.clean()?.let { target.put("description", it) }
        descriptionSource.clean()?.let { target.put("descriptionSource", it) }
        cleanList(identifiers).takeIf { it.isNotEmpty() }?.let { target.put("identifiers", JSONArray(it)) }
        publisher.clean()?.let { target.put("publisher", it) }
        publicationDate.clean()?.let {
            target.put("publicationDate", it)
            Regex("""\b(1[0-9]{3}|20[0-9]{2}|2100)\b""").find(it)?.value?.toIntOrNull()
                ?.let { year -> target.put("publicationYear", year) }
        }
        rights.clean()?.let { target.put("rights", it) }
        documentCreatedAt.clean()?.let { target.put("documentCreatedAt", it) }
        documentModifiedAt.clean()?.let { target.put("documentModifiedAt", it) }
        creatorTool.clean()?.let { target.put("creatorTool", it) }
        producer.clean()?.let { target.put("producer", it) }
        coverUrl.clean()?.let { target.put("coverUrl", it) }
        onlineRecordUrl.clean()?.let { target.put("onlineRecordUrl", it) }
        return target
    }

    fun toJson(): JSONObject = applyTo(JSONObject())

    /** Fill gaps from another local source, while keeping the sidecar/primary source authoritative. */
    fun fillMissing(localFallback: EmbeddedBookMetadata): EmbeddedBookMetadata = copy(
        title = title ?: localFallback.title,
        titleSource = titleSource ?: localFallback.titleSource,
        authors = authors.ifEmpty { localFallback.authors },
        series = series ?: localFallback.series,
        seriesIndex = seriesIndex ?: localFallback.seriesIndex,
        language = language ?: localFallback.language,
        subjects = cleanList(subjects + localFallback.subjects),
        keywords = cleanList(keywords + localFallback.keywords),
        description = description ?: localFallback.description,
        descriptionSource = descriptionSource ?: localFallback.descriptionSource,
        identifiers = cleanList(identifiers + localFallback.identifiers),
        publisher = publisher ?: localFallback.publisher,
        publicationDate = publicationDate ?: localFallback.publicationDate,
        rights = rights ?: localFallback.rights,
        documentCreatedAt = documentCreatedAt ?: localFallback.documentCreatedAt,
        documentModifiedAt = documentModifiedAt ?: localFallback.documentModifiedAt,
        creatorTool = creatorTool ?: localFallback.creatorTool,
        producer = producer ?: localFallback.producer,
        coverUrl = coverUrl ?: localFallback.coverUrl,
        onlineRecordUrl = onlineRecordUrl ?: localFallback.onlineRecordUrl
    )

    /**
     * Embedded values win. Online data fills gaps, adds catalogue subjects/identifiers, and may
     * replace only filename-derived titles or source-text description excerpts.
     */
    fun mergeOnline(online: EmbeddedBookMetadata): EmbeddedBookMetadata = copy(
        title = if (title.isNullOrBlank() || titleSource == "filename") online.title ?: title else title,
        titleSource = if (title.isNullOrBlank() || titleSource == "filename") {
            online.title?.let { "online" } ?: titleSource
        } else titleSource,
        authors = authors.ifEmpty { online.authors },
        series = series ?: online.series,
        seriesIndex = seriesIndex ?: online.seriesIndex,
        language = language ?: online.language,
        subjects = cleanList(subjects + online.subjects),
        keywords = cleanList(keywords + online.keywords),
        description = if (description.isNullOrBlank() || descriptionSource == "excerpt") {
            online.description ?: description
        } else description,
        descriptionSource = if (
            (description.isNullOrBlank() || descriptionSource == "excerpt") &&
            !online.description.isNullOrBlank()
        ) "online" else descriptionSource,
        identifiers = cleanList(identifiers + online.identifiers),
        publisher = publisher ?: online.publisher,
        publicationDate = publicationDate ?: online.publicationDate,
        rights = rights ?: online.rights,
        coverUrl = coverUrl ?: online.coverUrl,
        onlineRecordUrl = onlineRecordUrl ?: online.onlineRecordUrl
    )

    companion object {
        fun fromJson(json: JSONObject): EmbeddedBookMetadata {
            val authors = stringList(json, "authors").ifEmpty {
                listOfNotNull(
                    json.optString("author", "").clean()
                        ?: json.optString("creator", "").clean()
                )
            }
            val subjects = cleanList(
                stringList(json, "subjects") + stringList(json, "subject") +
                    stringList(json, "categories") + stringList(json, "category") +
                    stringList(json, "genres") + stringList(json, "genre")
            )
            val keywords = stringList(json, "keywords")
            val identifiers = cleanList(
                stringList(json, "identifiers") + stringList(json, "identifier") +
                    stringList(json, "isbn") + stringList(json, "isbn10") +
                    stringList(json, "isbn13") + stringList(json, "doi")
            )
            val seriesIndex = when {
                json.has("seriesIndex") -> json.optDouble("seriesIndex").takeIf { it.isFinite() }
                json.has("series_index") -> json.optDouble("series_index").takeIf { it.isFinite() }
                else -> null
            }
            return EmbeddedBookMetadata(
                title = json.optString("title", "").clean(),
                titleSource = json.optString("titleSource", "").clean(),
                authors = cleanList(authors),
                series = json.optString("series", "").clean()
                    ?: json.optString("collection", "").clean(),
                seriesIndex = seriesIndex,
                language = json.optString("language", "").clean(),
                subjects = cleanList(subjects),
                keywords = cleanList(keywords),
                description = json.optString("description", "").clean()
                    ?: json.optString("summary", "").clean()
                    ?: json.optString("synopsis", "").clean(),
                descriptionSource = json.optString("descriptionSource", "").clean(),
                identifiers = cleanList(identifiers),
                publisher = json.optString("publisher", "").clean(),
                publicationDate = json.optString("publicationDate", "").clean()
                    ?: json.optString("publishedAt", "").clean()
                    ?: json.optString("published", "").clean()
                    ?: json.optString("year", "").clean(),
                rights = json.optString("rights", "").clean(),
                documentCreatedAt = json.optString("documentCreatedAt", "").clean(),
                documentModifiedAt = json.optString("documentModifiedAt", "").clean(),
                creatorTool = json.optString("creatorTool", "").clean(),
                producer = json.optString("producer", "").clean(),
                coverUrl = json.optString("coverUrl", "").clean(),
                onlineRecordUrl = json.optString("onlineRecordUrl", "").clean()
            )
        }

        private fun stringList(json: JSONObject, key: String): List<String> {
            val value = json.opt(key) ?: return emptyList()
            return when (value) {
                is JSONArray -> (0 until value.length()).mapNotNull { value.optString(it, "").clean() }
                else -> value.toString().split(Regex("""[\n;|]+""")).mapNotNull { it.clean() }
            }
        }
    }
}

private fun String?.clean(): String? = this?.trim()?.takeIf { it.isNotEmpty() }

private fun cleanList(values: List<String>): List<String> {
    val seen = LinkedHashSet<String>()
    values.mapNotNull { it.clean() }.forEach(seen::add)
    return seen.toList()
}
