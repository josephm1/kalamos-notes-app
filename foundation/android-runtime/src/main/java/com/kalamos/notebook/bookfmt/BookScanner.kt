package com.kalamos.notebook.bookfmt

import android.content.Context
import com.kalamos.notebook.storage.NotebookInfo
import com.kalamos.notebook.storage.StorageConfig
import com.kalamos.notebook.storage.StorageManager
import com.kalamos.notebook.storage.Template
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Sideload importer (AD-7/WP12): scans `<storageRoot>/import/` and the current app's well-known
 * public root (Books uses `/sdcard/Kalamos/books/import/`). Both are created if absent; the two can
 * be the same directory when the active root already is the public folder, so they are
 * de-duplicated by canonical path. Each `.epub` / `.pdf` drop-in is MOVED into
 * `books/<id>/book.epub|book.pdf`, its `meta.json` (AD-8) is written, a `library.json` entry is
 * appended, and [CoverManager] is asked to backfill a thumbnail — through the exact same
 * [StorageManager] calls (`saveMetaRaw`, `loadLibrary`/`saveLibrary`) every other notebook-creation
 * path uses, so ordering/shape always match a hand-created notebook.
 *
 * Runs synchronously on whatever thread calls it — [com.kalamos.notebook.bridge.AndroidBridge
 * .scanForNewBooks] is the only caller and does the background-thread dispatch.
 *
 * Per-file outcome:
 *  - extension isn't `.epub`/`.pdf` (case-insensitive) -> ignored, not counted at all.
 *  - a complete `books/<slugFromFilename>/` record holds byte-for-byte identical content ->
 *    `skipped`, source file left untouched in `import/` (makes a re-scan idempotent).
 *  - identical content exists without both metadata and a library entry -> the interrupted import
 *    is resumed instead of being reported as a duplicate.
 *  - same slug directory exists but holds different content (or a different format) -> a fresh
 *    `-2`/`-3`/... suffixed id is used instead (no clobbering).
 *  - move fails, or the moved file doesn't parse as a valid EPUB/PDF -> rolled back (file moved
 *    back to `import/`, the just-created notebook dir removed) and counted `failed`.
 */
object BookScanner {

    private const val EMBEDDED_METADATA_VERSION = 1
    private const val ONLINE_METADATA_VERSION = 1
    private const val ONLINE_RETRY_AFTER_MS = 24L * 60L * 60L * 1_000L
    // Public-storage sidecar fsyncs and catalogue traffic compete noticeably with the e-ink UI.
    // Backfill one older book per launch; explicit/manual lookups must remain responsive.
    private const val MAX_ONLINE_BACKFILLS_PER_SCAN = 1
    private enum class Outcome { IMPORTED, SKIPPED, FAILED }

    private fun isoNow(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }

    /** Scan both import directories, then backfill embedded metadata for older imported books. */
    @Synchronized
    fun scan(storage: StorageManager, context: Context? = null): String {
        storage.migrateLegacyBookRecords()
        var imported = 0
        var skipped = 0
        var failed = 0
        for (dir in importDirs(storage, context)) {
            val files = dir.listFiles { f -> f.isFile } ?: continue
            for (file in files.sortedBy { it.name.lowercase(Locale.US) }) {
                val ext = file.extension.lowercase(Locale.US)
                if (ext != "epub" && ext != "pdf") continue   // unreadable/other extension -> ignore
                when (importOne(file, ext, storage)) {
                    Outcome.IMPORTED -> imported++
                    Outcome.SKIPPED -> skipped++
                    Outcome.FAILED -> failed++
                }
            }
        }
        val updated = refreshExistingMetadata(storage)
        return JSONObject().apply {
            put("imported", imported)
            put("skipped", skipped)
            put("failed", failed)
            put("updated", updated)
        }.toString()
    }

    /**
     * Import files already selected through Android's Storage Access Framework.
     *
     * The bridge first copies each selected URI into an app-cache batch. Successful imports are
     * moved from that batch into the canonical notebook directory by [importOne]; the bridge then
     * removes the batch, including any rejected copy. This keeps the existing parser, metadata,
     * cover and library-index pipeline as the single import implementation without requiring
     * broad access to the source folder.
     */
    @Synchronized
    fun importSelectedFiles(storage: StorageManager, files: List<File>): String {
        var imported = 0
        var skipped = 0
        var failed = 0
        for (file in files) {
            val ext = file.extension.lowercase(Locale.US)
            if (!file.isFile || (ext != "epub" && ext != "pdf")) {
                failed++
                continue
            }
            when (importOne(file, ext, storage)) {
                Outcome.IMPORTED -> imported++
                Outcome.SKIPPED -> skipped++
                Outcome.FAILED -> failed++
            }
        }
        return JSONObject().apply {
            put("imported", imported)
            put("skipped", skipped)
            put("failed", failed)
            put("updated", 0)
        }.toString()
    }

    /** The two watched import directories (AD-7), de-duplicated by canonical path — the active
     *  storage root and the public Kalamos folder are frequently the same directory once the user
     *  has granted all-files access. Created if absent; a directory that still isn't usable after
     *  `mkdirs()` (e.g. no permission) is simply skipped, not an error. */
    private fun importDirs(storage: StorageManager, context: Context?): List<File> {
        // Books owns `/sdcard/Kalamos/books`; do not recreate or scan the old shared
        // `/sdcard/Kalamos/import` folder used by early Notes/Books builds.
        val publicBooksRoot = context?.let { StorageConfig.publicAppRoot(it) }
        val roots = listOfNotNull(File(storage.getAppDataDir()), publicBooksRoot)
        val seen = HashSet<String>()
        val out = ArrayList<File>()
        for (root in roots) {
            val dir = File(root, "import")
            val canon = try { dir.canonicalPath } catch (e: Exception) { dir.absolutePath }
            if (!seen.add(canon)) continue
            if (!dir.exists()) dir.mkdirs()
            if (dir.isDirectory) out.add(dir)
        }
        return out
    }

    private fun importOne(file: File, ext: String, storage: StorageManager): Outcome {
        var id: String? = null
        var destination: File? = null
        var sourceMoved = false
        return try {
            val fallbackTitle = titleFromFilename(file.name)
            val baseSlug = slugify(file.name)

            val baseDir = File(storage.getBookPath(baseSlug))
            val existingBook = File(baseDir, "book.$ext")
            val resumesInterruptedImport = existingBook.isFile &&
                sameBookContent(existingBook, file)
            if (
                resumesInterruptedImport &&
                isCompleteImport(baseSlug, ext, storage)
            ) {
                return Outcome.SKIPPED
            }

            val importId = if (resumesInterruptedImport) baseSlug else uniqueId(baseSlug, storage)
            id = importId
            val dest = if (resumesInterruptedImport) {
                existingBook
            } else {
                File(storage.getBookPath(importId), "book.$ext")
            }
            destination = dest
            if (!resumesInterruptedImport) {
                if (!moveFile(file, dest)) return Outcome.FAILED
                sourceMoved = true
            }

            val parsed = parseBook(importId, ext, storage, fallbackTitle)
            if (parsed == null) {
                rollbackIncompleteImport(importId, file, dest, sourceMoved, storage)
                return Outcome.FAILED
            }
            val enriched = enrichOnline(parsed)
            if (!writeMeta(importId, ext, enriched.metadata, enriched, storage)) {
                rollbackIncompleteImport(importId, file, dest, sourceMoved, storage)
                return Outcome.FAILED
            }
            if (!addLibraryEntry(importId, enriched.metadata.title ?: fallbackTitle, storage)) {
                rollbackIncompleteImport(importId, file, dest, sourceMoved, storage)
                return Outcome.FAILED
            }
            // Cover generation is recoverable and must not turn an otherwise committed import into
            // an orphan. Library rendering will retry CoverManager.ensure on demand.
            try { CoverManager.ensure(importId, storage) } catch (_: Exception) {}
            if (!sourceMoved) file.delete()
            Outcome.IMPORTED
        } catch (e: Exception) {
            val failedId = id
            val failedDestination = destination
            if (failedId != null && failedDestination != null) {
                rollbackIncompleteImport(
                    failedId,
                    file,
                    failedDestination,
                    sourceMoved,
                    storage
                )
            }
            Outcome.FAILED
        }
    }

    /**
     * A duplicate is complete only when its sidecar and library row both exist. The payload alone is
     * an interrupted import and must be resumed on the next picker attempt.
     */
    private fun isCompleteImport(id: String, ext: String, storage: StorageManager): Boolean {
        val meta = try {
            storage.peekMetaRaw(id)?.let(::JSONObject)
        } catch (_: Exception) {
            null
        } ?: return false
        if (meta.optString("format", "").lowercase(Locale.US) != ext) return false
        if (meta.optString("file", "") != "book.$ext") return false
        return storage.loadLibrary().notebooks.any { it.notebookId == id }
    }

    /**
     * Size alone is not a content identity. Hash only the rare same-name/same-format collision so
     * normal imports do not pay this I/O cost.
     */
    internal fun sameBookContent(first: File, second: File): Boolean {
        if (!first.isFile || !second.isFile || first.length() != second.length()) return false
        fun digest(file: File): ByteArray {
            val md = java.security.MessageDigest.getInstance("SHA-256")
            file.inputStream().buffered().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (count > 0) md.update(buffer, 0, count)
                }
            }
            return md.digest()
        }
        return digest(first).contentEquals(digest(second))
    }

    private fun rollbackIncompleteImport(
        id: String,
        source: File,
        destination: File,
        sourceMoved: Boolean,
        storage: StorageManager
    ) {
        if (sourceMoved && destination.isFile) moveFile(destination, source)
        File(storage.getBookPath(id)).deleteRecursively()
        val index = storage.loadLibrary()
        if (index.notebooks.any { it.notebookId == id }) {
            storage.saveLibrary(index.copy(notebooks = index.notebooks.filterNot {
                it.notebookId == id
            }))
        }
    }

    private fun parseBook(
        id: String,
        ext: String,
        storage: StorageManager,
        fallbackTitle: String
    ): EmbeddedBookMetadata? = when (ext) {
        "epub" -> parseEpub(id, storage, fallbackTitle)
        "pdf" -> parsePdf(id, storage, fallbackTitle)
        else -> null
    }

    /** EPUB2/3 package metadata via [EpubManager]'s real OPF parse. */
    private fun parseEpub(
        id: String,
        storage: StorageManager,
        fallbackTitle: String
    ): EmbeddedBookMetadata? {
        val opened = EpubManager.open(id, storage)
        if (!opened.startsWith("ok")) return null
        return try {
            val mf = EpubManager.manifest(id, storage)
            val json = if (mf != "null") JSONObject(mf) else return null
            val parsed = EmbeddedBookMetadata.fromJson(json)
            val title = parsed.title?.takeUnless { it.equals("Untitled", ignoreCase = true) } ?: fallbackTitle
            val description = parsed.description ?: epubDescriptionFallback(id, json, storage)
            parsed.copy(
                title = title,
                titleSource = if (parsed.title.isNullOrBlank() ||
                    parsed.title.equals("Untitled", ignoreCase = true)
                ) "filename" else parsed.titleSource ?: "embedded",
                description = description,
                descriptionSource = parsed.descriptionSource
                    ?: description?.let { "excerpt" }
            )
        } catch (e: Exception) {
            null
        } finally {
            EpubManager.close(id)
        }
    }

    /** Validate with the renderer, then ask the Books-owned PDFBox seam for the PDF Info fields. */
    private fun parsePdf(
        id: String,
        storage: StorageManager,
        fallbackTitle: String
    ): EmbeddedBookMetadata? {
        val opened = PdfRenderService.open(id, storage)
        PdfRenderService.close(id)
        if (opened.startsWith("error")) return null
        val service = BookServices.pdfText
        return try {
            val parsed = service?.embeddedMetadata(id)?.let {
                EmbeddedBookMetadata.fromJson(JSONObject(it))
            } ?: EmbeddedBookMetadata()
            val description = parsed.description ?: service?.fallbackDescription(id)
            parsed.copy(
                title = parsed.title ?: fallbackTitle,
                titleSource = if (parsed.title.isNullOrBlank()) "filename"
                    else parsed.titleSource ?: "embedded",
                description = description,
                descriptionSource = parsed.descriptionSource
                    ?: description?.let { "excerpt" }
            )
        } catch (e: Exception) {
            EmbeddedBookMetadata(title = fallbackTitle, titleSource = "filename")
        } finally {
            service?.close(id)
        }
    }

    /**
     * Kalamos' reflowable blocks format already has a manifest and sidecar, so both are useful.
     * The sidecar wins (it may contain a user's corrections); manifest values fill its gaps.
     */
    private fun parseBlocks(
        id: String,
        storage: StorageManager,
        sidecar: JSONObject
    ): EmbeddedBookMetadata? {
        val manifestRaw = storage.getBookFile(id, "manifest.json") ?: return null
        return try {
            val current = EmbeddedBookMetadata.fromJson(sidecar)
            val manifestJson = JSONObject(manifestRaw)
            val manifest = EmbeddedBookMetadata.fromJson(manifestJson).let {
                it.copy(
                    titleSource = it.title?.let { "embedded" },
                    descriptionSource = it.description?.let { "embedded" }
                )
            }
            val combined = current.fillMissing(manifest)
            val hadDescription = !combined.description.isNullOrBlank()
            val description = combined.description
                ?: blocksDescriptionFallback(id, manifestJson, storage)
            combined.copy(
                titleSource = combined.titleSource ?: combined.title?.let { "embedded" },
                description = description,
                descriptionSource = combined.descriptionSource
                    ?: description?.let { if (hadDescription) "embedded" else "excerpt" }
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun blocksDescriptionFallback(
        id: String,
        manifest: JSONObject,
        storage: StorageManager
    ): String? {
        val spine = manifest.optJSONArray("spine") ?: return null
        return BookDescriptionFallback.fromCandidates(
            (0 until minOf(spine.length(), 8)).asSequence().mapNotNull { position ->
                val sectionId = spine.optJSONObject(position)?.optString("sectionId", "")
                    ?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val raw = storage.getBookFile(id, "sections/$sectionId.json")
                    ?: return@mapNotNull null
                try {
                    val blocks = JSONObject(raw).optJSONArray("blocks") ?: return@mapNotNull null
                    buildString {
                        for (i in 0 until blocks.length()) {
                            val block = blocks.optJSONObject(i) ?: continue
                            val type = block.optString("type", "")
                            if (type in setOf("image", "table", "math")) continue
                            val text = sequenceOf("md", "text", "content", "caption")
                                .map { block.optString(it, "") }
                                .firstOrNull { it.isNotBlank() }
                            if (!text.isNullOrBlank()) append(text).append(' ')
                        }
                    }
                } catch (_: Exception) {
                    null
                }
            }
        )
    }

    private fun epubDescriptionFallback(
        id: String,
        manifest: JSONObject,
        storage: StorageManager
    ): String? {
        val spine = manifest.optJSONArray("spine") ?: return null
        return BookDescriptionFallback.fromCandidates(
            (0 until minOf(spine.length(), 8)).asSequence().mapNotNull { position ->
                val idx = spine.optJSONObject(position)?.optInt("idx", position) ?: position
                storage.getBookFile(id, ".cache/text/$idx.txt")
            }
        )
    }

    private fun writeMeta(
        id: String,
        ext: String,
        metadata: EmbeddedBookMetadata,
        enrichment: OnlineEnrichment,
        storage: StorageManager
    ): Boolean {
        val now = isoNow()
        val meta = metadata.applyTo(JSONObject()).apply {
            put("notebookId", id)
            put("format", ext)          // "epub" | "pdf"
            put("file", "book.$ext")
            put("folderId", "")
            put("createdAt", now)
            put("updatedAt", now)
            put("embeddedMetadataVersion", EMBEDDED_METADATA_VERSION)
            put("metadataSource", "book-file")
        }
        recordOnlineResult(meta, enrichment, now)
        return storage.saveMetaRaw(id, meta.toString())
    }

    /**
     * Older imports predate embedded metadata extraction. Refresh them once on the same background
     * scan that already runs at library launch, preserving all user-owned sidecar fields.
     */
    private fun refreshExistingMetadata(storage: StorageManager): Int {
        val index = storage.loadLibrary()
        var updated = 0
        var libraryChanged = false
        var onlineAttempts = 0
        val notebooks = index.notebooks.map { info ->
            try {
                val raw = storage.peekMetaRaw(info.notebookId) ?: return@map info
                val meta = JSONObject(raw)
                val declaredFormat = meta.optString("format", "").lowercase(Locale.US)
                val format = if (
                    declaredFormat == "blocks" ||
                    (declaredFormat.isBlank() && meta.optString("bookRef", "").isNotBlank())
                ) "blocks" else declaredFormat
                if (format !in setOf("epub", "pdf", "blocks")) return@map info
                if (format == "blocks") {
                    if (!File(storage.getBookPath(info.notebookId), "manifest.json").isFile) {
                        return@map info
                    }
                } else if (!File(
                        storage.getBookPath(info.notebookId),
                        "book.$format"
                    ).isFile
                ) return@map info

                var metadata = EmbeddedBookMetadata.fromJson(meta)
                var shouldSave = false
                var visibleMetadataChanged = false

                if (meta.optInt("embeddedMetadataVersion", 0) < EMBEDDED_METADATA_VERSION) {
                    val parsed = if (format == "blocks") {
                        parseBlocks(info.notebookId, storage, meta)
                    } else {
                        parseBook(info.notebookId, format, storage, info.title)
                    } ?: return@map info
                    parsed.applyTo(meta)
                    metadata = EmbeddedBookMetadata.fromJson(meta)
                    meta.put("embeddedMetadataVersion", EMBEDDED_METADATA_VERSION)
                    meta.put("metadataSource", if (format == "blocks") "book-manifest" else "book-file")
                    shouldSave = true
                    visibleMetadataChanged = true
                }

                if (
                    BookServices.onlineMetadata != null &&
                    meta.optInt("onlineMetadataVersion", 0) < ONLINE_METADATA_VERSION &&
                    onlineAttempts < MAX_ONLINE_BACKFILLS_PER_SCAN &&
                    onlineRetryDue(meta)
                ) {
                    onlineAttempts++
                    val enrichment = enrichOnline(metadata)
                    if (enrichment.result != null) {
                        if (enrichment.result.status == OnlineLookupStatus.FOUND) {
                            enrichment.metadata.applyTo(meta)
                            metadata = enrichment.metadata
                            visibleMetadataChanged = true
                        }
                        recordOnlineResult(meta, enrichment, isoNow())
                        shouldSave = true
                    }
                }

                if (shouldSave && !storage.saveMetaRaw(info.notebookId, meta.toString())) {
                    return@map info
                }
                if (visibleMetadataChanged) updated++

                val title = metadata.title?.takeIf { it.isNotBlank() } ?: info.title
                if (title != info.title) {
                    libraryChanged = true
                    info.copy(title = title)
                } else {
                    info
                }
            } catch (e: Exception) {
                info
            }
        }
        if (libraryChanged) storage.saveLibrary(index.copy(notebooks = notebooks))
        return updated
    }

    private data class OnlineEnrichment(
        val metadata: EmbeddedBookMetadata,
        val before: EmbeddedBookMetadata,
        val result: OnlineBookMetadataResult?
    )

    private fun enrichOnline(metadata: EmbeddedBookMetadata): OnlineEnrichment {
        val service = BookServices.onlineMetadata
            ?: return OnlineEnrichment(metadata, metadata, null)
        val result = try {
            service.lookup(
                BookMetadataQuery(
                    title = metadata.title,
                    authors = metadata.authors,
                    identifiers = metadata.identifiers
                )
            )
        } catch (_: Exception) {
            OnlineBookMetadataResult(OnlineLookupStatus.UNAVAILABLE, "online catalogue")
        }
        val merged = if (result.status == OnlineLookupStatus.FOUND && result.metadata != null) {
            metadata.mergeOnline(result.metadata)
        } else metadata
        return OnlineEnrichment(merged, metadata, result)
    }

    private fun onlineRetryDue(meta: JSONObject): Boolean {
        val lastAttempt = meta.optLong("onlineMetadataLastAttemptAt", 0L)
        return lastAttempt <= 0L || System.currentTimeMillis() - lastAttempt >= ONLINE_RETRY_AFTER_MS
    }

    /**
     * Keep the complete provider suggestion and the pre-lookup values. The library UI can therefore
     * show exactly what changed and let the user explicitly overwrite any local/embedded field.
     */
    private fun recordOnlineResult(
        meta: JSONObject,
        enrichment: OnlineEnrichment,
        checkedAt: String
    ) {
        val result = enrichment.result ?: return
        meta.put("onlineMetadataProvider", result.provider)
        meta.put("onlineMetadataLastAttemptAt", System.currentTimeMillis())
        meta.put("onlineMetadataCheckedAt", checkedAt)
        meta.put("onlineMetadataStatus", when (result.status) {
            OnlineLookupStatus.FOUND -> "found"
            OnlineLookupStatus.NOT_FOUND -> "not-found"
            OnlineLookupStatus.UNAVAILABLE -> "unavailable"
        })
        if (result.status == OnlineLookupStatus.UNAVAILABLE) return
        meta.put("onlineMetadataVersion", ONLINE_METADATA_VERSION)
        if (result.status == OnlineLookupStatus.FOUND && result.metadata != null) {
            meta.put("onlineMetadataCandidate", result.metadata.toJson().apply {
                put("provider", result.provider)
                result.recordId?.let { put("recordId", it) }
            })
            meta.put("onlineMetadataBefore", enrichment.before.toJson())
            result.recordId?.let { meta.put("onlineMetadataRecordId", it) }
        }
    }

    private fun addLibraryEntry(id: String, title: String, storage: StorageManager): Boolean {
        val now = isoNow()
        val index = storage.loadLibrary()
        if (index.notebooks.any { it.notebookId == id }) return true
        val info = NotebookInfo(
            notebookId = id,
            title = title,
            folderId = "",
            createdAt = now,
            updatedAt = now,
            defaultTemplate = Template.DEFAULT
        )
        return storage.saveLibrary(index.copy(notebooks = index.notebooks + info))
    }

    // ---- filename helpers -----------------------------------------------------------------------

    /** lowercase, alnum+dash id from a filename (extension stripped, runs of anything else
     *  collapsed to a single `-`, leading/trailing dashes trimmed). "book" if that leaves nothing. */
    private fun slugify(filename: String): String {
        val noExt = filename.substringBeforeLast('.', filename)
        val slug = noExt.lowercase(Locale.US).replace(Regex("[^a-z0-9]+"), "-").trim('-')
        return if (slug.isBlank()) "book" else slug
    }

    /** Human title from a filename: extension stripped, `-`/`_`/`.` runs -> spaces, each word
     *  capitalized. "war_and_peace.epub" -> "War And Peace". */
    private fun titleFromFilename(filename: String): String {
        val noExt = filename.substringBeforeLast('.', filename)
        val spaced = noExt.replace(Regex("[-_.]+"), " ").trim()
        if (spaced.isBlank()) return "Untitled"
        return spaced.split(Regex("\\s+")).joinToString(" ") { w ->
            if (w.isEmpty()) w else w[0].uppercaseChar() + w.substring(1).lowercase(Locale.US)
        }
    }

    /** [baseSlug] if `books/<baseSlug>/` doesn't exist yet, else the first free `<baseSlug>-N`
     *  (N starting at 2). Only reached for a genuine collision (the same-size duplicate case is
     *  handled — and returns before this is called — by the caller). */
    private fun uniqueId(baseSlug: String, storage: StorageManager): String {
        if (!File(storage.getBookPath(baseSlug)).exists()) return baseSlug
        var n = 2
        while (File(storage.getBookPath("$baseSlug-$n")).exists()) n++
        return "$baseSlug-$n"
    }

    /** Rename [src] to [dest], falling back to copy+delete for a cross-filesystem move (e.g.
     *  SD card <-> internal storage) where `renameTo` fails. */
    private fun moveFile(src: File, dest: File): Boolean {
        return try {
            dest.parentFile?.mkdirs()
            if (src.renameTo(dest)) return true
            src.copyTo(dest, overwrite = true)
            src.delete()
            dest.isFile
        } catch (e: Exception) {
            false
        }
    }
}
