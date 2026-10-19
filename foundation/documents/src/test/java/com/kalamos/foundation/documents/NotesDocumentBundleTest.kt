package com.kalamos.foundation.documents
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
class NotesDocumentBundleTest {
 private fun manifest()=JSONObject().put("schema",NotesDocumentBundle.SCHEMA).put("documentId",UUID.randomUUID().toString()).put("revisionId","a".repeat(64)).put("title","Note").put("blocks",JSONArray().put(JSONObject().put("id","task").put("type","task").put("text","Milk").put("checked",false))).put("pages",JSONArray().put(JSONObject().put("id","first").put("sourceFile","pages/first.md").put("sidecarFile","pages/first.json")))
 private val files=mapOf("pages/first.md" to "hello".toByteArray(),"pages/first.json" to "{}".toByteArray())
 @Test fun imageFramesRejectInvalidDimensionsAndPreserveExactUnits(){
  val frame=JSONObject("""{"x":0,"y":0,"width":500,"height":623,"pixelWidth":1000,"pixelHeight":1246}""")
  assertEquals(frame.toString(),NotesDocumentBundle.imageFrame(frame).toString())
  for(key in listOf("width","height","pixelWidth","pixelHeight")){
   assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.imageFrame(JSONObject(frame.toString()).put(key,0))}
  }
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.imageFrame(JSONObject(frame.toString()).put("pixelWidth",1.5))}
 }
 @Test fun losslessBundleRetainsBytesAndTaskState(){val out=ByteArrayOutputStream();NotesDocumentBundle.write(manifest(),files,out);val (m,f)=NotesDocumentBundle.read(ByteArrayInputStream(out.toByteArray()));assertEquals(false,m.getJSONArray("blocks").getJSONObject(0).getBoolean("checked"));assertArrayEquals(files.getValue("pages/first.md"),f.getValue("pages/first.md"))}
 @Test fun rejectsPathTraversal(){val out=ByteArrayOutputStream();ZipOutputStream(out).use{it.putNextEntry(ZipEntry("../outside"));it.write("bad".toByteArray());it.closeEntry()};assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.read(ByteArrayInputStream(out.toByteArray()))}}
 @Test fun refusesChecksumMismatch(){val m=manifest();val out=ByteArrayOutputStream();NotesDocumentBundle.write(m,files,out);assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.validate(m,files+mapOf("pages/first.md" to "changed".toByteArray()))}}
 @Test fun rejectsDuplicateSemanticIdentitiesAndMissingTaskState(){val m=manifest();val b=m.getJSONArray("blocks");b.put(b.getJSONObject(0));assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.blocks(b)};val task=b.getJSONObject(0);task.remove("checked");assertThrows(Exception::class.java){NotesDocumentBundle.blocks(JSONArray().put(task))}}
 @Test fun validatesOptionalProposalPageScope(){
  val proposal=JSONObject().put("schema",NotesDocumentBundle.PROPOSAL_SCHEMA).put("proposalId",UUID.randomUUID().toString()).put("title","Note").put("blocks",manifest().getJSONArray("blocks"))
  NotesDocumentBundle.proposal(proposal.put("targetPageIds",JSONArray().put("first")))
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposal(proposal.put("targetPageIds",JSONArray().put("first").put("first")))}
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposal(proposal.put("targetPageIds",JSONArray().put("../outside")))}
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposal(proposal.put("targetPageIds","first"))}
 }
 @Test fun displayThumbnailHasSeparateValidatedChecksum(){
  val cover="cover".toByteArray();val m=manifest().put("thumbnailFile","pages/cover.jpg");val out=ByteArrayOutputStream()
  NotesDocumentBundle.write(m,files+mapOf("pages/cover.jpg" to cover),out)
  val restored=NotesDocumentBundle.read(ByteArrayInputStream(out.toByteArray()));assertArrayEquals(cover,restored.second.getValue("pages/cover.jpg"))
  assertFalse(restored.first.getJSONArray("pages").getJSONObject(0).has("previewFile"))
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.validate(m,files+mapOf("pages/cover.jpg" to "changed".toByteArray()))}
 }
 @Test fun acceptsAgoraEncodedDefaultsAndValidatesTranscriptionReferences(){
  val fixture=JSONObject("""{"schema":"kalamos.notes-proposal/v1","proposalId":"11111111-1111-4111-8111-111111111111","title":"Tasks","blocks":[{"id":"task-1","type":"task","text":"Milk","checked":false}],"operation":"organize"}""")
  NotesDocumentBundle.proposal(fixture)
  fixture.put("operation","replace_ink").put("documentId",UUID.randomUUID().toString()).put("baseRevisionId","a".repeat(64))
  assertThrows(Exception::class.java){NotesDocumentBundle.proposal(fixture)}
  fixture.getJSONArray("blocks").getJSONObject(0).put("sourceInkRegionIds",JSONArray().put("ink-one"))
  NotesDocumentBundle.proposal(fixture)
  fixture.getJSONArray("blocks").getJSONObject(0).put("text","")
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposal(fixture)}
 }
 @Test fun validatesNestedElementsWithoutDiscardingParentIdentity(){
  val group=JSONObject().put("id","buy").put("type","task").put("text","Buy milk").put("checked",false)
  val child=JSONObject().put("id","eggs").put("type","bullet").put("text","eggs").put("parentId","buy")
  val blocks=JSONArray().put(group).put(child)
  assertEquals("buy",NotesDocumentBundle.blocks(blocks).getJSONObject(1).getString("parentId"))
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.blocks(JSONArray().put(child))}
  group.put("parentId","eggs")
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.blocks(blocks)}
 }

 @Test fun inlineStylesUseValidatedUtf16OffsetsAndCompactFlags(){
  val text="A😀 B";val range=JSONObject().put("start",1).put("end",3).put("bold",true).put("italic",false)
  val normalized=NotesDocumentBundle.styles(text,JSONArray().put(range));assertFalse(normalized.getJSONObject(0).has("italic"))
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.styles(text,JSONArray().put(JSONObject().put("start",1.5).put("end",3).put("bold",true)))}
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.styles(text,JSONArray().put(JSONObject().put("start",0).put("end",99).put("bold",true)))}
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.styles(text,JSONArray().put(JSONObject().put("start",0).put("end",2).put("bold",true)).put(JSONObject().put("start",1).put("end",3).put("italic",true)))}
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.styles(text,JSONArray().put(JSONObject().put("start",0).put("end",1).put("bold","true")))}
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.styles(text,JSONArray().put(JSONObject().put("start",0).put("end",1).put("bold",false)))}
 }
 private fun markdownEnvelope():JSONObject=JSONObject().put("schema",NotesDocumentBundle.PROPOSAL_SCHEMA).put("proposalId",UUID.randomUUID().toString()).put("documentId",UUID.randomUUID().toString()).put("baseRevisionId","a".repeat(64)).put("title","Transcription").put("operation","replace_ink").put("blocks",JSONArray()).put("targetPageIds",JSONArray().put("first")).put("markdown","- [ ] **Milk**").put("sourceInkRegions",JSONArray().put(JSONObject().put("id","ink-original").put("pageId","first").put("runId","run-original").put("strokeIds",JSONArray().put("stroke-original")).put("bounds",JSONObject().put("x",16).put("y",0).put("width",120).put("height",50))))
 @Test fun markdownTransportIsAdmittedButCannotBypassStrictApplyValidation(){
  val envelope=markdownEnvelope();assertSame(envelope,NotesDocumentBundle.proposalEnvelope(envelope))
  assertEquals("- [ ] **Milk**",envelope.getString("markdown"));assertEquals(0,envelope.getJSONArray("blocks").length())
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposal(envelope)}
  envelope.put("blocks",JSONArray().put(JSONObject().put("id","parsed-task").put("type","task").put("text","Milk").put("checked",false).put("sourceInkRegionIds",JSONArray().put("ink-original"))))
  NotesDocumentBundle.proposal(envelope)
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(envelope)}
 }
 @Test fun markdownTransportRequiresCapturedRevisionScopedInk(){
  val missing=markdownEnvelope();missing.remove("sourceInkRegions");assertThrows(Exception::class.java){NotesDocumentBundle.proposalEnvelope(missing)}
  val empty=markdownEnvelope().put("markdown"," ");assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(empty)}
  val tooLarge=markdownEnvelope().put("markdown","x".repeat(60001));assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(tooLarge)}
  val wrongScope=markdownEnvelope();wrongScope.getJSONArray("sourceInkRegions").getJSONObject(0).put("pageId","other");assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(wrongScope)}
  val duplicate=markdownEnvelope();duplicate.getJSONArray("sourceInkRegions").put(duplicate.getJSONArray("sourceInkRegions").getJSONObject(0));assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(duplicate)}
  val noRevision=markdownEnvelope();noRevision.remove("baseRevisionId");assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(noRevision)}
 }
 @Test fun wholePageMarkdownRequiresOnePageAndCapturedRevisionWithoutInkBindings(){
  val envelope=markdownEnvelope().put("operation","replace_page");envelope.remove("sourceInkRegions")
  assertSame(envelope,NotesDocumentBundle.proposalEnvelope(envelope))
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(JSONObject(envelope.toString()).put("targetPageIds",JSONArray()))}
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(JSONObject(envelope.toString()).put("targetPageIds",JSONArray().put("first").put("second")))}
  val missing=JSONObject(envelope.toString());missing.remove("baseRevisionId")
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(missing)}
  assertThrows(IllegalArgumentException::class.java){NotesDocumentBundle.proposalEnvelope(JSONObject(envelope.toString()).put("blocks",manifest().getJSONArray("blocks")))}
 }

}
