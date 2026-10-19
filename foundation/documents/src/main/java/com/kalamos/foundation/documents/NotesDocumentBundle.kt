package com.kalamos.foundation.documents

import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** Portable data boundary, never a renderer, storage owner, or model-executed command. */
object NotesDocumentBundle {
    const val MIME = "application/vnd.kalamos.notes-document+zip"
    const val PROPOSAL_MIME = "application/vnd.kalamos.notes-proposal+json"
    const val SCHEMA = "kalamos.notes-document/v1"
    const val PROPOSAL_SCHEMA = "kalamos.notes-proposal/v1"
    const val MAX_BYTES = 100 * 1024 * 1024
    private val path = Regex("pages/[a-zA-Z0-9_-]+\\.(md|json|jpg)")
    private val id = Regex("[a-zA-Z0-9_-]{1,120}")
    private val revision = Regex("[a-f0-9]{64}")
    fun sha(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    /** Compact inline styles use UTF-16 offsets, matching Kotlin strings and the web editor. */
    fun styles(text:String,input:JSONArray):JSONArray {
        require(input.length()<=2000) { "Too many inline style ranges" }
        var previousEnd=0;val result=JSONArray()
        for(i in 0 until input.length()) {
            val range=input.getJSONObject(i)
            require(range.keys().asSequence().all{it in setOf("start","end","bold","italic","strike")}) { "Unsupported inline style field" }
            fun offset(key:String):Int {
                val value=range.get(key);require(value is Number && value.toDouble().isFinite() && value.toDouble()==value.toInt().toDouble()) { "Invalid inline style offset" }
                return value.toInt()
            }
            val start=offset("start");val end=offset("end")
            require(start>=previousEnd && start>=0 && end>start && end<=text.length) { "Invalid or overlapping inline style range" }
            val normalized=JSONObject().put("start",start).put("end",end);var enabled=false
            for(flag in listOf("bold","italic","strike"))if(range.has(flag)) {
                require(range.get(flag) is Boolean) { "Invalid inline style flag" }
                if(range.getBoolean(flag)){normalized.put(flag,true);enabled=true}
            }
            require(enabled) { "Empty inline style range" }
            val prior=if(result.length()>0)result.getJSONObject(result.length()-1) else null
            if(prior!=null && prior.getInt("end")==start && listOf("bold","italic","strike").all{prior.optBoolean(it)==normalized.optBoolean(it)})prior.put("end",end)
            else result.put(normalized)
            previousEnd=end
        }
        return result
    }
    fun blocks(input: JSONArray): JSONArray {
        require(input.length() <= 2000) { "Too many document elements" }
        val ids = HashSet<String>()
        for (i in 0 until input.length()) {
            val b = input.getJSONObject(i)
            require(id.matches(b.getString("id")) && ids.add(b.getString("id"))) { "Duplicate or invalid element identity" }
            require(b.getString("type") in setOf("heading", "paragraph", "bullet", "numbered", "task")) { "Unsupported document element" }
            require(b.getString("text").length <= 20000 && !b.getString("text").contains('\u0000')) { "Invalid document text" }
            if(b.has("styles"))b.put("styles",styles(b.getString("text"),b.getJSONArray("styles")))
            if (b.getString("type") == "task") require(b.get("checked") is Boolean) { "Task state is required" }
        }
        val byId=(0 until input.length()).associate { input.getJSONObject(it).getString("id") to input.getJSONObject(it) }
        for(i in 0 until input.length()) {
            var cursor=input.getJSONObject(i);val seen=HashSet<String>();var depth=0
            while(cursor.has("parentId")) {
                val parent=cursor.getString("parentId")
                require(id.matches(parent) && seen.add(cursor.getString("id")) && depth++<4) { "Invalid element group" }
                cursor=requireNotNull(byId[parent]) { "Unknown element group" }
            }
        }
        return input
    }
    /** Logical image frame and actual raster size; no model-authored layout coordinates. */
    fun imageFrame(frame:JSONObject):JSONObject {
        for(key in listOf("x","y","width","height")) {
            val value=frame.getDouble(key)
            require(value.isFinite() && (key !in setOf("width","height") || value>0 && value<=20_000)) { "Invalid page image frame" }
        }
        for(key in listOf("pixelWidth","pixelHeight")) {
            val value=frame.getDouble(key);require(value.isFinite() && value%1.0==0.0 && value in 1.0..8192.0) { "Invalid page image size" }
        }
        return frame
    }
    private fun proposalHeader(value:JSONObject) {
        require(value.toString().toByteArray().size <= 80000 && value.getString("schema") == PROPOSAL_SCHEMA)
        UUID.fromString(value.getString("proposalId"))
        require(value.getString("title").length in 1..200)
        if (value.optString("documentId").isNotBlank()) UUID.fromString(value.getString("documentId"))
        if (value.optString("baseRevisionId").isNotBlank()) require(revision.matches(value.getString("baseRevisionId")))
        value.optJSONArray("targetPageIds")?.let { pages ->
            require(pages.length() in 1..32) { "Invalid target page scope" }
            val seen = HashSet<String>()
            for (i in 0 until pages.length()) require(id.matches(pages.getString(i)) && seen.add(pages.getString(i))) { "Invalid target page scope" }
        }
        require(!value.has("targetPageIds") || value.optJSONArray("targetPageIds") != null) { "Invalid target page scope" }
        val operation=value.optString("operation","organize")
        require(operation in setOf("organize","replace_ink","replace_page")) { "Unsupported note operation" }
    }
    private fun validateInkRegions(regions:JSONArray,pageIds:Set<String>) {
            require(regions.length()<=2000) { "Too many ink regions" }
            val regionIds=HashSet<String>()
            for(i in 0 until regions.length()) {
                val region=regions.getJSONObject(i)
                require(id.matches(region.getString("id")) && regionIds.add(region.getString("id")) && region.getString("pageId") in pageIds && id.matches(region.getString("runId"))) { "Invalid ink region" }
                val strokes=region.getJSONArray("strokeIds");val strokeIds=HashSet<String>();require(strokes.length()>0)
                for(n in 0 until strokes.length())require(id.matches(strokes.getString(n)) && strokeIds.add(strokes.getString(n)))
                val bounds=region.getJSONObject("bounds")
                for(key in listOf("x","y","width","height"))require(bounds.getDouble(key).isFinite())
                require(bounds.getDouble("width")>0 && bounds.getDouble("height")>0)
            }
    }
    /** Transport admission only. Markdown becomes editor-owned blocks before preparation/apply. */
    fun proposalEnvelope(value:JSONObject):JSONObject {
        if(!value.has("markdown"))return proposal(value)
        proposalHeader(value)
        require(value.get("markdown") is String) { "Invalid Markdown text" }
        val markdown=value.getString("markdown")
        require(markdown.isNotBlank() && markdown.length<=60000 && !markdown.contains('\u0000')) { "Invalid Markdown text" }
        require(value.optString("operation") in setOf("replace_ink", "replace_page") && value.optString("documentId").isNotBlank() && value.optString("baseRevisionId").isNotBlank()) { "Markdown transcription requires its original document revision" }
        require(value.getJSONArray("blocks").length()==0) { "Markdown transport must not contain model-authored editor blocks" }
        val pages=value.getJSONArray("targetPageIds")
        val pageIds=(0 until pages.length()).map{pages.getString(it)}.toSet()
        if (value.optString("operation") == "replace_ink") {
            val regions=value.getJSONArray("sourceInkRegions")
            require(regions.length()>0) { "Markdown transcription has no source ink" }
            validateInkRegions(regions,pageIds)
        } else require(pages.length() == 1) { "Image formatting requires one page" }
        return value
    }
    fun proposal(value: JSONObject): JSONObject {
        proposalHeader(value)
        val operation=value.optString("operation","organize")
        if(operation=="replace_ink") {
            require(value.optString("documentId").isNotBlank() && value.optString("baseRevisionId").isNotBlank()) { "Transcription requires its original document revision" }
            val consumed=HashMap<String,String>();val elements=value.getJSONArray("blocks")
            require(elements.length()>0) { "Transcription contains no text" }
            for(i in 0 until elements.length()) {
                val block=elements.getJSONObject(i);require(block.getString("text").isNotBlank()) { "Unread ink cannot be deleted" }
                val regions=block.getJSONArray("sourceInkRegionIds");require(regions.length() in 1..2000)
                val local=HashSet<String>();val group=regions.toString()
                for(n in 0 until regions.length()) {
                    val ref=regions.getString(n)
                    require(id.matches(ref) && local.add(ref)) { "Duplicate or invalid ink region reference" }
                    val previous=consumed.putIfAbsent(ref,group)
                    require(previous==null || previous==group) { "Overlapping ink replacement groups" }
                }
            }
        }
        blocks(value.getJSONArray("blocks"))
        return value
    }
    fun read(input: InputStream): Pair<JSONObject, Map<String, ByteArray>> {
        val files = linkedMapOf<String, ByteArray>()
        var total = 0
        ZipInputStream(input).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                require(!e.isDirectory && (e.name == "manifest.json" || path.matches(e.name)) && !files.containsKey(e.name)) { "Invalid bundle path" }
                require(files.size < 99) { "Too many bundle files" }
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val n = zip.read(buffer); if (n < 0) break
                    total += n; require(total <= MAX_BYTES) { "Bundle too large" }
                    out.write(buffer, 0, n)
                    if (e.name == "manifest.json") require(out.size() <= 1024 * 1024)
                }
                files[e.name] = out.toByteArray()
            }
        }
        val manifest = JSONObject(String(requireNotNull(files.remove("manifest.json")), Charsets.UTF_8))
        validate(manifest, files)
        return manifest to files
    }
    fun validate(manifest: JSONObject, files: Map<String, ByteArray>) {
        require(manifest.getString("schema") == SCHEMA)
        UUID.fromString(manifest.getString("documentId"))
        require(revision.matches(manifest.getString("revisionId")))
        require(manifest.getString("title").length in 1..200)
        blocks(manifest.getJSONArray("blocks"))
        val pages = manifest.getJSONArray("pages")
        require(pages.length() in 1..32)
        val expected = hashSetOf<String>(); val ids = hashSetOf<String>()
        for (i in 0 until pages.length()) {
            val p = pages.getJSONObject(i)
            require(id.matches(p.getString("id")) && ids.add(p.getString("id")))
            p.optJSONObject("imageFrame")?.let { require(p.has("previewFile"));imageFrame(it) }
            require(!p.has("imageFrame") || p.optJSONObject("imageFrame")!=null)
            for (key in listOf("sourceFile", "sidecarFile", "previewFile")) {
                if (!p.has(key)) { require(key == "previewFile"); continue }
                val name = p.getString(key)
                require(path.matches(name) && expected.add(name) && files.containsKey(name))
                require(name.endsWith(when (key) { "sourceFile" -> ".md"; "sidecarFile" -> ".json"; else -> ".jpg" }))
            }
        }
        manifest.optJSONArray("inkRegions")?.let { validateInkRegions(it,ids) }
        require(!manifest.has("inkRegions") || manifest.optJSONArray("inkRegions")!=null)
        if(manifest.has("thumbnailFile")) {
            val thumbnail=manifest.getString("thumbnailFile")
            require(path.matches(thumbnail) && thumbnail.endsWith(".jpg") && files.containsKey(thumbnail)) { "Invalid notebook thumbnail" }
            expected.add(thumbnail)
        }
        require(expected == files.keys) { "Unexpected or missing files" }
        val checksums = manifest.getJSONObject("checksums")
        require(checksums.keys().asSequence().toSet() == expected)
        files.forEach { (name, bytes) -> require(sha(bytes) == checksums.getString(name)) { "Corrupt bundle file" } }
    }
    fun write(manifest: JSONObject, files: Map<String, ByteArray>, output: OutputStream) {
        manifest.put("checksums", JSONObject().apply { files.forEach { (name, bytes) -> put(name, sha(bytes)) } })
        validate(manifest, files)
        ZipOutputStream(output).use { zip ->
            (mapOf("manifest.json" to manifest.toString().toByteArray()) + files).forEach { (name, bytes) ->
                zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry()
            }
        }
    }
}
