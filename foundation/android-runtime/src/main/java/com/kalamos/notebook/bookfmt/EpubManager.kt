package com.kalamos.notebook.bookfmt

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Xml
import com.kalamos.notebook.storage.StorageManager
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.util.zip.ZipFile

/**
 * EPUB backend (AD-4): opens `books/<id>/book.epub` as a [ZipFile] and, the first time a
 * notebook is opened, parses `META-INF/container.xml` -> the OPF (spine, manifest, metadata,
 * cover) and the NCX (EPUB2) or `nav.xhtml` (EPUB3) table of contents into a normalized
 * `epub-manifest.json` (AD-8 schema) cached alongside the book. Per-chapter plain text (tags
 * stripped) is cached once at `books/<id>/.cache/text/<idx>.txt` for both the `chars` count
 * and [search]. Everything else (open zip session, manifest read, chapter/asset bytes, cover
 * bitmap) is served straight from the cached manifest + the live zip.
 *
 * One open [ZipFile] is kept per notebook id ("session") until [close] is called; [entry] /
 * [assetDataUrl] / [extractCover] re-open lazily if the session was evicted or never opened.
 */
object EpubManager {

    private const val EMBEDDED_METADATA_VERSION = 3
    private val sessions = HashMap<String, ZipFile>()

    // ---- paths -----------------------------------------------------------------------------

    private fun notebookDir(storage: StorageManager, nbId: String): File =
        File(storage.getBookPath(nbId))

    private fun bookFile(storage: StorageManager, nbId: String): File =
        File(notebookDir(storage, nbId), "book.epub")

    private fun textCachePath(idx: Int) = ".cache/text/$idx.txt"

    // ---- session lifecycle -------------------------------------------------------------------

    /** Open (or re-open) the zip session for [nbId] and build `epub-manifest.json` + the text
     *  cache if they don't exist yet. Returns "ok" or "error: <message>". */
    @Synchronized
    fun open(nbId: String, storage: StorageManager): String {
        return try {
            closeLocked(nbId)
            val file = bookFile(storage, nbId)
            if (!file.isFile) return "error: book.epub not found"
            val zip = ZipFile(file)
            sessions[nbId] = zip
            val cachedManifest = storage.getBookFile(nbId, "epub-manifest.json")
            val needsMetadataRefresh = try {
                cachedManifest == null ||
                    JSONObject(cachedManifest).optInt("metadataVersion", 0) < EMBEDDED_METADATA_VERSION
            } catch (e: Exception) {
                true
            }
            if (needsMetadataRefresh) {
                buildManifestAndCache(nbId, storage, zip)
            }
            "ok"
        } catch (e: Exception) {
            closeLocked(nbId)
            "error: ${e.message}"
        }
    }

    @Synchronized
    fun close(nbId: String) {
        closeLocked(nbId)
    }

    private fun closeLocked(nbId: String) {
        sessions.remove(nbId)?.let { try { it.close() } catch (ignored: Exception) {} }
    }

    /** The open session for [nbId], opening it (and building the manifest, if needed) on demand. */
    @Synchronized
    private fun ensureOpen(nbId: String, storage: StorageManager): ZipFile? {
        sessions[nbId]?.let { return it }
        return if (open(nbId, storage).startsWith("ok")) sessions[nbId] else null
    }

    // ---- bridge-facing reads ------------------------------------------------------------------

    /** The cached `epub-manifest.json` contents, or "null" if not opened/parsed yet. */
    fun manifest(nbId: String, storage: StorageManager): String =
        storage.getBookFile(nbId, "epub-manifest.json") ?: "null"

    /** Raw text of one zip entry (a chapter's XHTML, a stylesheet, ...); "" if missing. The
     *  caller (JS) sanitizes markup before inserting it into the DOM (AD-4). */
    fun entry(nbId: String, zipPath: String, storage: StorageManager): String {
        val zip = ensureOpen(nbId, storage) ?: return ""
        return try {
            val ze = zip.getEntry(zipPath) ?: return ""
            zip.getInputStream(ze).use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (e: Exception) { "" }
    }

    /** One zip entry (image/font/css) as a base64 `data:` URL, mime guessed from the extension. */
    fun assetDataUrl(nbId: String, zipPath: String, storage: StorageManager): String {
        val zip = ensureOpen(nbId, storage) ?: return ""
        return try {
            val ze = zip.getEntry(zipPath) ?: return ""
            val bytes = zip.getInputStream(ze).use { it.readBytes() }
            "data:${mimeFor(zipPath)};base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        } catch (e: Exception) { "" }
    }

    /** Raw bytes of one zip entry (image/font/css) — used by
     *  [com.kalamos.notebook.bridge.BookContentInterceptor] (AD-3) to stream EPUB assets straight
     *  into `<img>`/`<link>` tags via the `kalamos.content` virtual host, without the base64
     *  round-trip [assetDataUrl] needs. null if missing/unreadable. Existing callers of [entry] /
     *  [assetDataUrl] are unaffected — this is an additive accessor. */
    fun entryBytes(nbId: String, zipPath: String, storage: StorageManager): ByteArray? {
        val zip = ensureOpen(nbId, storage) ?: return null
        return try {
            val ze = zip.getEntry(zipPath) ?: return null
            zip.getInputStream(ze).use { it.readBytes() }
        } catch (e: Exception) { null }
    }

    /** Public wrapper over the private [mimeFor] lookup, for callers outside this file (currently
     *  just [com.kalamos.notebook.bridge.BookContentInterceptor]). */
    fun mimeForPath(path: String): String = mimeFor(path)

    /** Decode the OPF-declared cover image entry to a [Bitmap] (used by CoverManager). Null if
     *  there's no cover entry or it fails to decode. */
    fun extractCover(nbId: String, storage: StorageManager): Bitmap? {
        val zip = ensureOpen(nbId, storage) ?: return null
        return try {
            val mf = manifest(nbId, storage)
            if (mf == "null") return null
            val coverPath = JSONObject(mf).optString("cover", "")
            if (coverPath.isBlank()) return null
            val ze = zip.getEntry(coverPath) ?: return null
            val bytes = zip.getInputStream(ze).use { it.readBytes() }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (e: Exception) { null }
    }

    /** Case-insensitive search over the cached per-chapter plain text, snippet ±40 chars, capped
     *  at [cap] matches total. Each hit carries `spineIdx` + `charOffset` so the reader can map it
     *  back to a paginated location. */
    fun search(nbId: String, query: String, storage: StorageManager, cap: Int = 200): JSONArray {
        val results = JSONArray()
        if (query.isBlank()) return results
        val mf = manifest(nbId, storage)
        if (mf == "null") return results
        val spine = try { JSONObject(mf).getJSONArray("spine") } catch (e: Exception) { return results }
        val q = query.lowercase()
        for (i in 0 until spine.length()) {
            if (results.length() >= cap) break
            val idx = spine.getJSONObject(i).optInt("idx", i)
            val text = storage.getBookFile(nbId, textCachePath(idx)) ?: continue
            val lower = text.lowercase()
            var from = 0
            while (results.length() < cap) {
                val pos = lower.indexOf(q, from)
                if (pos < 0) break
                val start = maxOf(0, pos - 40)
                val end = minOf(text.length, pos + q.length + 40)
                results.put(JSONObject().apply {
                    put("spineIdx", idx)
                    put("charOffset", pos)
                    put("snippet", text.substring(start, end))
                })
                from = pos + q.length
            }
        }
        return results
    }

    private fun mimeFor(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "gif" -> "image/gif"
        "webp" -> "image/webp"; "svg" -> "image/svg+xml"
        "css" -> "text/css"; "xhtml", "html", "htm" -> "text/html"
        "otf" -> "font/otf"; "ttf" -> "font/ttf"; "woff" -> "font/woff"; "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }

    // ---- manifest build (container.xml -> OPF -> NCX/nav) -------------------------------------

    private fun readZipText(zip: ZipFile, path: String): String? {
        val entry = zip.getEntry(path) ?: return null
        return try { zip.getInputStream(entry).use { it.readBytes().toString(Charsets.UTF_8) } }
        catch (e: Exception) { null }
    }

    private fun localName(qName: String) = qName.substringAfterLast(':')

    /** Resolve [href] (possibly with `../`, a `#fragment`, or `./`) against [baseDir] (a zip-root
     *  relative directory, "" for the zip root) into a normalized zip-root-relative path. */
    private fun resolveHref(baseDir: String, href: String): String {
        val clean = href.substringBefore('#').substringBefore('?')
        val combined = if (baseDir.isBlank()) clean else "$baseDir/$clean"
        val stack = ArrayList<String>()
        for (part in combined.split('/')) {
            when (part) {
                "", "." -> {}
                ".." -> if (stack.isNotEmpty()) stack.removeAt(stack.size - 1)
                else -> stack.add(part)
            }
        }
        return stack.joinToString("/")
    }

    private fun findOpfPath(zip: ZipFile): String {
        val xml = readZipText(zip, "META-INF/container.xml")
            ?: throw IllegalStateException("missing META-INF/container.xml")
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(xml.reader())
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG && localName(parser.name) == "rootfile") {
                parser.getAttributeValue(null, "full-path")?.let { return it }
            }
            event = parser.next()
        }
        throw IllegalStateException("no <rootfile> in container.xml")
    }

    private class ManifestItem(val id: String, val href: String, val mediaType: String, val properties: String)

    private class OpfResult(
        val title: String, val author: String, val language: String,
        val items: Map<String, ManifestItem>, val spineIdRefs: List<String>,
        val ncxId: String?, val coverItemId: String?
    )

    private fun parseOpf(xml: String): OpfResult {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(xml.reader())
        var title = ""; var author = ""; var language = ""
        val items = LinkedHashMap<String, ManifestItem>()
        val spineRefs = ArrayList<String>()
        var ncxId: String? = null
        var coverItemId: String? = null
        var section = ""
        var textTarget: String? = null
        val sb = StringBuilder()
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    when (val name = localName(parser.name)) {
                        "metadata" -> section = "metadata"
                        "manifest" -> section = "manifest"
                        "spine" -> { section = "spine"; ncxId = parser.getAttributeValue(null, "toc") }
                        "title" -> if (section == "metadata") { textTarget = "title"; sb.setLength(0) }
                        "creator" -> if (section == "metadata") { textTarget = "creator"; sb.setLength(0) }
                        "language" -> if (section == "metadata") { textTarget = "language"; sb.setLength(0) }
                        "meta" -> if (section == "metadata") {
                            if (parser.getAttributeValue(null, "name") == "cover") {
                                coverItemId = parser.getAttributeValue(null, "content")
                            }
                        }
                        "item" -> if (section == "manifest") {
                            val id = parser.getAttributeValue(null, "id") ?: ""
                            if (id.isNotEmpty()) items[id] = ManifestItem(
                                id,
                                parser.getAttributeValue(null, "href") ?: "",
                                parser.getAttributeValue(null, "media-type") ?: "",
                                parser.getAttributeValue(null, "properties") ?: ""
                            )
                        }
                        "itemref" -> if (section == "spine") {
                            parser.getAttributeValue(null, "idref")?.let { spineRefs.add(it) }
                        }
                        else -> {}
                    }
                }
                XmlPullParser.TEXT -> if (textTarget != null) sb.append(parser.text)
                XmlPullParser.END_TAG -> {
                    when (localName(parser.name)) {
                        "title" -> if (textTarget == "title") { title = sb.toString().trim(); textTarget = null }
                        "creator" -> if (textTarget == "creator") { author = sb.toString().trim(); textTarget = null }
                        "language" -> if (textTarget == "language") { language = sb.toString().trim(); textTarget = null }
                    }
                }
            }
            event = parser.next()
        }
        if (coverItemId == null) {
            coverItemId = items.values.firstOrNull { it.properties.contains("cover-image") }?.id
        }
        return OpfResult(title, author, language, items, spineRefs, ncxId, coverItemId)
    }

    /** Document-order `{label, href, level}` rows from an EPUB3 navigation document. EPUB 3 uses
     *  child `<ol>` elements to express subsidiary navigation, so retaining that depth is required
     *  for the reader's collapsible TOC instead of flattening the publisher's structure. */
    private fun parseNavToc(xml: String): JSONArray {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(xml.reader())
        val result = JSONArray()
        var inToc = false
        var tocDepth = -1
        var depth = 0
        var listDepth = 0
        var captureText = false
        var href: String? = null
        var hrefLevel = 1
        val sb = StringBuilder()
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    depth++
                    val name = localName(parser.name)
                    if (name == "nav") {
                        val type = parser.getAttributeValue(null, "epub:type") ?: ""
                        if (type.contains("toc")) { inToc = true; tocDepth = depth }
                    } else if (inToc && name == "ol") {
                        listDepth++
                    } else if (inToc && name == "a") {
                        href = parser.getAttributeValue(null, "href")
                        hrefLevel = maxOf(1, listDepth)
                        captureText = true
                        sb.setLength(0)
                    }
                }
                XmlPullParser.TEXT -> if (captureText) sb.append(parser.text)
                XmlPullParser.END_TAG -> {
                    val name = localName(parser.name)
                    if (name == "a" && captureText) {
                        captureText = false
                        if (inToc && href != null) {
                            result.put(JSONObject().apply {
                                put("label", sb.toString().trim())
                                put("href", href)
                                put("level", hrefLevel)
                            })
                        }
                        href = null
                    }
                    if (inToc && name == "ol") listDepth = maxOf(0, listDepth - 1)
                    if (name == "nav" && depth == tocDepth) { inToc = false; tocDepth = -1 }
                    depth--
                }
            }
            event = parser.next()
        }
        return result
    }

    /** Document-order `{label, href, level}` rows from an EPUB2 NCX `<navMap>`. */
    private fun parseNcxToc(xml: String): JSONArray {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(xml.reader())
        val result = JSONArray()
        var inNavMap = false
        var navDepth = 0
        var labelDepth = -1
        val labels = ArrayList<StringBuilder>()
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    when (localName(parser.name)) {
                        "navMap" -> inNavMap = true
                        "navPoint" -> if (inNavMap) {
                            navDepth++
                            labels.add(StringBuilder())
                        }
                        "text" -> if (inNavMap && navDepth > 0 && labels[navDepth - 1].isEmpty()) {
                            labelDepth = navDepth
                        }
                        "content" -> if (inNavMap && navDepth > 0) {
                            parser.getAttributeValue(null, "src")?.let { src ->
                                result.put(JSONObject().apply {
                                    put("label", labels[navDepth - 1].toString().trim())
                                    put("href", src)
                                    put("level", navDepth)
                                })
                            }
                        }
                        else -> {}
                    }
                }
                XmlPullParser.TEXT -> if (labelDepth == navDepth && navDepth > 0) {
                    labels[navDepth - 1].append(parser.text)
                }
                XmlPullParser.END_TAG -> {
                    when (localName(parser.name)) {
                        "text" -> if (labelDepth == navDepth) { labelDepth = -1 }
                        "navPoint" -> if (inNavMap && navDepth > 0) {
                            labels.removeAt(labels.size - 1)
                            navDepth--
                        }
                        "navMap" -> inNavMap = false
                    }
                }
            }
            event = parser.next()
        }
        return result
    }

    /** Resolve each raw `{label, href}` (href relative to [tocBaseDir], the TOC document's own
     *  directory) into a zip-root-relative href plus the matching `spineIdx` (-1 if not found). */
    private fun remapTocHrefs(raw: JSONArray, tocBaseDir: String, hrefToIdx: Map<String, Int>): JSONArray {
        val out = JSONArray()
        for (i in 0 until raw.length()) {
            val e = raw.getJSONObject(i)
            val rawHref = e.getString("href")
            val fragment = rawHref.substringAfter('#', "")
            val resolved = resolveHref(tocBaseDir, rawHref)
            out.put(JSONObject().apply {
                put("label", e.getString("label"))
                put("href", resolved + if (fragment.isNotEmpty()) "#$fragment" else "")
                put("spineIdx", hrefToIdx[resolved] ?: -1)
                put("level", maxOf(1, e.optInt("level", 1)))
            })
        }
        return out
    }

    /** Authored heading rows used only when a publisher supplies a completely flat nav list. Some
     *  otherwise well-structured EPUBs (including the Odyssey test book) put their real h3/h4
     *  sections in adjacent spine documents but omit them from nav.xhtml. The rows remain genuine
     *  EPUB headings and exact fragment targets; no labels are inferred from prose. */
    private fun parseDocumentHeadings(xml: String, href: String, spineIdx: Int): JSONArray {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(xml.reader())
        val result = JSONArray()
        var headingTag = 0
        var headingId = ""
        val sb = StringBuilder()
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    val name = localName(parser.name).lowercase()
                    if (name.length == 2 && name[0] == 'h' && name[1] in '1'..'6' && headingTag == 0) {
                        headingTag = name[1].digitToInt()
                        headingId = parser.getAttributeValue(null, "id") ?: ""
                        sb.setLength(0)
                    }
                }
                XmlPullParser.TEXT -> if (headingTag > 0) sb.append(parser.text)
                XmlPullParser.END_TAG -> {
                    val name = localName(parser.name).lowercase()
                    if (headingTag > 0 && name == "h$headingTag") {
                        val label = WHITESPACE_REGEX.replace(sb.toString(), " ").trim()
                        if (headingId.isNotBlank() && label.isNotBlank()) {
                            result.put(JSONObject().apply {
                                put("label", label)
                                put("href", "$href#$headingId")
                                put("spineIdx", spineIdx)
                                put("level", maxOf(2, headingTag - 1))
                            })
                        }
                        headingTag = 0
                        headingId = ""
                    }
                }
            }
            event = parser.next()
        }
        return result
    }

    private fun enrichFlatToc(toc: JSONArray, spine: JSONArray, zip: ZipFile): JSONArray {
        if (toc.length() == 0 || (0 until toc.length()).any { toc.getJSONObject(it).optInt("level", 1) > 1 }) {
            return toc
        }
        val out = JSONArray()
        val seenHrefs = HashSet<String>()
        for (i in 0 until toc.length()) {
            val parent = toc.getJSONObject(i)
            out.put(parent)
            seenHrefs.add(parent.optString("href"))
            val start = parent.optInt("spineIdx", -1)
            if (start < 0) continue
            var end = spine.length()
            for (next in i + 1 until toc.length()) {
                val nextIdx = toc.getJSONObject(next).optInt("spineIdx", -1)
                if (nextIdx > start) { end = nextIdx; break }
            }
            val parentLabel = parent.optString("label").trim().lowercase()
            for (spineIdx in start until minOf(end, spine.length())) {
                val href = spine.getJSONObject(spineIdx).optString("href")
                if (href.isBlank()) continue
                val headings = try {
                    readZipText(zip, href)?.let { parseDocumentHeadings(it, href, spineIdx) } ?: JSONArray()
                } catch (ignored: Exception) { JSONArray() }
                for (h in 0 until headings.length()) {
                    val row = headings.getJSONObject(h)
                    val rowHref = row.optString("href")
                    val label = row.optString("label").trim()
                    if (label.lowercase() == parentLabel || !seenHrefs.add(rowHref)) continue
                    out.put(row)
                    if (out.length() >= 600) return out
                }
            }
        }
        return out
    }

    private val TAG_REGEX = Regex("<[^>]*>")
    private val SCRIPT_STYLE_REGEX = Regex("(?is)<(script|style|head)[^>]*>.*?</\\1>")
    private val WHITESPACE_REGEX = Regex("\\s+")

    private fun stripTags(html: String): String {
        var body = SCRIPT_STYLE_REGEX.replace(html, " ")
        body = TAG_REGEX.replace(body, " ")
        body = body.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
            .replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'")
        return WHITESPACE_REGEX.replace(body, " ").trim()
    }

    private val IMAGE_TAG_REGEX = Regex(
        """<img\b[^>]*>""",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)
    )
    private val ATTRIBUTE_REGEX = Regex(
        """([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)
    )

    /**
     * Build a compact, document-order index of pictures referenced by one spine document. EPUB
     * XHTML is normally XML, but real books frequently contain entity or namespace mistakes that
     * make a strict pull parser reject the whole chapter. Attribute-only tag scanning is deliberate:
     * the reader still sanitizes the document before rendering, and this index accepts only local
     * image paths that resolve inside the zip. SVG-internal `<image>` nodes are not indexed because
     * the reader treats their containing SVG file as one picture rather than a second nested asset.
     */
    private fun chapterImages(xhtml: String, baseDir: String, spineIdx: Int): JSONArray {
        val out = JSONArray()
        var ordinal = 0
        for (tagMatch in IMAGE_TAG_REGEX.findAll(xhtml)) {
            val attrs = HashMap<String, String>()
            for (attr in ATTRIBUTE_REGEX.findAll(tagMatch.value)) {
                val name = attr.groupValues[1].lowercase()
                attrs[name] = attr.groupValues[2].ifEmpty { attr.groupValues[3] }
            }
            val source = attrs["src"] ?: attrs["xlink:href"] ?: attrs["href"] ?: continue
            if (
                source.isBlank() ||
                source.startsWith("data:", ignoreCase = true) ||
                source.startsWith("http:", ignoreCase = true) ||
                source.startsWith("https:", ignoreCase = true) ||
                source.startsWith("//")
            ) continue
            val zipPath = resolveHref(baseDir, source)
            if (zipPath.isBlank()) continue
            val label = attrs["alt"]?.trim().orEmpty()
                .ifBlank { attrs["aria-label"]?.trim().orEmpty() }
                .ifBlank { attrs["title"]?.trim().orEmpty() }
            out.put(JSONObject().apply {
                put("spineIdx", spineIdx)
                put("ordinal", ordinal++)
                put("zipPath", zipPath)
                if (label.isNotBlank()) put("label", label)
            })
        }
        return out
    }

    /** Parse container.xml -> OPF -> NCX/nav, write `epub-manifest.json` + per-chapter text cache.
     *  Embedded package metadata is normalized alongside the reader-specific spine/TOC data so
     *  importing and opening a book share one parse and one cache. */
    private fun buildManifestAndCache(nbId: String, storage: StorageManager, zip: ZipFile) {
        val opfPath = findOpfPath(zip)
        val opfDir = opfPath.substringBeforeLast('/', "")
        val opfXml = readZipText(zip, opfPath) ?: throw IllegalStateException("missing OPF at $opfPath")
        val opf = parseOpf(opfXml)
        val parsedMetadata = OpfMetadataParser.parse(opfXml)
        val metadata = parsedMetadata.copy(
            title = parsedMetadata.title ?: opf.title.ifBlank { null },
            authors = parsedMetadata.authors.ifEmpty {
                opf.author.takeIf { it.isNotBlank() }?.let(::listOf) ?: emptyList()
            },
            language = parsedMetadata.language ?: opf.language.ifBlank { null }
        )

        val spine = JSONArray()
        val images = JSONArray()
        val hrefToIdx = HashMap<String, Int>()
        var idx = 0
        for (idref in opf.spineIdRefs) {
            val item = opf.items[idref] ?: continue
            val href = resolveHref(opfDir, item.href)
            val xhtml = readZipText(zip, href) ?: ""
            val plain = stripTags(xhtml)
            spine.put(JSONObject().apply {
                put("idx", idx)
                put("href", href)
                put("chars", plain.length)
            })
            val chapterImages = chapterImages(xhtml, href.substringBeforeLast('/', ""), idx)
            for (imageIndex in 0 until chapterImages.length()) {
                images.put(chapterImages.getJSONObject(imageIndex))
            }
            hrefToIdx[href] = idx
            val cachePath = textCachePath(idx)
            // A metadata schema refresh does not imply that chapter text changed. Avoid another
            // fsync + external-storage rename (and its MediaProvider bookkeeping) for equal caches.
            if (storage.getBookFile(nbId, cachePath) != plain) {
                storage.saveBookFile(nbId, cachePath, plain)
            }
            idx++
        }

        val navItem = opf.items.values.firstOrNull { it.properties.contains("nav") }
        val ncxItem = opf.ncxId?.let { opf.items[it] }
        val authoredToc: JSONArray = when {
            navItem != null -> {
                val navHref = resolveHref(opfDir, navItem.href)
                readZipText(zip, navHref)?.let { remapTocHrefs(parseNavToc(it), navHref.substringBeforeLast('/', ""), hrefToIdx) }
                    ?: JSONArray()
            }
            ncxItem != null -> {
                val ncxHref = resolveHref(opfDir, ncxItem.href)
                readZipText(zip, ncxHref)?.let { remapTocHrefs(parseNcxToc(it), ncxHref.substringBeforeLast('/', ""), hrefToIdx) }
                    ?: JSONArray()
            }
            else -> JSONArray()
        }
        val toc = enrichFlatToc(authoredToc, spine, zip)

        val coverHref = opf.coverItemId?.let { id -> opf.items[id]?.let { resolveHref(opfDir, it.href) } }

        val manifestJson = metadata.applyTo(JSONObject()).apply {
            put("metadataVersion", EMBEDDED_METADATA_VERSION)
            if (!has("title")) put("title", "Untitled")
            if (!has("author")) put("author", "")
            if (!has("language")) put("language", "")
            put("cover", coverHref ?: JSONObject.NULL)
            put("spine", spine)
            put("toc", toc)
            put("images", images)
        }
        storage.saveBookFile(nbId, "epub-manifest.json", manifestJson.toString())
    }
}
