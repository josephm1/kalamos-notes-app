package com.kalamos.notebook.bookfmt

import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

/** EPUB 2/3 package metadata parser, independent of rendering and Android UI state. */
internal object OpfMetadataParser {

    private data class ElementValue(
        val name: String,
        val value: String,
        val attributes: Map<String, String>
    )

    fun parse(xml: String): EmbeddedBookMetadata {
        val parser = XmlPullParserFactory.newInstance().newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(xml.reader())

        val values = ArrayList<ElementValue>()
        var inMetadata = false
        var captureName: String? = null
        var captureAttributes: Map<String, String> = emptyMap()
        val text = StringBuilder()

        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    val name = localName(parser.name)
                    if (name == "metadata") {
                        inMetadata = true
                    } else if (inMetadata && captureName == null && name in metadataElements) {
                        captureName = name
                        captureAttributes = attributes(parser)
                        text.setLength(0)
                        if (name == "meta") {
                            captureAttributes["content"]?.let(text::append)
                        }
                    }
                }
                XmlPullParser.TEXT, XmlPullParser.CDSECT -> if (captureName != null) {
                    text.append(parser.text)
                }
                XmlPullParser.END_TAG -> {
                    val name = localName(parser.name)
                    if (captureName == name) {
                        values += ElementValue(name, cleanMetadataText(text.toString()), captureAttributes)
                        captureName = null
                        captureAttributes = emptyMap()
                        text.setLength(0)
                    }
                    if (name == "metadata") inMetadata = false
                }
            }
            event = parser.next()
        }

        fun all(name: String): List<String> =
            values.filter { it.name == name }.map { it.value }.filter { it.isNotBlank() }.distinct()

        val metas = values.filter { it.name == "meta" }
        fun legacyMeta(vararg names: String): String? {
            val accepted = names.map { it.lowercase() }.toSet()
            return metas.firstNotNullOfOrNull { meta ->
                val key = (meta.attributes["name"] ?: meta.attributes["property"] ?: "").lowercase()
                meta.value.takeIf { key in accepted && it.isNotBlank() }
            }
        }

        val collections = metas.filter {
            it.attributes["property"]?.lowercase() == "belongs-to-collection" && it.value.isNotBlank()
        }
        fun collectionType(collection: ElementValue): String? {
            val id = collection.attributes["id"]?.let { "#$it" }
            return id?.let {
                metas.firstOrNull { meta ->
                    meta.attributes["property"]?.lowercase() == "collection-type" &&
                        meta.attributes["refines"] == id
                }?.value
            }
        }
        val seriesCollection = collections.firstOrNull { collection ->
            collectionType(collection).equals("series", ignoreCase = true)
        } ?: collections.firstOrNull { collection ->
            // Older EPUB 3 producers emitted belongs-to-collection without a collection-type
            // refinement. Treat that as a series, but never mislabel an explicit "set".
            collectionType(collection).isNullOrBlank()
        }

        val series = legacyMeta("calibre:series", "series") ?: seriesCollection?.value
        val seriesIndexRaw = legacyMeta("calibre:series_index", "series_index")
            ?: seriesCollection?.attributes?.get("id")?.let { id ->
                metas.firstOrNull {
                    it.attributes["property"]?.lowercase() == "group-position" &&
                        it.attributes["refines"] == "#$id"
                }?.value
            }

        val subjects = all("subject")
        return EmbeddedBookMetadata(
            title = all("title").firstOrNull(),
            titleSource = all("title").firstOrNull()?.let { "embedded" },
            authors = all("creator"),
            series = series,
            seriesIndex = seriesIndexRaw?.toDoubleOrNull(),
            language = all("language").firstOrNull(),
            subjects = subjects,
            keywords = subjects,
            description = all("description").firstOrNull(),
            descriptionSource = all("description").firstOrNull()?.let { "embedded" },
            identifiers = all("identifier"),
            publisher = all("publisher").firstOrNull(),
            publicationDate = all("date").firstOrNull(),
            rights = all("rights").firstOrNull()
        )
    }

    private val metadataElements = setOf(
        "title", "creator", "language", "subject", "description",
        "identifier", "publisher", "date", "rights", "meta"
    )

    private fun localName(name: String): String = name.substringAfter(':')

    private fun attributes(parser: XmlPullParser): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (i in 0 until parser.attributeCount) {
            out[localName(parser.getAttributeName(i))] = parser.getAttributeValue(i)
        }
        return out
    }

    private fun cleanMetadataText(value: String): String =
        value.replace(Regex("""(?is)<[^>]+>"""), " ")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace(Regex("""\s+"""), " ")
            .trim()
}
