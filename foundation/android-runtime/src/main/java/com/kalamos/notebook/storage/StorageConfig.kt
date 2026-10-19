package com.kalamos.notebook.storage

import android.content.Context
import android.os.Environment
import java.io.File

/**
 * Resolves WHERE notebooks/thumbnails/library.json live. Default is the app's private internal
 * storage (filesDir); the user can point it at a real folder on another volume (e.g. the SD card)
 * via Settings. We store an absolute path and use plain java.io.File everywhere (fast — unlike the
 * Storage Access Framework), which on a non-private path requires the MANAGE_EXTERNAL_STORAGE
 * ("all files access") permission.
 */
object StorageConfig {
    private const val PREFS = "kalamos_storage"
    private const val KEY_ROOT = "root_path"
    private const val ROOT_CACHE_TTL_MS = 30_000L

    /** Root validation uses a real create/delete probe because File.canWrite is unreliable on the
     *  device's FUSE storage. That probe is intentionally expensive, so never repeat it for every
     *  ordinary file read. A short process-local cache keeps hot reader I/O read-only while still
     *  revalidating removable/chosen storage periodically. [setRoot] invalidates immediately. */
    @Volatile private var cachedRoot: File? = null
    @Volatile private var cachedRootAtMs: Long = 0L

    /** The canonical public folder on primary shared ("internal") storage: <sdcard>/Kalamos.
     *  Unlike app-private storage it is visible to file managers / adb / a desktop importer AND it
     *  survives app reinstalls, so notebooks and side-loaded books persist. Reading/writing it
     *  needs MANAGE_EXTERNAL_STORAGE ("all files access"). */
    val PUBLIC_ROOT: File get() = File(Environment.getExternalStorageDirectory(), "Kalamos")

    /** Apps that must read the single Books catalogue directly from shared device storage. */
    fun requiresBooksLibraryAccess(context: Context): Boolean =
        context.packageName == "com.kalamos.books" ||
            context.packageName == "com.kalamos.learn" ||
            context.packageName == "com.kalamos.play"

    /** Public, app-owned data folder. Notes and Books used to both point directly at
     *  `/sdcard/Kalamos`, which made both libraries read and mutate the same files. Keep the
     *  human-visible Kalamos parent, but give those two apps their own children. */
    fun publicAppRoot(context: Context): File = when (context.packageName) {
        "com.kalamos.books" -> File(PUBLIC_ROOT, "books")
        "com.kalamos.notebook" -> File(PUBLIC_ROOT, "notes")
        "com.kalamos.write" -> File(PUBLIC_ROOT, "write")
        else -> PUBLIC_ROOT
    }

    private fun usesSeparatedPublicRoot(context: Context): Boolean =
        context.packageName == "com.kalamos.books" || context.packageName == "com.kalamos.notebook" ||
            context.packageName == "com.kalamos.write"

    /** The active storage root.
     *  1. An explicit user choice (the stored path), if it's currently usable.
     *  2. Otherwise the persistent public Kalamos folder — but only when all-files access is granted
     *     AND it already exists, so a returning/reinstalled user keeps their folder automatically
     *     without re-picking it, while a brand-new user (no public folder yet) isn't silently moved.
     *  3. Otherwise app-private internal storage, so the app always has somewhere to read/write. */
    fun getRoot(context: Context): File {
        val now = android.os.SystemClock.elapsedRealtime()
        cachedRoot?.let { root ->
            if (now - cachedRootAtMs < ROOT_CACHE_TTL_MS) return root
        }
        return synchronized(this) {
            val checkedAt = android.os.SystemClock.elapsedRealtime()
            cachedRoot?.let { root ->
                if (checkedAt - cachedRootAtMs < ROOT_CACHE_TTL_MS) return@synchronized root
            }
            resolveRoot(context).also { root ->
                cachedRoot = root
                cachedRootAtMs = checkedAt
            }
        }
    }

    private fun resolveRoot(context: Context): File {
        // Books has one canonical device library. Never fork it into app-private storage merely
        // because broad storage access is missing: that makes Learn/Play see a different catalogue.
        // The app's storage-permission flow must restore access to this same location instead.
        if (context.packageName == "com.kalamos.books") {
            val booksRoot = publicAppRoot(context)
            if (hasAllFilesAccess() && !booksRoot.exists()) booksRoot.mkdirs()
            return booksRoot
        }
        val path = prefs(context).getString(KEY_ROOT, null)
        if (path != null) {
            val f = File(path)
            // Transparently upgrade the old shared public root. The migration is copy-only and
            // filtered by app, so an interrupted launch cannot damage the legacy library.
            if (usesSeparatedPublicRoot(context) && samePath(f, PUBLIC_ROOT) && hasAllFilesAccess()) {
                val appRoot = publicAppRoot(context)
                migrateLegacyPublicRoot(context, appRoot)
                if (isUsableDir(appRoot)) {
                    setRoot(context, appRoot.absolutePath)
                    return appRoot
                }
            }
            if (isUsableDir(f)) return f
            // A chosen path that's momentarily unusable (e.g. all-files access not yet (re)granted,
            // or the SD card was removed): fall through instead of crashing.
        } else if (hasAllFilesAccess() && PUBLIC_ROOT.exists() && isUsableDir(PUBLIC_ROOT)) {
            if (usesSeparatedPublicRoot(context)) {
                val appRoot = publicAppRoot(context)
                migrateLegacyPublicRoot(context, appRoot)
                if (isUsableDir(appRoot)) return appRoot
            }
            return PUBLIC_ROOT
        }
        return context.filesDir
    }

    private fun samePath(a: File, b: File): Boolean = try {
        a.canonicalPath == b.canonicalPath
    } catch (_: Exception) {
        a.absolutePath == b.absolutePath
    }

    /** Split this app's entries out of the former shared public library. Notes are copied, leaving the
     *  small legacy files as a rollback backup. Books are moved on the same volume so multi-gigabyte
     *  PDFs/EPUBs migrate quickly without doubling storage. Each move is atomic when possible and the
     *  merge fallback only removes a source file after its destination copy succeeds. */
    @Synchronized
    private fun migrateLegacyPublicRoot(context: Context, target: File) {
        val marker = File(target, ".migrated_shared_v1")
        if (marker.exists()) return
        try {
            if (!target.exists()) target.mkdirs()
            val legacyLibrary = File(PUBLIC_ROOT, "library.json")
            if (!legacyLibrary.isFile) {
                marker.writeText("no legacy library")
                return
            }

            val source = org.json.JSONObject(legacyLibrary.readText())
            val sourceItems = source.optJSONArray("notebooks") ?: org.json.JSONArray()
            val existingFile = File(target, "library.json")
            val destination = if (existingFile.isFile) {
                try { org.json.JSONObject(existingFile.readText()) } catch (_: Exception) { org.json.JSONObject() }
            } else org.json.JSONObject()
            if (!destination.has("version")) destination.put("version", source.optInt("version", 1))
            val outItems = destination.optJSONArray("notebooks") ?: org.json.JSONArray().also {
                destination.put("notebooks", it)
            }
            val known = HashSet<String>()
            val wantedFolders = HashSet<String>()
            for (i in 0 until outItems.length()) {
                val existing = outItems.optJSONObject(i) ?: continue
                known.add(existing.optString("notebookId"))
                existing.optString("folderId").takeIf { it.isNotBlank() }?.let { wantedFolders.add(it) }
            }
            val isBooksApp = context.packageName == "com.kalamos.books"
            for (i in 0 until sourceItems.length()) {
                val item = sourceItems.optJSONObject(i) ?: continue
                val id = item.optString("notebookId")
                if (id.isBlank()) continue
                val sourceNotebook = File(File(PUBLIC_ROOT, "notebooks"), id)
                val targetNotebook = File(File(target, "notebooks"), id)
                // A prior interrupted Books migration may already have moved the identifying
                // meta/book file out of the source. Inspect both sides so the next launch can still
                // add that entry to the destination library before writing the completion marker.
                val isBook = isBookNotebook(sourceNotebook) || isBookNotebook(targetNotebook)
                if (isBook != isBooksApp) continue
                if (known.add(id)) outItems.put(item)
                item.optString("folderId").takeIf { it.isNotBlank() }?.let { wantedFolders.add(it) }
                if (isBooksApp) moveRecursivelySafe(sourceNotebook, targetNotebook)
                else copyRecursivelySafe(sourceNotebook, targetNotebook)
                val legacyJson = File(File(PUBLIC_ROOT, "notebooks"), "$id.json")
                if (legacyJson.isFile) {
                    val targetJson = File(File(target, "notebooks"), "$id.json")
                    if (isBooksApp) moveRecursivelySafe(legacyJson, targetJson) else copyFileSafe(legacyJson, targetJson)
                }
                val thumb = File(File(PUBLIC_ROOT, "thumbnails"), "$id.png")
                if (thumb.isFile) {
                    val targetThumb = File(File(target, "thumbnails"), "$id.png")
                    if (isBooksApp) moveRecursivelySafe(thumb, targetThumb) else copyFileSafe(thumb, targetThumb)
                }
            }

            val outFolders = org.json.JSONArray()
            val knownFolders = HashSet<String>()
            val existingFolders = destination.optJSONArray("folders") ?: org.json.JSONArray()
            for (i in 0 until existingFolders.length()) {
                val folder = existingFolders.optJSONObject(i) ?: continue
                if (knownFolders.add(folder.optString("folderId"))) outFolders.put(folder)
            }
            val sourceFolders = source.optJSONArray("folders") ?: org.json.JSONArray()
            for (i in 0 until sourceFolders.length()) {
                val folder = sourceFolders.optJSONObject(i) ?: continue
                val id = folder.optString("folderId")
                if (id in wantedFolders && knownFolders.add(id)) outFolders.put(folder)
            }
            destination.put("folders", outFolders)
            atomicTextWrite(existingFile, destination.toString(2))
            marker.writeText("copied from ${PUBLIC_ROOT.absolutePath}")
        } catch (_: Exception) {
            // No marker: a later launch retries. All migration operations are copy-only.
        }
    }

    private fun isBookNotebook(dir: File): Boolean {
        if (File(dir, "book.pdf").isFile || File(dir, "book.epub").isFile || File(dir, "manifest.json").isFile) return true
        return try {
            val meta = File(dir, "meta.json")
            meta.isFile && org.json.JSONObject(meta.readText()).optString("bookRef").isNotBlank()
        } catch (_: Exception) { false }
    }

    private fun copyRecursivelySafe(source: File, target: File) {
        if (!source.exists()) return
        if (source.isFile) { copyFileSafe(source, target); return }
        target.mkdirs()
        source.listFiles()?.forEach { copyRecursivelySafe(it, File(target, it.name)) }
    }

    private fun copyFileSafe(source: File, target: File) {
        target.parentFile?.mkdirs()
        if (!target.exists()) source.copyTo(target, overwrite = false)
    }

    /** Same-filesystem fast path plus a restart-safe merge for a target left by an interrupted copy. */
    private fun moveRecursivelySafe(source: File, target: File) {
        if (!source.exists()) return
        target.parentFile?.mkdirs()
        if (!target.exists() && source.renameTo(target)) return
        if (source.isDirectory) {
            target.mkdirs()
            source.listFiles()?.forEach { moveRecursivelySafe(it, File(target, it.name)) }
            source.delete() // succeeds only when every child was moved
        } else {
            // Recovery after an interrupted migration: a completed copy may already be present.
            // Matching length is sufficient here because the target was created only from this
            // source path; skipping the redundant rewrite avoids minutes of FUSE I/O for caches.
            if (target.isFile && target.length() == source.length()) {
                source.delete()
                return
            }
            source.copyTo(target, overwrite = true)
            if (target.isFile && target.length() == source.length()) source.delete()
        }
    }

    private fun atomicTextWrite(target: File, text: String) {
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(target)) {
            target.delete()
            if (!tmp.renameTo(target)) throw java.io.IOException("Could not replace ${target.path}")
        }
    }

    /** True if [dir] exists (or can be created) AND is genuinely writable.
     *
     *  We probe with a real temp-file write instead of [File.canWrite] because on FUSE / scoped
     *  external volumes (notably the SD card) `canWrite()` can wrongly return `false` even when the
     *  app holds MANAGE_EXTERNAL_STORAGE and can write the folder fine. Trusting `canWrite()` there
     *  silently strands the user's chosen folder — the app falls back to internal private storage,
     *  so the library "reverts" and any data placed in the chosen folder never appears. An actual
     *  write is the only reliable test. */
    private fun isUsableDir(dir: File): Boolean {
        if (!dir.exists() && !dir.mkdirs()) return false
        return try {
            val probe = File(dir, ".kal_write_probe")
            probe.writeText("ok")
            probe.delete()
            true
        } catch (e: Exception) {
            false
        }
    }

    @Synchronized
    fun setRoot(context: Context, path: String?) {
        prefs(context).edit().putString(KEY_ROOT, path).apply()
        cachedRoot = null
        cachedRootAtMs = 0L
    }

    fun isInternal(context: Context): Boolean =
        getRoot(context).absolutePath == context.filesDir.absolutePath

    /** Volume roots the app can target: the app's private internal dir (always, no permission) plus
     *  the root of every mounted external volume (primary shared + SD card), discovered via
     *  getExternalFilesDirs (each entry is .../<volumeRoot>/Android/data/<pkg>/files). */
    fun externalVolumeRoots(context: Context): List<File> {
        return context.getExternalFilesDirs(null)
            .filterNotNull()
            .mapNotNull { dir ->
                // strip the trailing /Android/data/<pkg>/files to get the volume root
                val marker = "/Android/data/"
                val idx = dir.absolutePath.indexOf(marker)
                if (idx > 0) File(dir.absolutePath.substring(0, idx)) else null
            }
    }

    fun hasAllFilesAccess(): Boolean =
        android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R ||
            Environment.isExternalStorageManager()

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
