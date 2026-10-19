package com.kalamos.notebook.exchange
import android.app.Application
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.junit.runner.RunWith
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.json.JSONObject
import org.json.JSONArray
import com.kalamos.notebook.storage.StorageConfig
import com.kalamos.notebook.storage.StorageManager
import java.io.File
import java.util.UUID
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class AgoraDocumentsTest {
 @Test fun revisionSnapshotRetainsExactRevisionWithoutFullInspectionPayload(){
  val id=repo.newNotebook("Snapshot")
  storage.saveNotebookFile(id,"planning.write2.md","A written paragraph")
  val full=repo.inspect(id);val snapshot=repo.revisionSnapshot(id)
  assertEquals(full.getString("documentId"),snapshot.getString("documentId"))
  assertEquals(full.getString("revisionId"),snapshot.getString("revisionId"))
  assertEquals(repo.revision(id),snapshot.getString("revisionId"))
  assertEquals(setOf("documentId","revisionId"),snapshot.keys().asSequence().toSet())
  storage.saveNotebookFile(id,"planning.write2.md","Changed paragraph")
  assertNotEquals(snapshot.getString("revisionId"),repo.revisionSnapshot(id).getString("revisionId"))
  assertEquals(repo.inspect(id).getString("revisionId"),repo.revisionSnapshot(id).getString("revisionId"))
 }
 private lateinit var repo:AgoraDocuments
 private lateinit var storage:StorageManager
 @Before fun setup(){val context=RuntimeEnvironment.getApplication();val root=File(context.filesDir,"test-${UUID.randomUUID()}").apply{mkdirs()};StorageConfig.setRoot(context,root.absolutePath);repo=AgoraDocuments(context);storage=StorageManager(context)}
 private fun sheet(text:String)=JSONObject().put("source","\u200b").put("sidecar",JSONObject("""{"magic":"write2.sidecar","schemaVersion":1,"inkRuns":[],"unplacedInk":[],"blockAnchors":[],"sourceWords":[{"text":"\u200b","x":0,"y":0}],"layoutLineHeight":56}""").put("textBoxes",JSONArray().put(JSONObject().put("id","text-task").put("text",text).put("x",16).put("y",0).put("width",300).put("size",26).put("blockId","planning-document").put("semantic",JSONObject().put("id","task").put("type","task").put("role","text"))).put(JSONObject().put("id","tick-task").put("text","☐").put("checkbox",true).put("x",400).put("y",0).put("width",36).put("size",26).put("blockId","planning-document").put("semantic",JSONObject().put("id","task").put("type","task").put("role","checkbox")))))
 private fun proposal(id:String)=repo.inspect(id).let{JSONObject().put("schema","kalamos.notes-proposal/v1").put("proposalId",UUID.randomUUID().toString()).put("documentId",it.getString("documentId")).put("baseRevisionId",it.getString("revisionId")).put("title","List").put("blocks",JSONArray().put(JSONObject().put("id","task").put("type","task").put("text","Buy milk").put("checked",false)))}
 @Test fun exportFilenameTracksRenameAndPriorSnapshotsRemainImmutable(){
  val id=repo.newNotebook("To do");val first=repo.export(id,setOf("first")).first
  assertEquals("To do.notes.zip",first.name);val before=first.readBytes()
  val library=storage.loadLibrary()
  assertTrue(storage.saveLibrary(library.copy(notebooks=library.notebooks.map{if(it.notebookId==id)it.copy(title="Shopping") else it})))
  val renamed=repo.export(id,setOf("first")).first
  assertEquals("Shopping.notes.zip",renamed.name);assertArrayEquals(before,first.readBytes())
  assertNotEquals(first.parentFile,renamed.parentFile)
  val duplicate=repo.newNotebook("shopping")
  assertEquals("shopping (2)",storage.loadLibrary().notebooks.single{it.notebookId==duplicate}.title)
 }
 @Test fun staleResultKeepsNewTickAndUndoRestoresCurrentPreAiState(){
  val id=repo.newNotebook("List")
  storage.saveNotebookFile(id,"planning.write2.json",sheet("Buy milk").getJSONObject("sidecar").toString())
  repo.export(id,setOf("first"));val p=proposal(id).put("targetPageIds",JSONArray().put("first"))
  p.getJSONArray("blocks").getJSONObject(0).put("text","Buy milk and eggs")
  val current=sheet("Buy milk").getJSONObject("sidecar")
  current.getJSONArray("textBoxes").getJSONObject(1).put("text","☑")
  storage.saveNotebookFile(id,"planning.write2.json",current.toString())
  val before=repo.pages(id).toString()
  assertTrue(repo.prepare(id,p).getJSONObject("effectiveProposal").getJSONArray("blocks").getJSONObject(0).getBoolean("checked"))
  val saved=repo.apply(id,p,JSONArray().put(sheet("Buy milk and eggs")))
  val reopened=AgoraDocuments(RuntimeEnvironment.getApplication()).inspect(id).getJSONArray("blocks").getJSONObject(0)
  assertEquals("Buy milk and eggs",reopened.getString("text"));assertTrue(reopened.getBoolean("checked"))
  repo.apply(id,p,JSONArray());assertEquals(saved.getString("revisionId"),repo.revision(id))
  repo.undo(id,repo.revision(id));assertEquals(before,repo.pages(id).toString())
 }
 @Test fun commitRechecksContentChangesAfterSuccessfulPreparation(){
  val id=repo.newNotebook("List");repo.export(id,setOf("first"));val p=proposal(id).put("targetPageIds",JSONArray().put("first"))
  repo.prepare(id,p)
  storage.saveNotebookFile(id,"planning.write2.md","New words")
  val before=repo.pages(id).toString()
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,JSONArray().put(sheet("Old AI text")))}
  assertEquals(before,repo.pages(id).toString())
 }
 @Test fun reopeningAnAppliedResultWithNoSheetsRetainsLaterLocalEdits(){
  val id=repo.newNotebook("List");val p=proposal(id)
  repo.apply(id,p,JSONArray().put(sheet("Milk")))
  val ix=JSONObject(storage.getNotebookFile(id,"planning.pages.json")!!)
  val file=ix.getJSONArray("pages").getJSONObject(0).getString("sourceFile")
  assertTrue(storage.saveNotebookFile(id,file,"Later handwritten note context"))
  val before=repo.pages(id).toString()
  assertTrue(repo.inspect(id,p.getString("proposalId")).getBoolean("proposalApplied"))
  repo.apply(id,p,JSONArray())
  assertEquals(before,repo.pages(id).toString())
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,JSONObject(p.toString()).put("documentId",UUID.randomUUID().toString()),JSONArray())}
 }
 @Test fun exportedImageFrameAndCacheRetainExactLogicalToRasterMapping(){
  val id=repo.newNotebook("Geometry");val rev=repo.revision(id)
  val bitmap=android.graphics.Bitmap.createBitmap(640,960,android.graphics.Bitmap.Config.ARGB_8888)
  val bytes=java.io.ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,90,bytes);bitmap.recycle()
  val image="data:image/jpeg;base64,"+android.util.Base64.encodeToString(bytes.toByteArray(),android.util.Base64.NO_WRAP)
  val frame=JSONObject("""{"x":0,"y":0,"width":320,"height":480,"pixelWidth":640,"pixelHeight":960}""")
  val acknowledgement=repo.previewCache(id,rev,"536x724x2",setOf("first"),JSONObject().put("first",image),JSONObject().put("first",frame))
  assertEquals(1,acknowledgement.getInt("saved"));assertFalse(acknowledgement.has("previews"));assertFalse(acknowledgement.has("frames"))
  val cached=repo.previewCache(id,rev,"536x724x2",setOf("first"),JSONObject())
  assertEquals(image,cached.getJSONObject("previews").getString("first"))
  assertEquals(frame.toString(),cached.getJSONObject("frames").getJSONObject("first").toString())
  val manifest=repo.export(id,setOf("first"),JSONObject().put("first",image),previewFrames=JSONObject().put("first",frame)).second
  assertEquals(frame.toString(),manifest.getJSONArray("pages").getJSONObject(0).getJSONObject("imageFrame").toString())
  assertFalse(repo.previewCache(id,rev,"360x724x2",setOf("first"),JSONObject()).getJSONObject("frames").has("first"))
 }
 @Test fun duplicateApplyDoesNotCreateAnotherRevision(){val id=repo.newNotebook("List");val p=proposal(id);repo.apply(id,p,JSONArray().put(sheet("Buy milk")));val revision=repo.revision(id);repo.apply(id,p,JSONArray().put(sheet("Buy milk")));assertEquals(revision,repo.revision(id));assertEquals(1,repo.pages(id).length())}
 @Test fun staleProposalDoesNotOverwriteCurrentSource(){val id=repo.newNotebook("List");val p=proposal(id);storage.saveNotebookFile(id,"planning.write2.md","new handwritten idea");assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,JSONArray().put(sheet("Buy milk")))};assertEquals("new handwritten idea",storage.getNotebookFile(id,"planning.write2.md"))}
 @Test fun revisionIgnoresSaveTimestampsButTracksCheckboxState(){val id=repo.newNotebook("List");repo.apply(id,proposal(id),JSONArray().put(sheet("Buy milk")));val page=repo.index(id).getJSONArray("pages").getJSONObject(0);val file=page.getString("sidecarFile");val sc=JSONObject(storage.getNotebookFile(id,file)!!);val first=repo.revision(id);sc.put("updatedAt",12345);storage.saveNotebookFile(id,file,sc.toString());assertEquals(first,repo.revision(id));sc.getJSONArray("textBoxes").getJSONObject(1).put("text","☑");storage.saveNotebookFile(id,file,sc.toString());assertNotEquals(first,repo.revision(id));assertTrue(repo.inspect(id).getJSONArray("blocks").getJSONObject(0).getBoolean("checked"))}
 @Test fun originalSnapshotAndIndependentShapesSurviveApply(){val id=repo.newNotebook("List");val original=JSONObject("""{"magic":"write2.sidecar","schemaVersion":1,"inkRuns":[],"unplacedInk":[],"blockAnchors":[],"pageObjects":[{"id":"shape","kind":"rectangle","x":1,"y":2,"width":10,"height":10,"color":"#000000","strokeWidth":1}]}""");storage.saveNotebookFile(id,"planning.write2.json",original.toString());repo.apply(id,proposal(id),JSONArray().put(sheet("Buy milk")));assertEquals(2,repo.pages(id).length());assertEquals(original.getJSONArray("pageObjects").toString(),repo.pages(id).getJSONObject(1).getJSONObject("sidecar").getJSONArray("pageObjects").toString());val copy=repo.original(id).second.getString("notebookId");assertEquals(original.toString(),repo.pages(copy).getJSONObject(0).getJSONObject("sidecar").toString())}

 private fun addPage(id:String,pageId:String,text:String) {
  val ix=repo.index(id);val source="planning.page-$pageId.md";val sidecar="planning.page-$pageId.json"
  storage.saveNotebookFile(id,source,"\u200b");storage.saveNotebookFile(id,sidecar,sheet(text).getJSONObject("sidecar").toString())
  ix.getJSONArray("pages").put(JSONObject().put("id",pageId).put("sourceFile",source).put("sidecarFile",sidecar).put("custom","preserved"))
  storage.saveNotebookFile(id,"planning.pages.json",ix.toString())
 }
 @Test fun selectedPageCommitPreservesUnexportedSemanticContentAndIndexIdentity(){
  val id=repo.newNotebook("List");addPage(id,"second","Untouched task");addPage(id,"third","Other task")
  val untouched=repo.index(id).getJSONArray("pages").getJSONObject(1).toString();val contents=repo.pages(id).getJSONObject(1).toString()
  repo.export(id,setOf("first"));val p=proposal(id).put("targetPageIds",JSONArray().put("first"))
  repo.apply(id,p,JSONArray().put(sheet("Changed")))
  assertEquals(untouched,repo.index(id).getJSONArray("pages").getJSONObject(1).toString())
  assertEquals(contents,repo.pages(id).getJSONObject(1).toString())
  assertEquals("third",repo.pages(id).getJSONObject(2).getString("id"))
 }
 @Test fun scopeCannotExpandBeyondExportAndLegacyInfersSelectedPages(){
  val id=repo.newNotebook("List");addPage(id,"second","Keep")
  repo.export(id,setOf("first"));val p=proposal(id)
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,JSONObject(p.toString()).put("targetPageIds",JSONArray().put("first").put("second")),JSONArray().put(sheet("Bad")))}
  repo.apply(id,p,JSONArray().put(sheet("Good")));assertEquals("second",repo.pages(id).getJSONObject(1).getString("id"))
 }
 @Test fun ambiguousLegacyExportRequiresExplicitScope(){
  val id=repo.newNotebook("List");addPage(id,"second","Keep");repo.export(id,setOf("first"));repo.export(id,setOf("second"))
  assertThrows(IllegalStateException::class.java){repo.apply(id,proposal(id),JSONArray().put(sheet("Bad")))}
 }
 @Test fun undoRestoresExactPageIndexAndBlocksReplayedProposal(){
  val id=repo.newNotebook("List");addPage(id,"second","Keep");val old=repo.index(id).toString();val revision=repo.revision(id)
  repo.export(id,setOf("first"));val p=proposal(id);val result=repo.apply(id,p,JSONArray().put(sheet("Changed")))
  assertTrue(result.getBoolean("undoAvailable"));repo.undo(id,result.getString("revisionId"))
  assertEquals(old,repo.index(id).toString());assertEquals(revision,repo.revision(id))
  repo.apply(id,p,JSONArray().put(sheet("Changed")));assertEquals(revision,repo.revision(id))
 }
 @Test fun undoRefusesToLoseLaterEdits(){
  val id=repo.newNotebook("List");val result=repo.apply(id,proposal(id),JSONArray().put(sheet("Changed")))
  val entry=repo.index(id).getJSONArray("pages").getJSONObject(0);storage.saveNotebookFile(id,entry.getString("sourceFile"),"Later edit")
  assertFalse(repo.inspect(id).getBoolean("undoAvailable"))
  assertThrows(IllegalArgumentException::class.java){repo.undo(id,result.getString("revisionId"))}
 }
 @Test fun repeatedApplyRepairsMissingReceiptAfterPublishedIndex(){
  val id=repo.newNotebook("List");val p=proposal(id);val result=repo.apply(id,p,JSONArray().put(sheet("Changed")))
  val file=File(RuntimeEnvironment.getApplication().filesDir,"agora-documents/${result.getString("documentId")}.json")
  val record=JSONObject(file.readText());record.remove("appliedProposals");file.writeText(record.toString())
  repo.apply(id,p,JSONArray().put(sheet("Changed")))
  assertTrue(JSONObject(file.readText()).getJSONObject("appliedProposals").has(p.getString("proposalId")))
 }

 @Test fun exportedScopeCanBeRecoveredFromLegacySavedBundle(){
  val id=repo.newNotebook("List");addPage(id,"second","Keep");val manifest=repo.export(id,setOf("first")).second
  File(RuntimeEnvironment.getApplication().filesDir,"agora-documents/${manifest.getString("documentId")}/${manifest.getString("revisionId")}.scopes.json").delete()
  repo.apply(id,proposal(id),JSONArray().put(sheet("Changed")))
  assertEquals("second",repo.pages(id).getJSONObject(1).getString("id"))
 }
 @Test fun continuationFragmentsProjectAsOneLogicalText(){
  val id=repo.newNotebook("List");val sc=sheet("Long ").getJSONObject("sidecar")
  sc.getJSONArray("textBoxes").remove(1)
  sc.getJSONArray("textBoxes").put(JSONObject(sc.getJSONArray("textBoxes").getJSONObject(0).toString()).put("id","fragment").put("y",56).put("text","word").put("semantic",JSONObject().put("id","task").put("type","task").put("role","text").put("continuation",true)))
  storage.saveNotebookFile(id,"planning.write2.json",sc.toString())
  assertEquals("Long word",repo.inspect(id).getJSONArray("blocks").getJSONObject(0).getString("text"))
 }

 @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
 fun displayThumbnailIsExportedWithoutAiPageImagesAndUndoRemainsLossless(){
  val id=repo.newNotebook("Preview");val bitmap=android.graphics.Bitmap.createBitmap(160,240,android.graphics.Bitmap.Config.ARGB_8888)
  bitmap.eraseColor(android.graphics.Color.WHITE);val encoded=java.io.ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,encoded);bitmap.recycle()
  assertTrue(storage.saveThumbnailBytes(id,encoded.toByteArray()))
  val original=repo.revision(id);val exported=repo.export(id,setOf("first"));val manifest=exported.second
  assertEquals("pages/cover.jpg",manifest.getString("thumbnailFile"));assertFalse(manifest.getJSONArray("pages").getJSONObject(0).has("previewFile"))
  val read=exported.first.inputStream().use{com.kalamos.foundation.documents.NotesDocumentBundle.read(it)}
  assertTrue(read.second.getValue("pages/cover.jpg").isNotEmpty())
  val result=repo.apply(id,proposal(id),JSONArray().put(sheet("Changed")));repo.undo(id,result.getString("revisionId"));assertEquals(original,repo.revision(id))
 }
 @Test fun renderCacheUsesExactRevisionAndViewportAndDisplayCoverDoesNotEnableAiImages(){
  val id=repo.newNotebook("Cache");val revision=repo.revision(id);val ids=setOf("first")
  val image="data:image/jpeg;base64,cHJldmlldw=="
  assertEquals(0,repo.previewCache(id,revision,"536x724x2",ids,JSONObject()).getJSONObject("previews").length())
  repo.previewCache(id,revision,"536x724x2",ids,JSONObject().put("first",image))
  assertEquals(image,repo.previewCache(id,revision,"536x724x2",ids,JSONObject()).getJSONObject("previews").getString("first"))
  assertEquals(0,repo.previewCache(id,revision,"360x724x2",ids,JSONObject()).getJSONObject("previews").length())
  val manifest=repo.export(id,ids,displayPreview=image).second
  assertTrue(manifest.has("thumbnailFile"));assertFalse(manifest.getJSONArray("pages").getJSONObject(0).has("previewFile"))
  storage.saveNotebookFile(id,"planning.write2.md","Changed")
  assertThrows(IllegalArgumentException::class.java){repo.export(id,ids,expectedRevisionId=revision)}
 }


 private fun handwritten(id:String) {
  val sc=sheet("Existing annotation").getJSONObject("sidecar")
  sc.put("pageObjects",JSONArray().put(JSONObject().put("id","shape").put("kind","rectangle")))
  sc.put("inkRuns",JSONArray((0..1).map{n -> JSONObject().put("id","word-$n").put("layoutX",16+n*100).put("layoutY",12).put("scale",1).put("strokes",JSONArray().put(JSONObject().put("id","stroke-$n").put("points",JSONArray().put(JSONObject().put("x",4).put("y",4)).put(JSONObject().put("x",60).put("y",40))))) }))
  storage.saveNotebookFile(id,"planning.write2.md","Existing source");storage.saveNotebookFile(id,"planning.write2.json",sc.toString())
 }
 private fun transcription(id:String):JSONObject {
  val region=repo.inspect(id).getJSONArray("inkRegions").getJSONObject(0)
  return proposal(id).put("operation","replace_ink").put("targetPageIds",JSONArray().put("first")).apply{getJSONArray("blocks").getJSONObject(0).put("sourceInkRegionIds",JSONArray().put(region.getString("id")))}
 }
 private fun transcribedSheet(id:String,p:JSONObject):JSONArray {
  val old=repo.pages(id).getJSONObject(0);val sc=JSONObject(old.getJSONObject("sidecar").toString());sc.getJSONArray("inkRuns").remove(0)
  val additions=sheet(p.getJSONArray("blocks").getJSONObject(0).getString("text")).getJSONObject("sidecar").getJSONArray("textBoxes")
  for(n in 0 until additions.length()){val box=additions.getJSONObject(n);box.put("id","transcribed-$n");box.getJSONObject("semantic").put("sourceInkRegionIds",p.getJSONArray("blocks").getJSONObject(0).getJSONArray("sourceInkRegionIds"));sc.getJSONArray("textBoxes").put(box)}
  return JSONArray().put(JSONObject().put("pageId","first").put("source",old.getString("source")).put("sidecar",sc))
 }
 @Test fun replaceInkConsumesOnlyReferencedWordAndUndoRestoresExactDocument(){
  val id=repo.newNotebook("Handwriting");handwritten(id);addPage(id,"second","Untouched")
  val before=repo.pages(id).toString();val index=repo.index(id).toString();repo.export(id,setOf("first"));val p=transcription(id)
  val result=repo.apply(id,p,transcribedSheet(id,p));val page=repo.pages(id).getJSONObject(0)
  assertEquals("first",page.getString("id"));assertEquals("Existing source",page.getString("source"));assertEquals("word-1",page.getJSONObject("sidecar").getJSONArray("inkRuns").getJSONObject(0).getString("id"))
  assertEquals(4,page.getJSONObject("sidecar").getJSONArray("textBoxes").length());assertEquals("shape",page.getJSONObject("sidecar").getJSONArray("pageObjects").getJSONObject(0).getString("id"))
  assertEquals("second",repo.pages(id).getJSONObject(1).getString("id"));repo.undo(id,result.getString("revisionId"));assertEquals(before,repo.pages(id).toString());assertEquals(index,repo.index(id).toString())
 }
 @Test fun staleInkConversionKeepsCurrentTaskTickAndUsesOriginalExportedRegions(){
  val id=repo.newNotebook("Handwriting");handwritten(id);repo.export(id,setOf("first"))
  val p=transcription(id);p.getJSONArray("blocks").getJSONObject(0).put("id","converted")
  val sc=JSONObject(storage.getNotebookFile(id,"planning.write2.json")!!)
  sc.getJSONArray("textBoxes").getJSONObject(1).put("text","☑")
  storage.saveNotebookFile(id,"planning.write2.json",sc.toString())
  val before=repo.pages(id).toString();repo.prepare(id,p)
  val sheets=transcribedSheet(id,p);val boxes=sheets.getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes")
  for(n in 2..3)boxes.getJSONObject(n).getJSONObject("semantic").put("id","converted")
  val saved=repo.apply(id,p,sheets)
  val result=repo.pages(id).getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes")
  assertEquals("☑",result.getJSONObject(1).getString("text"));assertEquals("☐",result.getJSONObject(3).getString("text"))
  assertEquals(1,repo.pages(id).getJSONObject(0).getJSONObject("sidecar").getJSONArray("inkRuns").length())
  repo.undo(id,saved.getString("revisionId"));assertEquals(before,repo.pages(id).toString())
 }
 @Test fun splitElementsConsumeIdenticalSourceGroupOnceAndUndoRestoresInk(){
  val id=repo.newNotebook("Handwriting");handwritten(id);repo.export(id,setOf("first"))
  val before=repo.pages(id).toString();val p=transcription(id)
  val first=p.getJSONArray("blocks").getJSONObject(0);first.put("id","converted-a").put("text","Buy")
  val second=JSONObject(first.toString()).put("id","converted-b").put("text","milk");p.getJSONArray("blocks").put(second)
  val sheets=transcribedSheet(id,p);val boxes=sheets.getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes")
  for(n in 2..3)boxes.getJSONObject(n).getJSONObject("semantic").put("id","converted-a")
  for(n in 2..3){val copied=JSONObject(boxes.getJSONObject(n).toString()).put("id","second-$n").put("y",88);copied.getJSONObject("semantic").put("id","converted-b");if(n==2)copied.put("text","milk");boxes.put(copied)}
  val saved=repo.apply(id,p,sheets)
  assertEquals(1,repo.pages(id).getJSONObject(0).getJSONObject("sidecar").getJSONArray("inkRuns").length())
  assertEquals(6,repo.pages(id).getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes").length())
  repo.undo(id,saved.getString("revisionId"));assertEquals(before,repo.pages(id).toString())
 }
 @Test fun overlappingDifferentReplacementGroupsRejectBeforePublishing(){
  val id=repo.newNotebook("Handwriting");handwritten(id);repo.export(id,setOf("first"));val p=transcription(id)
  val regions=repo.inspect(id).getJSONArray("inkRegions");val first=p.getJSONArray("blocks").getJSONObject(0)
  val second=JSONObject(first.toString()).put("id","other").put("sourceInkRegionIds",JSONArray().put(regions.getJSONObject(0).getString("id")).put(regions.getJSONObject(1).getString("id")))
  p.getJSONArray("blocks").put(second)
  val before=repo.pages(id).toString()
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,transcribedSheet(id,p))}
  assertEquals(before,repo.pages(id).toString())
 }
 @Test fun replacementRejectsMissingUnknownDuplicateAndUnexportedRegions(){
  val id=repo.newNotebook("Handwriting");handwritten(id);val p=transcription(id)
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,transcribedSheet(id,p))}
  repo.export(id,setOf("first"))
  val missing=JSONObject(p.toString());missing.getJSONArray("blocks").getJSONObject(0).remove("sourceInkRegionIds")
  assertThrows(Exception::class.java){repo.apply(id,missing,transcribedSheet(id,p))}
  val unknown=JSONObject(p.toString());unknown.getJSONArray("blocks").getJSONObject(0).put("sourceInkRegionIds",JSONArray().put("unknown"))
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,unknown,transcribedSheet(id,p))}
  val duplicated=JSONObject(p.toString());val refs=duplicated.getJSONArray("blocks").getJSONObject(0).getJSONArray("sourceInkRegionIds");refs.put(refs.getString(0))
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,duplicated,transcribedSheet(id,p))}
  val empty=JSONObject(p.toString());empty.getJSONArray("blocks").getJSONObject(0).put("text","")
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,empty,transcribedSheet(id,p))}
 }
 @Test fun replacementCannotModifyUnconsumedInkOrOtherAnnotations(){
  val id=repo.newNotebook("Handwriting");handwritten(id);repo.export(id,setOf("first"));val p=transcription(id)
  val bad=transcribedSheet(id,p);bad.getJSONObject(0).getJSONObject("sidecar").getJSONArray("inkRuns").getJSONObject(0).put("layoutX",999)
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,bad)}
  val shape=transcribedSheet(id,p);shape.getJSONObject(0).getJSONObject("sidecar").put("pageObjects",JSONArray())
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,shape)}
  val missingTick=transcribedSheet(id,p);missingTick.getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes").remove(3)
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,missingTick)}
  storage.saveNotebookFile(id,"planning.write2.md","Later edit")
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,transcribedSheet(id,p))}
 }
 @Test fun inkRegionsMatchSavedVisualBoundsAndHavePageScopedIds(){
  val id=repo.newNotebook("Handwriting");handwritten(id);val regions=repo.inspect(id).getJSONArray("inkRegions")
  assertEquals(2,regions.length());val bounds=regions.getJSONObject(0).getJSONObject("bounds")
  assertEquals(16.0,bounds.getDouble("x"),0.0);assertEquals(12.0,bounds.getDouble("y"),0.0);assertEquals(64.0,bounds.getDouble("width"),0.0)
 }

 @Test fun exportedPagesCannotAuthorizeInkOnUnexportedPage(){
  val id=repo.newNotebook("Handwriting");handwritten(id);addPage(id,"second","Keep")
  storage.saveNotebookFile(id,"planning.page-second.json",storage.getNotebookFile(id,"planning.write2.json")!!)
  repo.export(id,setOf("first"));val p=transcription(id)
  val regions=repo.inspect(id).getJSONArray("inkRegions");val other=(0 until regions.length()).map{regions.getJSONObject(it)}.first{it.getString("pageId")=="second"}
  p.getJSONArray("blocks").getJSONObject(0).put("sourceInkRegionIds",JSONArray().put(other.getString("id")))
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,transcribedSheet(id,p))}
 }

 private fun style(start:Int,end:Int,flag:String)=JSONObject().put("start",start).put("end",end).put(flag,true)
 @Test fun exportProjectsBulletPrefixAndContinuationInlineStyles(){
  val id=repo.newNotebook("Styled");val sc=sheet("• Bold ").getJSONObject("sidecar");val boxes=sc.getJSONArray("textBoxes");boxes.remove(1)
  val first=boxes.getJSONObject(0);first.getJSONObject("semantic").put("type","bullet");first.put("styles",JSONArray().put(style(2,7,"bold")))
  val continuation=JSONObject(first.toString()).put("id","continued").put("text","end").put("y",56).put("styles",JSONArray().put(style(0,3,"bold")))
  continuation.getJSONObject("semantic").put("continuation",true);boxes.put(continuation)
  storage.saveNotebookFile(id,"planning.write2.json",sc.toString())
  val block=repo.export(id,setOf("first")).second.getJSONArray("blocks").getJSONObject(0)
  assertEquals("Bold end",block.getString("text"));assertEquals(1,block.getJSONArray("styles").length());assertEquals(0,block.getJSONArray("styles").getJSONObject(0).getInt("start"));assertEquals(8,block.getJSONArray("styles").getJSONObject(0).getInt("end"))
 }
 @Test fun styledTranscriptionPersistsAndRejectsMaterializerStyleLoss(){
  val id=repo.newNotebook("Styled ink");handwritten(id);repo.export(id,setOf("first"));val p=transcription(id)
  p.getJSONArray("blocks").getJSONObject(0).put("styles",JSONArray().put(style(0,3,"italic")))
  val missing=transcribedSheet(id,p);assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,missing)}
  val good=transcribedSheet(id,p);good.getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes").getJSONObject(2).put("styles",JSONArray().put(style(0,3,"italic")))
  val result=repo.apply(id,p,good);assertTrue(result.getBoolean("undoAvailable"))
  assertTrue(repo.pages(id).getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes").getJSONObject(2).getJSONArray("styles").getJSONObject(0).getBoolean("italic"))
 }

 @Test fun rawMarkdownMustBeExpandedByEditorBeforePrepareOrCommit(){
  val id=repo.newNotebook("Markdown");handwritten(id);repo.export(id,setOf("first"))
  val raw=transcription(id).put("markdown","- [ ] Milk").put("sourceInkRegions",repo.inspect(id).getJSONArray("inkRegions")).put("blocks",JSONArray())
  com.kalamos.foundation.documents.NotesDocumentBundle.proposalEnvelope(raw)
  val before=repo.revision(id)
  assertThrows(IllegalArgumentException::class.java){repo.prepare(id,raw)}
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,raw,JSONArray())}
  assertEquals(before,repo.revision(id))
 }
 @Test fun imagePageReplacementRetainsPageSlotAndUndoRestoresExactOriginal(){
  val id=repo.newNotebook("Image page")
  storage.saveNotebookFile(id,"planning.write2.md","Original source text")
  repo.export(id,setOf("first"));val before=repo.pages(id).toString()
  val p=proposal(id).put("operation","replace_page").put("targetPageIds",JSONArray().put("first"))
  repo.prepare(id,p)
  val result=repo.apply(id,p,JSONArray().put(sheet("Buy milk")))
  assertEquals(1,repo.index(id).getJSONArray("pages").length())
  assertEquals("Buy milk",repo.inspect(id).getJSONArray("blocks").getJSONObject(0).getString("text"))
  assertEquals("\u200b",repo.pages(id).getJSONObject(0).getString("source"))
  repo.apply(id,p,JSONArray());assertEquals(result.getString("revisionId"),repo.revision(id))
  repo.undo(id,repo.revision(id));assertEquals(before,repo.pages(id).toString())
 }
 @Test fun imagePageNeverRebasesAcrossChangedTaskStateAndCommitRechecks(){
  val id=repo.newNotebook("Image stale");storage.saveNotebookFile(id,"planning.write2.json",sheet("Buy milk").getJSONObject("sidecar").toString())
  repo.export(id,setOf("first"));val p=proposal(id).put("operation","replace_page").put("targetPageIds",JSONArray().put("first"));repo.prepare(id,p)
  val changed=sheet("Buy milk").getJSONObject("sidecar");changed.getJSONArray("textBoxes").getJSONObject(1).put("text","☑")
  storage.saveNotebookFile(id,"planning.write2.json",changed.toString());val before=repo.pages(id).toString()
  assertThrows(IllegalArgumentException::class.java){repo.prepare(id,p)}
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,JSONArray().put(sheet("Buy milk")))}
  assertEquals(before,repo.pages(id).toString())
 }
 @Test fun imagePageRejectsAlteredContentAndUnalignedGeometry(){
  val id=repo.newNotebook("Image invalid");repo.export(id,setOf("first"));val before=repo.pages(id).toString()
  val p=proposal(id).put("operation","replace_page").put("targetPageIds",JSONArray().put("first"))
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,JSONArray().put(sheet("Different text")))}
  val invalid=sheet("Buy milk");invalid.getJSONObject("sidecar").getJSONArray("textBoxes").getJSONObject(0).put("y",13)
  assertThrows(IllegalArgumentException::class.java){repo.apply(id,p,JSONArray().put(invalid))}
  assertEquals(before,repo.pages(id).toString())
 }

 @Test fun imageOnlyAdmissionAvoidsArchivesAndStillSupportsScopeValidationAndUndo(){
  val id=repo.newNotebook("Image admission");storage.saveNotebookFile(id,"planning.write2.md","Original source")
  val revision=repo.revision(id);val context=repo.prepareImage(id,"first",revision)
  assertEquals(setOf("documentId","revisionId","title","pageId"),context.keys().asSequence().toSet())
  assertEquals("first",context.getString("pageId"));assertEquals(revision,context.getString("revisionId"))
  val directory=File(RuntimeEnvironment.getApplication().filesDir,"agora-documents/"+context.getString("documentId"))
  assertFalse(directory.walkTopDown().any{it.extension=="zip"});assertFalse(File(directory,"$revision.json").exists())
  val before=repo.pages(id).toString();val p=proposal(id).put("operation","replace_page").put("targetPageIds",JSONArray().put("first"))
  repo.prepare(id,p);repo.apply(id,p,JSONArray().put(sheet("Buy milk")))
  repo.undo(id,repo.revision(id));assertEquals(before,repo.pages(id).toString())
 }
 @Test fun imageOnlyAdmissionRejectsStaleRevisionAndUnknownPage(){
  val id=repo.newNotebook("Image stale");val revision=repo.revision(id)
  assertThrows(IllegalArgumentException::class.java){repo.prepareImage(id,"missing",revision)}
  storage.saveNotebookFile(id,"planning.write2.md","Changed")
  assertThrows(IllegalArgumentException::class.java){repo.prepareImage(id,"first",revision)}
 }

 @Test fun imageReplacementDoesNotJumpAwayFromAnotherOpenPage(){
  val id=repo.newNotebook("Keep active page")
  storage.saveNotebookFile(id,"planning.pages.json",JSONObject().put("version",1).put("active",1).put("pages",JSONArray()
   .put(JSONObject().put("id","first").put("sourceFile","planning.write2.md").put("sidecarFile","planning.write2.json"))
   .put(JSONObject().put("id","second").put("sourceFile","planning.page-second.md").put("sidecarFile","planning.page-second.json"))).toString())
  val revision=repo.revision(id);repo.prepareImage(id,"first",revision)
  val p=proposal(id).put("operation","replace_page").put("targetPageIds",JSONArray().put("first"))
  repo.apply(id,p,JSONArray().put(sheet("Buy milk")))
  val index=repo.index(id);assertEquals(1,index.getInt("active"));assertEquals("second",index.getJSONArray("pages").getJSONObject(index.getInt("active")).getString("id"))
 }

}
