package com.kalamos.notebook.exchange

import android.content.Context
import com.kalamos.foundation.documents.NotesDocumentBundle as Bundle
import com.kalamos.foundation.documents.NotesInteractiveMerge
import com.kalamos.foundation.documents.NotesFilename
import com.kalamos.notebook.storage.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID

/** Notes is the mutable authority. Revisions are immutable; page index is the commit record. */
class AgoraDocuments(private val context: Context) {
    private val storage = StorageManager(context)
    private val root = File(context.filesDir, "agora-documents").apply { mkdirs() }
    private fun safeId(id: String): String { require(Regex("[a-zA-Z0-9_-]{1,120}").matches(id)); return id }
    private fun record(id: String) = File(root, "${UUID.fromString(id)}.json")
    private fun readRecord(id: String): JSONObject = JSONObject(record(id).readText())
    fun notebook(documentId: String): String = readRecord(documentId).getString("notebookId")
    fun link(notebookId: String): JSONObject = synchronized(lock) {
        safeId(notebookId)
        val existing = storage.getNotebookFile(notebookId, "agora.document.json")
        if (existing != null) return@synchronized JSONObject(existing)
        require(storage.loadLibrary().notebooks.any { it.notebookId == notebookId }) { "Notebook is unavailable" }
        val value = JSONObject().put("documentId", UUID.randomUUID().toString()).put("notebookId", notebookId)
        require(storage.saveNotebookFile(notebookId, "agora.document.json", value.toString()))
        atomic(record(value.getString("documentId")), value.toString().toByteArray())
        value
    }
    fun origin(notebookId: String, pkg: String?, owner: String?) {
        if (pkg !in setOf("com.newoether.agora", "com.newoether.agora.einkpreview") || owner.isNullOrBlank()) return
        synchronized(lock) { val r=link(notebookId);r.put("originPackage",pkg).put("ownerId",owner.take(200));atomic(record(r.getString("documentId")),r.toString().toByteArray()) }
    }
    fun index(notebookId: String): JSONObject = JSONObject(storage.getNotebookFile(safeId(notebookId), "planning.pages.json") ?:
        """{"version":1,"active":0,"pages":[{"id":"first","sourceFile":"planning.write2.md","sidecarFile":"planning.write2.json"}]}""")
    fun pages(notebookId: String): JSONArray {
        val pages=index(notebookId).getJSONArray("pages");require(pages.length()<=1000)
        return JSONArray().apply { for(i in 0 until pages.length()) {
            val p=pages.getJSONObject(i);safeId(p.getString("id"))
            for(key in listOf("sourceFile","sidecarFile"))require(Regex("planning\\.[a-zA-Z0-9_.-]+\\.(md|json)").matches(p.getString(key)))
            put(JSONObject().put("id",p.getString("id"))
                .put("source",storage.getNotebookFile(notebookId,p.getString("sourceFile")) ?: "\u200b")
                .put("sidecar",JSONObject(storage.getNotebookFile(notebookId,p.getString("sidecarFile")) ?: """{"magic":"write2.sidecar","schemaVersion":1,"inkRuns":[],"unplacedInk":[],"blockAnchors":[]}""")))
        } }
    }
    private fun canonical(value: Any?): String = when(value) {
        is JSONObject -> value.keys().asSequence().filter { it !in setOf("updatedAt","createdAt") }.sorted().joinToString(",","{","}") { JSONObject.quote(it)+":"+canonical(value.get(it)) }
        is JSONArray -> (0 until value.length()).joinToString(",","[","]") { canonical(value.get(it)) }
        is String -> JSONObject.quote(value)
        null, JSONObject.NULL -> "null"
        else -> value.toString()
    }
    private fun revisionForSnapshot(notebookTitle:String, loadedPages:JSONArray):String =
        Bundle.sha(canonical(JSONObject().put("title",notebookTitle).put("pages",loadedPages)).toByteArray())
    fun revision(notebookId: String): String = revisionForSnapshot(title(notebookId),pages(notebookId))
    /** Preparation needs a revision fence, not a full ink/semantic payload over the bridge. */
    fun revisionSnapshot(notebookId:String):JSONObject = synchronized(lock) {
        val identity=link(notebookId)
        JSONObject().put("documentId",identity.getString("documentId")).put("revisionId",revision(notebookId))
    }
    /** Image-only AI admission: scope authorization without ZIP, projection or thumbnail work.
     * Undo captures the authoritative original locally at commit, before any page is replaced. */
    fun prepareImage(notebookId:String,pageId:String,expectedRevision:String):JSONObject = synchronized(lock) {
        val identity=link(notebookId);val loaded=pages(notebookId);val notebookTitle=title(notebookId)
        val revision=revisionForSnapshot(notebookTitle,loaded)
        require(revision==expectedRevision) { "Note changed while preparing its image. Try again." }
        require((0 until loaded.length()).any{loaded.getJSONObject(it).getString("id")==pageId}) { "Selected page is unavailable" }
        val scopeFile=File(revisions(identity.getString("documentId")),"$revision.scopes.json")
        val scopes=if(scopeFile.exists())JSONArray(scopeFile.readText())else JSONArray()
        if((0 until scopes.length()).none { scopes.getJSONArray(it).length()==1 && scopes.getJSONArray(it).getString(0)==pageId }) {
            scopes.put(JSONArray().put(pageId));atomic(scopeFile,scopes.toString().toByteArray())
        }
        JSONObject().put("documentId",identity.getString("documentId")).put("revisionId",revision).put("title",notebookTitle).put("pageId",pageId)
    }
    private fun title(id: String) = storage.loadLibrary().notebooks.firstOrNull { it.notebookId==id }?.title ?: error("Notebook unavailable")
    private fun projection(pages: JSONArray, allPages:JSONArray=pages): JSONArray {
        val allTicks=HashMap<String,Boolean>()
        for(i in 0 until allPages.length()){val boxes=allPages.getJSONObject(i).getJSONObject("sidecar").optJSONArray("textBoxes")?:JSONArray();for(n in 0 until boxes.length()){val b=boxes.getJSONObject(n);val s=b.optJSONObject("semantic");if(s?.optString("role")=="checkbox")allTicks[s.getString("id")]=b.optString("text")=="☑"}}
        val result=linkedMapOf<String,JSONObject>()
        for(i in 0 until pages.length()) {
            val page=pages.getJSONObject(i);val pageId=page.getString("id")
            val source=page.getString("source").replace("\u200b", "").trim()
            if(source.isNotEmpty())result["source-$pageId"]=JSONObject().put("id","source-$pageId").put("type","paragraph").put("text",source)
            val boxes=page.getJSONObject("sidecar").optJSONArray("textBoxes") ?: JSONArray()
            val ticks=HashMap<String,Boolean>()
            for(n in 0 until boxes.length()) {val b=boxes.getJSONObject(n);val s=b.optJSONObject("semantic");if(s?.optString("role")=="checkbox")ticks[s.getString("id")]=b.optString("text")=="☑"}
            val sorted=(0 until boxes.length()).map { boxes.getJSONObject(it) }.filter { !it.optBoolean("checkbox") }.sortedWith(compareBy({it.optDouble("y")},{it.optDouble("x")}))
            for(b in sorted) {
                val s=b.optJSONObject("semantic");val id=s?.optString("id")?.takeIf{it.isNotEmpty()} ?: "text-$pageId-${b.getString("id")}"
                val type=s?.optString("type") ?: "paragraph"
                val rawText=b.optString("text");var text=rawText
                if(type=="bullet" && s?.optBoolean("continuation")!=true)text=text.removePrefix("• ")
                if(type=="numbered" && s?.optBoolean("continuation")!=true)text=text.replaceFirst(Regex("^\\d+\\. "),"")
                val prefix=rawText.length-text.length
                val old=result[id];val separator=if(old!=null && s?.optBoolean("continuation")!=true) "\n" else ""
                val offset=(old?.getString("text")?.length?:0)+separator.length
                val block=old ?: JSONObject().put("id",id).put("type",type).put("text","").apply{if(type=="task")put("checked",allTicks[id]?:false);s?.optString("parentId")?.takeIf{it.isNotBlank()}?.let{put("parentId",it)}}.also{result[id]=it}
                block.put("text",block.getString("text")+separator+text)
                val styles=b.optJSONArray("styles")?.let{Bundle.styles(rawText,it)}?:JSONArray()
                val combined=block.optJSONArray("styles")?:JSONArray()
                for(n in 0 until styles.length()) {
                    val range=styles.getJSONObject(n);val start=maxOf(prefix,range.getInt("start"));val end=range.getInt("end")
                    if(end>start)combined.put(JSONObject(range.toString()).put("start",offset+start-prefix).put("end",offset+end-prefix))
                }
                if(combined.length()>0)block.put("styles",combined)
            }
        }
        // A scoped export or deleted parent may leave a surviving child: expose it as a root,
        // retaining its text and checkbox state rather than losing the whole selection.
        for(block in result.values)if(block.optString("parentId").isNotBlank() && block.getString("parentId") !in result.keys)block.remove("parentId")
        return Bundle.blocks(JSONArray(result.values.toList()))
    }
    /** Trusted on-page geometry derived solely from saved stroke coordinates. */
    private fun inkRegions(pages:JSONArray):JSONArray {
        val candidates=mutableListOf<JSONObject>()
        for(i in 0 until pages.length()) {
            val page=pages.getJSONObject(i);val runs=page.getJSONObject("sidecar").optJSONArray("inkRuns")?:JSONArray()
            for(n in 0 until runs.length()) {
                val run=runs.getJSONObject(n);val id=run.optString("id")
                if(!Regex("[a-zA-Z0-9_-]{1,120}").matches(id) || !run.has("layoutX") || !run.has("layoutY"))continue
                val dx=run.optDouble("layoutX");val dy=run.optDouble("layoutY");val scale=run.optDouble("scale",1.0)
                if(!dx.isFinite() || !dy.isFinite() || !scale.isFinite() || scale<=0)continue
                val strokes=run.optJSONArray("strokes")?:continue;val strokeIds=JSONArray();val used=HashSet<String>()
                var left=Double.POSITIVE_INFINITY;var top=Double.POSITIVE_INFINITY;var right=Double.NEGATIVE_INFINITY;var bottom=Double.NEGATIVE_INFINITY;var valid=true
                for(k in 0 until strokes.length()) {
                    val stroke=strokes.getJSONObject(k);val sid=stroke.optString("id")
                    if(!Regex("[a-zA-Z0-9_-]{1,120}").matches(sid) || !used.add(sid)){valid=false;break};strokeIds.put(sid)
                    val points=stroke.optJSONArray("points")?:JSONArray()
                    for(m in 0 until points.length()) {val point=points.getJSONObject(m);val x=point.optDouble("x");val y=point.optDouble("y")
                        if(!x.isFinite() || !y.isFinite()){valid=false;break};left=minOf(left,x);top=minOf(top,y);right=maxOf(right,x);bottom=maxOf(bottom,y)
                    }
                }
                if(!valid || strokeIds.length()==0 || !left.isFinite())continue
                candidates+=JSONObject().put("id","ink-"+Bundle.sha((page.getString("id")+":"+id+":"+n).toByteArray()).take(40)).put("pageId",page.getString("id")).put("runId",id).put("strokeIds",strokeIds)
                    .put("bounds",JSONObject().put("x",dx).put("y",dy).put("width",maxOf(1.0,right-left+8)).put("height",maxOf(1.0,bottom-top+8)))
            }
        }
        val counts=candidates.groupingBy{it.getString("id")}.eachCount()
        return JSONArray(candidates.filter{counts[it.getString("id")]==1})
    }
    fun inspect(notebookId: String, proposalId:String?=null): JSONObject = synchronized(lock) {
        val r=link(notebookId); val p=pages(notebookId);val notebookTitle=title(notebookId)
        proposalId?.let { UUID.fromString(it) }
        val applied=proposalId!=null && (index(notebookId).optString("agoraProposalId")==proposalId || readRecord(r.getString("documentId")).optJSONObject("appliedProposals")?.has(proposalId)==true)
        JSONObject().put("documentId",r.getString("documentId")).put("revisionId",revisionForSnapshot(notebookTitle,p)).put("title",notebookTitle)
            .put("pages",p).put("inkRegions",inkRegions(p)).put("blocks",projection(p)).put("origin",readRecord(r.getString("documentId"))).put("undoAvailable", undoAvailable(notebookId)).put("proposalApplied",applied)
    }
    /** Exact revision + viewport cache; never reuses an image after document/grid changes. */
    fun previewCache(notebookId:String, expectedRevision:String, signature:String, pageIds:Set<String>, supplied:JSONObject, frames:JSONObject=JSONObject()):JSONObject = synchronized(lock) {
        require(Regex("[0-9a-f]{64}").matches(expectedRevision))
        require(signature.matches(Regex("[0-9x.-]{1,80}")) && pageIds.size in 1..32)
        val available=index(notebookId).getJSONArray("pages").let { values -> (0 until values.length()).map{values.getJSONObject(it).getString("id")}.toSet() }
        require(available.containsAll(pageIds))
        val cache=File(revisions(link(notebookId).getString("documentId")),"preview-cache").apply{mkdirs()}
        val prefix=expectedRevision+"-"+Bundle.sha(signature.toByteArray()).take(12)
        for(id in supplied.keys().asSequence()) {
            require(id in pageIds);val encoded=supplied.getString(id)
            require(encoded.startsWith("data:image/jpeg;base64,"))
            val bytes=android.util.Base64.decode(encoded.substringAfter(','),android.util.Base64.DEFAULT)
            require(bytes.size<=1_500_000)
            atomic(File(cache,"$prefix-${safeId(id)}.jpg"),bytes)
            frames.optJSONObject(id)?.let { frame -> Bundle.imageFrame(frame);atomic(File(cache,"$prefix-${safeId(id)}.json"),frame.toString().toByteArray()) }
        }
        // Render callers already own supplied image bytes and ignore this write response.
        if(supplied.length()>0) {
            cache.listFiles()?.sortedByDescending{it.lastModified()}?.drop(64)?.forEach{it.delete()}
            return@synchronized JSONObject().put("saved",supplied.length())
        }
        val result=JSONObject();val resultFrames=JSONObject()
        for(id in pageIds){val file=File(cache,"$prefix-${safeId(id)}.jpg");if(file.exists())result.put(id,"data:image/jpeg;base64,"+android.util.Base64.encodeToString(file.readBytes(),android.util.Base64.NO_WRAP))}
        // Bound this disposable rendering cache; immutable documents/recovery files stay outside it.
        cache.listFiles()?.sortedByDescending{it.lastModified()}?.drop(64)?.forEach{it.delete()}
        for(id in pageIds) {
            val file=File(cache,"$prefix-${safeId(id)}.json")
            if(file.isFile)runCatching { resultFrames.put(id,Bundle.imageFrame(JSONObject(file.readText()))) }
        }
        JSONObject().put("previews",result).put("frames",resultFrames)
    }
    /** Display-only cover from the existing shelf cache; never captures ink or opts into AI images. */
    private fun displayThumbnail(notebookId:String):ByteArray? {
        val path=storage.getThumbnailPath(notebookId);if(path.isBlank())return null
        val file=File(path);if(file.length() !in 1..2_000_000)return null
        return try {
            val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true}
            android.graphics.BitmapFactory.decodeFile(path,bounds)
            if(bounds.outWidth !in 1..8192 || bounds.outHeight !in 1..8192)return null
            var sample=1;while(maxOf(bounds.outWidth,bounds.outHeight)/sample>512)sample*=2
            val decoded=android.graphics.BitmapFactory.decodeFile(path,android.graphics.BitmapFactory.Options().apply{inSampleSize=sample})?:return null
            try {
                val paper=android.graphics.Bitmap.createBitmap(decoded.width,decoded.height,android.graphics.Bitmap.Config.ARGB_8888)
                try {
                    val canvas=android.graphics.Canvas(paper);canvas.drawColor(android.graphics.Color.WHITE);canvas.drawBitmap(decoded,0f,0f,null)
                    val bytes=java.io.ByteArrayOutputStream()
                    if(!paper.compress(android.graphics.Bitmap.CompressFormat.JPEG,80,bytes))return null
                    bytes.toByteArray().takeIf{it.size<=300_000}
                } finally {paper.recycle()}
            } finally {decoded.recycle()}
        } catch(_:Exception){null}
    }
    fun export(notebookId: String, selected: Set<String>, previews: JSONObject = JSONObject(), transcripts: JSONArray = JSONArray(), instruction:String="Organize", displayPreview:String?=null, expectedRevisionId:String?=null,previewFrames:JSONObject=JSONObject()): Pair<File,JSONObject> = synchronized(lock) {
        val all=inspect(notebookId)
        require(expectedRevisionId==null || expectedRevisionId==all.getString("revisionId")) { "Note changed while preparing images. Try attaching again." }
        val pages=all.getJSONArray("pages")
        require(selected.isNotEmpty() && selected.size<=32)
        val chosen=JSONArray();val manifestPages=JSONArray();val files=linkedMapOf<String,ByteArray>()
        for(i in 0 until pages.length()) {val p=pages.getJSONObject(i);val id=p.getString("id");if(id !in selected)continue
            chosen.put(p);val source="pages/$id.md";val sidecar="pages/$id.json"
            files[source]=p.getString("source").toByteArray();files[sidecar]=p.getJSONObject("sidecar").toString().toByteArray()
            val meta=JSONObject().put("id",id).put("sourceFile",source).put("sidecarFile",sidecar)
            if(previews.has(id))previewFrames.optJSONObject(id)?.let { meta.put("imageFrame",Bundle.imageFrame(it)) }
            if(previews.has(id)) {val encoded=previews.getString(id);require(encoded.startsWith("data:image/jpeg;base64,"));val image=android.util.Base64.decode(encoded.substringAfter(','),android.util.Base64.DEFAULT);require(image.size<=1500000);val path="pages/$id.jpg";files[path]=image;meta.put("previewFile",path)}
            manifestPages.put(meta)
        }
        require(chosen.length()==selected.size) { "Selected page is unavailable" }
        val blocks=projection(chosen,pages)
        for(i in 0 until transcripts.length()){val b=transcripts.getJSONObject(i);require(b.getString("id").startsWith("transcript-"));blocks.put(b)}
        Bundle.blocks(blocks)
        val manifest=JSONObject().put("schema",Bundle.SCHEMA).put("documentId",all.getString("documentId"))
            .put("revisionId",all.getString("revisionId")).put("title",all.getString("title")).put("blocks",blocks).put("pages",manifestPages)
            .put("origin",all.getJSONObject("origin")).put("instruction",instruction.take(200)).put("inkRegions",inkRegions(chosen))
        (displayPreview?.let { encoded ->
            require(encoded.startsWith("data:image/jpeg;base64,"));android.util.Base64.decode(encoded.substringAfter(','),android.util.Base64.DEFAULT).also{require(it.size<=1_500_000)}
        } ?: displayThumbnail(notebookId))?.let { cover ->
            val path=if(files.containsKey("pages/cover.jpg")) "pages/notebook-cover.jpg" else "pages/cover.jpg"
            if(!files.containsKey(path)){files[path]=cover;manifest.put("thumbnailFile",path)}
        }
        require(files.values.sumOf{it.size.toLong()}<=Bundle.MAX_BYTES)
        val directory=File(File(context.cacheDir,"agora-exchange"),UUID.randomUUID().toString()).apply{mkdirs()}
        // Same-named snapshots stay immutable in separate private request directories.
        val output=File(directory,NotesFilename.zip(all.getString("title")))
        output.outputStream().use{Bundle.write(manifest,files,it)}
        val revisions=File(root,all.getString("documentId")).apply{mkdirs()}
        val saved=File(revisions,"${all.getString("revisionId")}.zip")
        if(!saved.exists())atomic(saved,output.readBytes())
        val full=File(revisions,"${all.getString("revisionId")}.json")
        if(!full.exists())atomic(full,all.toString().toByteArray())
        val r=readRecord(all.getString("documentId"));if(!r.has("originalRevision")){r.put("originalRevision",all.getString("revisionId"));atomic(record(r.getString("documentId")),r.toString().toByteArray())}
        val scopeFile=File(revisions,"${all.getString("revisionId")}.scopes.json")
        val scopes=if(scopeFile.exists())JSONArray(scopeFile.readText()) else JSONArray()
        val scope=selected.sorted()
        if((0 until scopes.length()).none { n -> (0 until scopes.getJSONArray(n).length()).map { scopes.getJSONArray(n).getString(it) }.sorted()==scope }) {
            scopes.put(JSONArray(scope));atomic(scopeFile,scopes.toString().toByteArray())
        }
        val regionsFile=File(revisions,"${all.getString("revisionId")}.ink-regions.json")
        val authorized=if(regionsFile.exists())JSONObject(regionsFile.readText()) else JSONObject()
        val regions=manifest.getJSONArray("inkRegions")
        for(i in 0 until regions.length()){val region=regions.getJSONObject(i);authorized.put(region.getString("id"),region)}
        atomic(regionsFile,authorized.toString().toByteArray())
        output to manifest
    }
    fun restoreBundle(manifest:JSONObject,files:Map<String,ByteArray>):String = synchronized(lock) {
        Bundle.validate(manifest,files)
        val id=newNotebook("Recovered — ${manifest.getString("title")}")
        val pages=manifest.getJSONArray("pages");val next=JSONArray()
        for(i in 0 until pages.length()){
            val page=pages.getJSONObject(i);val pageId="recovered-$i";val source="planning.page-$pageId.md";val ink="planning.page-$pageId.json"
            require(storage.saveNotebookFile(id,source,String(files.getValue(page.getString("sourceFile")),Charsets.UTF_8)))
            val sidecar=JSONObject(String(files.getValue(page.getString("sidecarFile")),Charsets.UTF_8));require(sidecar.optString("magic")=="write2.sidecar"&&sidecar.optInt("schemaVersion")==1)
            require(storage.saveNotebookFile(id,ink,sidecar.toString()));next.put(JSONObject().put("id",pageId).put("sourceFile",source).put("sidecarFile",ink))
        }
        require(storage.saveNotebookFile(id,"planning.pages.json",JSONObject().put("version",1).put("active",0).put("pages",next).toString()))
        val identity=link(id);val oldRecord=record(identity.getString("documentId"));identity.put("recoveredFrom",manifest.getString("documentId"));atomic(oldRecord,identity.toString().toByteArray())
        id
    }
    fun newNotebook(title: String): String = synchronized(lock) {
        val title=NotesFilename.unique(title,storage.loadLibrary().notebooks.map { it.title })
        val id="agora-${UUID.randomUUID()}";val now=Instant.now().toString();val p=Page("first",Template.DEFAULT,emptyList())
        require(storage.saveNotebook(Notebook(id,title.take(200),"",now,now,Template.DEFAULT,listOf(p),"planning")))
        val library=storage.loadLibrary();require(storage.saveLibrary(library.copy(notebooks=library.notebooks+NotebookInfo(id,title.take(200),"",now,now,Template.DEFAULT))))
        link(id);id
    }
    private fun revisionFor(notebookId:String, pageValues:JSONArray):String = Bundle.sha(canonical(JSONObject().put("title",title(notebookId)).put("pages",pageValues)).toByteArray())
    private fun revisions(documentId:String)=File(root,documentId).apply{mkdirs()}
    private fun undoFile(documentId:String, proposalId:String)=File(revisions(documentId),"undo-${UUID.fromString(proposalId)}.json")
    private fun undoAvailable(notebookId:String):Boolean {
        val ix=index(notebookId)
        return ix.has("agoraUndoProposalId") && ix.optString("agoraCommittedRevision")==revision(notebookId)
    }
    private fun receipt(documentId:String, proposalId:String, committedRevision:String) {
        val r=readRecord(documentId);val receipts=r.optJSONObject("appliedProposals")?:JSONObject()
        receipts.put(proposalId,committedRevision);r.put("appliedProposals",receipts)
        atomic(record(documentId),r.toString().toByteArray())
    }
    private fun authorizedScope(documentId:String, baseRevision:String, proposal:JSONObject, pageIds:Set<String>):Set<String> {
        val scopeFile=File(revisions(documentId),"$baseRevision.scopes.json")
        val scopes=if(scopeFile.exists())JSONArray(scopeFile.readText()) else JSONArray()
        val legacy=File(revisions(documentId),"$baseRevision.zip")
        if(scopes.length()==0 && legacy.exists()) {
            val manifest=legacy.inputStream().use { Bundle.read(it).first }
            val pages=manifest.getJSONArray("pages")
            scopes.put(JSONArray((0 until pages.length()).map{pages.getJSONObject(it).getString("id")}))
        }
        val explicit=proposal.optJSONArray("targetPageIds")?.let { arr -> (0 until arr.length()).map{arr.getString(it)}.toSet() }
        val recorded=(0 until scopes.length()).map { n -> scopes.getJSONArray(n).let { arr -> (0 until arr.length()).map{arr.getString(it)}.toSet() } }
        val selected=explicit ?: when(recorded.size){0 -> pageIds;1 -> recorded.single();else -> error("Multiple exports exist. Regenerate with an explicit page scope.")}
        require(pageIds.containsAll(selected) && selected.isNotEmpty()) { "Selected page is unavailable" }
        // Legacy local proposals without a previous export can only target the whole notebook.
        require(if(recorded.isEmpty()) selected==pageIds else selected in recorded) { "Proposal page scope was not exported" }
        return selected
    }
    private fun interactiveChanges(notebookId:String, proposal:JSONObject, currentRevision:String, currentPages:JSONArray):List<NotesInteractiveMerge.Change> {
        if(proposal.optString("documentId").isBlank() || proposal.getString("baseRevisionId")==currentRevision)return emptyList()
        val documentId=link(notebookId).getString("documentId")
        require(proposal.getString("documentId")==documentId) { "Wrong document" }
        val base=File(revisions(documentId),"${proposal.getString("baseRevisionId")}.json")
        require(base.exists()) { "Original revision unavailable; attach the current note again" }
        val before=JSONObject(base.readText())
        return NotesInteractiveMerge.changes(
            JSONObject().put("title",before.getString("title")).put("pages",before.getJSONArray("pages")),
            JSONObject().put("title",title(notebookId)).put("pages",currentPages))
    }
    /** Preparation and commit use the same native conflict rules; commit rechecks under lock. */
    fun prepare(notebookId:String, proposal:JSONObject):JSONObject = synchronized(lock) {
        Bundle.proposal(proposal)
        val current=inspect(notebookId,proposal.getString("proposalId"))
        if(proposal.optString("documentId").isNotBlank())require(proposal.getString("documentId")==current.getString("documentId")) { "Wrong document" }
        if(current.getBoolean("proposalApplied"))return@synchronized current
        if(proposal.optString("operation")=="replace_page")require(proposal.getString("baseRevisionId")==current.getString("revisionId")) { "The page changed while formatting. Your current note is retained." }
        val changes=interactiveChanges(notebookId,proposal,current.getString("revisionId"),current.getJSONArray("pages"))
        val ids=current.getJSONArray("pages").let { p -> (0 until p.length()).map { p.getJSONObject(it).getString("id") }.toSet() }
        val selected=if(proposal.optString("documentId").isBlank())ids else authorizedScope(current.getString("documentId"),proposal.getString("baseRevisionId"),proposal,ids)
        current.put("effectiveProposal",NotesInteractiveMerge.proposal(proposal,changes,selected))
    }
    private fun validateMaterializedStyles(proposal:JSONObject,sheets:JSONArray,oldPages:JSONArray?=null) {
        val expected=proposal.getJSONArray("blocks")
        val staged=JSONArray()
        for(i in 0 until sheets.length()) {
            val sheet=sheets.getJSONObject(i);val sidecar=JSONObject(sheet.getJSONObject("sidecar").toString())
            if(oldPages!=null) {
                val pageId=sheet.getString("pageId")
                val old=(0 until oldPages.length()).map{oldPages.getJSONObject(it)}.first{it.getString("id")==pageId}
                val existing=old.getJSONObject("sidecar").optJSONArray("textBoxes")?.length()?:0
                val boxes=sidecar.optJSONArray("textBoxes")?:JSONArray();val newBoxes=JSONArray()
                for(n in existing until boxes.length())newBoxes.put(boxes.get(n))
                sidecar.put("textBoxes",newBoxes)
            }
            staged.put(JSONObject().put("id",sheet.optString("pageId","staged-$i")).put("source","\u200b").put("sidecar",sidecar))
        }
        val projected=projection(staged)
        val byId=(0 until projected.length()).associate{projected.getJSONObject(it).getString("id") to projected.getJSONObject(it)}
        for(i in 0 until expected.length()) {
            val block=expected.getJSONObject(i)
            val materialized=byId[block.getString("id")]
            // Legacy sheets without semantic bindings remain compatible only when no styles were requested.
            if(materialized==null){require(!block.has("styles") || block.getJSONArray("styles").length()==0) { "Styled text was not materialized" };continue}
            val expectedStyles=Bundle.styles(block.getString("text"),block.optJSONArray("styles")?:JSONArray())
            val actualStyles=Bundle.styles(materialized.getString("text"),materialized.optJSONArray("styles")?:JSONArray())
            require(canonical(expectedStyles)==canonical(actualStyles)) { "Materialized inline styles differ from returned text" }
            if(oldPages!=null || expectedStyles.length()>0)require(materialized.getString("text")==block.getString("text")) { "Styled text differs from returned text" }
        }
    }
    fun apply(notebookId: String, suppliedProposal: JSONObject, suppliedSheets: JSONArray): JSONObject = synchronized(lock) {
        Bundle.proposal(suppliedProposal)
        var proposal=suppliedProposal
        var sheets=suppliedSheets
        val r=link(notebookId);val documentId=r.getString("documentId");val proposalId=proposal.getString("proposalId")
        val oldIndex=index(notebookId);val recorded=readRecord(documentId)
        if(proposal.optString("documentId").isNotBlank())require(proposal.getString("documentId")==documentId) { "Wrong document" }
        if(oldIndex.optString("agoraProposalId")==proposalId) {
            receipt(documentId,proposalId,oldIndex.optString("agoraCommittedRevision",revision(notebookId)))
            return@synchronized inspect(notebookId).put("notebookId",notebookId)
        }
        if(recorded.optJSONObject("appliedProposals")?.has(proposalId)==true)return@synchronized inspect(notebookId).put("notebookId",notebookId)
        require(sheets.length() in 1..32)
        val baseRevision=revision(notebookId)
        if(proposal.optString("documentId").isNotBlank()) {
            require(proposal.getString("documentId")==documentId) { "Wrong document" }
        }
        val oldPages=pages(notebookId)
        val pageIds=(0 until oldPages.length()).map{oldPages.getJSONObject(it).getString("id")}.toSet()
        val exportedRevision=if(proposal.optString("documentId").isBlank())baseRevision else proposal.getString("baseRevisionId")
        val selected=if(proposal.optString("documentId").isBlank())pageIds else authorizedScope(documentId,exportedRevision,proposal,pageIds)
        if(proposal.optString("operation")=="replace_page")require(proposal.getString("baseRevisionId")==baseRevision) { "The page changed while formatting. Your current note is retained." }
        val changes=interactiveChanges(notebookId,proposal,baseRevision,oldPages)
        proposal=NotesInteractiveMerge.proposal(proposal,changes,selected)
        sheets=NotesInteractiveMerge.sheets(sheets,changes)
        val directory=revisions(documentId)
        val original=File(directory,"$baseRevision.json")
        if(!original.exists())atomic(original,inspect(notebookId).toString().toByteArray())
        val beforeRecord=readRecord(documentId)
        if(!beforeRecord.has("originalRevision")){beforeRecord.put("originalRevision",baseRevision);atomic(record(documentId),beforeRecord.toString().toByteArray())}
        if(proposal.optString("operation","organize")=="replace_ink")return@synchronized applyTranscription(notebookId,proposal,sheets,selected,oldIndex,oldPages,beforeRecord,exportedRevision)
        validateMaterializedStyles(proposal,sheets)
        val replacePage=proposal.optString("operation")=="replace_page"
        if(replacePage) {
            require(selected.size==1 && sheets.length()==1) { "Image formatting must replace exactly one page" }
            val originalPage=(0 until oldPages.length()).map{oldPages.getJSONObject(it)}.first{it.getString("id") in selected}
            val originalSidecar=originalPage.getJSONObject("sidecar")
            val sheet=sheets.getJSONObject(0);val returned=sheet.getJSONObject("sidecar")
            require(sheet.getString("source").replace("\u200b", "").isBlank()) { "Image formatting must use editable blocks" }
            require((returned.optJSONArray("inkRuns")?.length()?:0)==0 && (returned.optJSONArray("unplacedInk")?.length()?:0)==0) { "Image formatting cannot add ink" }
            require(canonical(returned.optJSONArray("pageObjects")?:JSONArray())==canonical(originalSidecar.optJSONArray("pageObjects")?:JSONArray())) { "Image formatting cannot change drawings or objects" }
            val projected=projection(JSONArray().put(JSONObject().put("id","formatted").put("source",sheet.getString("source")).put("sidecar",returned)))
            require(canonical(projected)==canonical(proposal.getJSONArray("blocks"))) { "Formatted page differs from its Markdown elements" }
            val h=returned.getDouble("layoutLineHeight")
            require(h.isFinite() && h>=24 && (!originalSidecar.has("layoutLineHeight") || originalSidecar.getDouble("layoutLineHeight")==h)) { "Image formatting changed the ruled grid" }
            val boxes=returned.getJSONArray("textBoxes")
            for(i in 0 until boxes.length()) {
                val box=boxes.getJSONObject(i)
                for(key in listOf("x","y","width","size"))require(box.getDouble(key).isFinite()) { "Invalid formatted geometry" }
                require(box.getDouble("y")>=0 && kotlin.math.abs(box.getDouble("y")/h-kotlin.math.round(box.getDouble("y")/h))<0.001) { "Formatted content is outside the ruled grid" }
            }
        }
        val replacement=JSONArray();val replacementValues=JSONArray();val generation=proposalId.replace("-","")
        fun stage(id:String, sourceValue:String, sidecar:JSONObject) {
            require(sidecar.getString("magic")=="write2.sidecar" && sidecar.getInt("schemaVersion")==1)
            val source="planning.page-$id.md";val ink="planning.page-$id.json"
            require(storage.saveNotebookFile(notebookId,source,sourceValue) && storage.saveNotebookFile(notebookId,ink,sidecar.toString())) { "Could not stage revision" }
            replacement.put(JSONObject().put("id",id).put("sourceFile",source).put("sidecarFile",ink))
            replacementValues.put(JSONObject().put("id",id).put("source",sourceValue).put("sidecar",sidecar))
        }
        for(i in 0 until sheets.length()){val sheet=sheets.getJSONObject(i);stage("ai-$generation-$i",sheet.getString("source"),sheet.getJSONObject("sidecar"))}
        // Only selected pages lose bound semantic text. Ink/shapes/independent annotations remain visible.
        for(i in 0 until oldPages.length()) {
            val p=oldPages.getJSONObject(i);if(p.getString("id") !in selected || replacePage)continue
            val sc=JSONObject(p.getJSONObject("sidecar").toString());val boxes=sc.optJSONArray("textBoxes")?:JSONArray();val keep=JSONArray()
            for(n in 0 until boxes.length())if(!boxes.getJSONObject(n).has("semantic"))keep.put(boxes.get(n))
            sc.put("textBoxes",keep)
            val hasInk=(sc.optJSONArray("inkRuns")?.length()?:0)>0 || (sc.optJSONArray("unplacedInk")?.length()?:0)>0 || (sc.optJSONArray("pageObjects")?.length()?:0)>0 || keep.length()>0
            if(hasInk)stage("kept-$generation-$i",p.getString("source"),sc)
        }
        val nextPages=JSONArray();val nextValues=JSONArray();var inserted=false;var firstReplacement=0
        val oldEntries=oldIndex.getJSONArray("pages")
        for(i in 0 until oldPages.length()) {
            if(oldPages.getJSONObject(i).getString("id") in selected) {
                if(!inserted){firstReplacement=nextPages.length();for(n in 0 until replacement.length()){nextPages.put(replacement.get(n));nextValues.put(replacementValues.get(n))};inserted=true}
            } else {nextPages.put(oldEntries.get(i));nextValues.put(oldPages.get(i))}
        }
        require(nextPages.length()<=1000) { "Notebook exceeds 1000 pages" }
        val committed=revisionFor(notebookId,nextValues)
        val previousActiveId=oldEntries.optJSONObject(oldIndex.optInt("active",0))?.optString("id")
        val active=if(replacePage && previousActiveId !in selected)(0 until nextPages.length()).firstOrNull{nextPages.getJSONObject(it).getString("id")==previousActiveId}?:firstReplacement else firstReplacement
        val next=JSONObject(oldIndex.toString()).put("active",active).put("agoraProposalId",proposalId)
            .put("agoraUndoProposalId",proposalId).put("agoraCommittedRevision",committed).put("pages",nextPages)
        // Recovery metadata is durable before the sole publication point (the atomic page index).
        atomic(undoFile(documentId,proposalId),JSONObject().put("index",oldIndex).put("record",beforeRecord).put("committedRevision",committed).toString().toByteArray())
        require(savePageIndex(notebookId,next.toString())) { "Could not publish revision" }
        receipt(documentId,proposalId,committed)
        inspect(notebookId).put("notebookId",notebookId)
    }
    private fun applyTranscription(notebookId:String, proposal:JSONObject, sheets:JSONArray, selected:Set<String>, oldIndex:JSONObject, oldPages:JSONArray, beforeRecord:JSONObject, baseRevision:String):JSONObject {
        val documentId=proposal.getString("documentId");val proposalId=proposal.getString("proposalId")
        val regionFile=File(revisions(documentId),"$baseRevision.ink-regions.json")
        require(regionFile.exists()) { "Ink region provenance is unavailable. Attach the current note again." }
        val authorized=JSONObject(regionFile.readText());val current=inkRegions(oldPages)
        val byId=(0 until current.length()).associate { current.getJSONObject(it).getString("id") to current.getJSONObject(it) }
        val blocks=proposal.getJSONArray("blocks");val byBlock=(0 until blocks.length()).associate { blocks.getJSONObject(it).getString("id") to blocks.getJSONObject(it) }
        val consumed=HashMap<String,String>();val runsByPage=HashMap<String,MutableSet<String>>()
        for(i in 0 until blocks.length()) {
            val refs=blocks.getJSONObject(i).getJSONArray("sourceInkRegionIds")
            val group=canonical(refs)
            for(n in 0 until refs.length()) {
                val id=refs.getString(n);val region=requireNotNull(byId[id]) { "Unknown ink region" }
                require(authorized.has(id) && canonical(authorized.getJSONObject(id))==canonical(JSONObject(region.toString())) && region.getString("pageId") in selected) { "Ink region was not exported in this page scope" }
                val previousGroup=consumed.putIfAbsent(id,group)
                require(previousGroup==null || previousGroup==group) { "Overlapping ink replacement groups" }
                runsByPage.getOrPut(region.getString("pageId")){HashSet()}.add(region.getString("runId"))
            }
        }
        val provided=HashMap<String,JSONObject>()
        for(i in 0 until sheets.length()){val sheet=sheets.getJSONObject(i);val id=sheet.getString("pageId");require(provided.put(id,sheet)==null) { "Duplicate transcription page" }}
        require(provided.keys==runsByPage.keys) { "Transcription must update exactly its referenced pages" }
        val nextPages=JSONArray();val nextValues=JSONArray();val represented=HashSet<String>();val checkboxes=HashSet<String>();val generation=proposalId.replace("-","")
        val oldEntries=oldIndex.getJSONArray("pages")
        for(i in 0 until oldPages.length()) {
            val old=oldPages.getJSONObject(i);val pageId=old.getString("id");val sheet=provided[pageId]
            if(sheet==null){nextPages.put(oldEntries.get(i));nextValues.put(old);continue}
            require(sheet.getString("source")==old.getString("source")) { "Transcription cannot replace existing source text" }
            val previous=old.getJSONObject("sidecar");val returned=sheet.getJSONObject("sidecar")
            val expected=JSONObject(previous.toString());val kept=JSONArray();val oldRuns=previous.optJSONArray("inkRuns")?:JSONArray()
            for(n in 0 until oldRuns.length()){val run=oldRuns.getJSONObject(n);if(run.getString("id") !in runsByPage.getValue(pageId))kept.put(run)}
            expected.put("inkRuns",kept)
            val oldBoxes=previous.optJSONArray("textBoxes")?:JSONArray();val newBoxes=returned.optJSONArray("textBoxes")?:JSONArray()
            require(newBoxes.length()>oldBoxes.length()) { "Transcription contains no editable text" }
            for(n in 0 until oldBoxes.length())require(canonical(oldBoxes.get(n))==canonical(newBoxes.get(n))) { "Existing text annotation changed" }
            val identities=(0 until oldBoxes.length()).map { oldBoxes.getJSONObject(it).getString("id") }.toMutableSet()
            for(n in oldBoxes.length() until newBoxes.length()) {
                val box=newBoxes.getJSONObject(n);require(identities.add(safeId(box.getString("id")))) { "Duplicate text identity" }
                val semantic=box.getJSONObject("semantic");val block=requireNotNull(byBlock[semantic.getString("id")]) { "Unknown transcription text" }
                require(semantic.optString("parentId")==block.optString("parentId")) { "Transcription element group changed" }
                require(semantic.getString("type")==block.getString("type")) { "Transcription element type changed" }
                val refs=semantic.getJSONArray("sourceInkRegionIds")
                require(canonical(refs)==canonical(block.getJSONArray("sourceInkRegionIds"))) { "Text provenance changed" }
                require((0 until refs.length()).any{byId.getValue(refs.getString(it)).getString("pageId")==pageId}) { "Text is outside referenced ink page" }
                val text=box.getString("text");require(text.isNotBlank()) { "Transcription contains empty text" }
                if(box.has("fontWeight"))require(box.getInt("fontWeight")==700 && block.getString("type")=="heading" && semantic.optString("role")=="text") { "Unsupported transcription typography" }
                if(semantic.optString("role")=="checkbox") {
                    checkboxes.add(block.getString("id"))
                    require(block.getString("type")=="task" && box.optBoolean("checkbox") && text==(if(block.getBoolean("checked")) "☑" else "☐")) { "Invalid task checkbox" }
                } else { require(semantic.optString("role")=="text") { "Invalid transcription role" };represented.add(block.getString("id")) }
                for(field in listOf("x","y","width","size"))require(box.getDouble(field).isFinite()) { "Invalid transcription geometry" }
            }
            expected.put("textBoxes",newBoxes)
            require(canonical(expected)==canonical(returned)) { "Transcription changed unrelated note data" }
            val source="planning.transcribed-$generation-$i.md";val ink="planning.transcribed-$generation-$i.json"
            require(storage.saveNotebookFile(notebookId,source,sheet.getString("source")) && storage.saveNotebookFile(notebookId,ink,returned.toString())) { "Could not stage transcription" }
            val entry=JSONObject(oldEntries.getJSONObject(i).toString()).put("sourceFile",source).put("sidecarFile",ink)
            nextPages.put(entry);nextValues.put(JSONObject().put("id",pageId).put("source",sheet.getString("source")).put("sidecar",returned))
        }
        validateMaterializedStyles(proposal,sheets,oldPages)
        require(represented==byBlock.keys) { "Transcription is missing replacement text" }
        require(checkboxes==byBlock.filterValues{it.getString("type")=="task"}.keys) { "Transcribed tasks need paired checkboxes" }
        val committed=revisionFor(notebookId,nextValues)
        val next=JSONObject(oldIndex.toString()).put("pages",nextPages).put("agoraProposalId",proposalId).put("agoraUndoProposalId",proposalId).put("agoraCommittedRevision",committed)
        atomic(undoFile(documentId,proposalId),JSONObject().put("index",oldIndex).put("record",beforeRecord).put("committedRevision",committed).toString().toByteArray())
        require(savePageIndex(notebookId,next.toString())) { "Could not publish transcription" }
        receipt(documentId,proposalId,committed)
        return inspect(notebookId).put("notebookId",notebookId)
    }
    fun undo(notebookId:String, expectedRevisionId:String):JSONObject = synchronized(lock) {
        val currentRevision=revision(notebookId)
        require(expectedRevisionId==currentRevision) { "Document changed. Undo would overwrite newer edits." }
        val ix=index(notebookId);require(ix.optString("agoraCommittedRevision")==currentRevision && ix.has("agoraUndoProposalId")) { "AI undo is unavailable after subsequent edits" }
        val documentId=link(notebookId).getString("documentId");val proposalId=ix.getString("agoraUndoProposalId")
        val saved=JSONObject(undoFile(documentId,proposalId).readText())
        require(saved.getString("committedRevision")==currentRevision)
        // Record the consumed proposal before restoring the index, so a retried delivery cannot reapply it.
        val restoredRecord=JSONObject(saved.getJSONObject("record").toString())
        val receipts=readRecord(documentId).optJSONObject("appliedProposals")?:JSONObject()
        receipts.put(proposalId,currentRevision)
        restoredRecord.put("appliedProposals",receipts)
        atomic(record(documentId),restoredRecord.toString().toByteArray())
        require(savePageIndex(notebookId,saved.getJSONObject("index").toString())) { "Could not restore previous revision" }
        inspect(notebookId).put("notebookId",notebookId)
    }
    fun original(notebookId:String):Pair<File,JSONObject> = synchronized(lock) {
        val r=readRecord(link(notebookId).getString("documentId"));val saved=File(File(root,r.getString("documentId")),"${r.getString("originalRevision")}.json")
        val original=JSONObject(saved.readText());val copy=newNotebook("Original — ${original.getString("title")}")
        val pages=original.getJSONArray("pages");val next=JSONArray()
        for(i in 0 until pages.length()){val p=pages.getJSONObject(i);val id="original-$i";val source="planning.page-$id.md";val ink="planning.page-$id.json";require(storage.saveNotebookFile(copy,source,p.getString("source")));require(storage.saveNotebookFile(copy,ink,p.getJSONObject("sidecar").toString()));next.put(JSONObject().put("id",id).put("sourceFile",source).put("sidecarFile",ink))}
        require(storage.saveNotebookFile(copy,"planning.pages.json",JSONObject().put("version",1).put("active",0).put("pages",next).toString()))
        saved to JSONObject().put("notebookId",copy)
    }
    private fun savePageIndex(notebookId:String,content:String):Boolean {
        val file=File(File(storage.currentRootPath(),"notebooks/${safeId(notebookId)}"),"planning.pages.json")
        val atomic=android.util.AtomicFile(file)
        var stream:java.io.FileOutputStream?=null
        return try{stream=atomic.startWrite();stream.write(content.toByteArray());atomic.finishWrite(stream);true}
        catch(_:Exception){stream?.let{atomic.failWrite(it)};false}
    }
    private fun atomic(file:File,bytes:ByteArray){val part=File(file.parentFile,file.name+".part");part.outputStream().use{it.write(bytes);it.fd.sync()};require(part.renameTo(file)){"Cannot publish document record"}}
    companion object { private val lock=Any() }
}
