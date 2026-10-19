package com.kalamos.foundation.documents

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class NotesInteractiveMergeTest {
    private fun snapshot()=JSONObject("""{"title":"Tasks","pages":[{"id":"first","source":"unchanged","sidecar":{"inkRuns":[{"id":"ink"}],"textBoxes":[{"id":"tick","checkbox":true,"text":"☐","x":40,"words":[{"text":"☐","x":40}],"semantic":{"id":"task","type":"task","role":"checkbox"}}]}}]}""")
    private fun tick(snapshot:JSONObject)=snapshot.getJSONArray("pages").getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes").getJSONObject(0)
    @Test fun checkboxTextAndWordStateMergePreservesIndependentFormatting() {
        val base=snapshot();val current=snapshot();tick(current).put("text","☑").getJSONArray("words").getJSONObject(0).put("text","☑")
        val changes=NotesInteractiveMerge.changes(base,current)
        assertEquals(listOf(NotesInteractiveMerge.Change("first","task",true)),changes)
        val proposed=JSONObject("""{"blocks":[{"id":"task","type":"task","text":"Buy milk","checked":false}]}""")
        val merged=NotesInteractiveMerge.proposal(proposed,changes,setOf("first"))
        assertTrue(merged.getJSONArray("blocks").getJSONObject(0).getBoolean("checked"))
        assertFalse(proposed.getJSONArray("blocks").getJSONObject(0).getBoolean("checked"))
        assertEquals("Buy milk",merged.getJSONArray("blocks").getJSONObject(0).getString("text"))
        val sheet=JSONArray().put(current.getJSONArray("pages").getJSONObject(0))
        tick(current).put("text","☐")
        val patched=NotesInteractiveMerge.sheets(sheet,changes)
        assertEquals("☑",patched.getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes").getJSONObject(0).getString("text"))
    }
    @Test fun sourceInkGeometryAndUnknownControlChangesAreConflicts() {
        val base=snapshot()
        for(field in listOf("source","ink","geometry","unknown")) {
            val current=snapshot();val page=current.getJSONArray("pages").getJSONObject(0)
            when(field){
                "source" -> page.put("source","edited")
                "ink" -> page.getJSONObject("sidecar").put("inkRuns",JSONArray())
                "geometry" -> tick(current).put("x",60)
                "unknown" -> page.getJSONObject("sidecar").put("htmlState",JSONObject().put("value","new"))
            }
            assertThrows(IllegalArgumentException::class.java){NotesInteractiveMerge.changes(base,current)}
        }
    }
    @Test fun changedTaskCannotBeSilentlyDeletedOrConvertedToText() {
        val changes=listOf(NotesInteractiveMerge.Change("first","task",true))
        assertThrows(IllegalArgumentException::class.java){NotesInteractiveMerge.proposal(JSONObject("""{"blocks":[]}"""),changes,setOf("first"))}
        assertThrows(IllegalArgumentException::class.java){NotesInteractiveMerge.proposal(JSONObject("""{"blocks":[{"id":"task","type":"paragraph"}]}"""),changes,setOf("first"))}
        assertEquals(0,NotesInteractiveMerge.proposal(JSONObject("""{"blocks":[]}"""),changes,setOf("other")).getJSONArray("blocks").length())
    }
}
