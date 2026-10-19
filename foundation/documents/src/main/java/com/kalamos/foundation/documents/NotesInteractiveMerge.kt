package com.kalamos.foundation.documents

import org.json.JSONArray
import org.json.JSONObject

/** State-only three-way merge. New controls opt in through a concrete codec; unknown
 * content is never ignored merely because it happens to be HTML or interactive. */
object NotesInteractiveMerge {
    data class Change(val pageId: String, val elementId: String, val checked: Boolean)

    fun changes(base: JSONObject, current: JSONObject): List<Change> {
        val before=JSONObject(base.toString()); val after=JSONObject(current.toString())
        val oldStates=normalize(before); val newStates=normalize(after)
        require(canonical(before)==canonical(after)) { "The note's content changed while Agora was processing it. Process the current version again." }
        require(oldStates.keys==newStates.keys) { "Interactive elements changed" }
        return newStates.filter { (key,value) -> oldStates[key]!=value }.map { (key,value) -> Change(key.first,key.second,value) }
    }

    fun proposal(proposal: JSONObject, changes: List<Change>, selected: Set<String>): JSONObject {
        val result=JSONObject(proposal.toString())
        if(result.optString("operation","organize")=="replace_ink")return result
        val blocks=result.getJSONArray("blocks")
        val byId=(0 until blocks.length()).associate { blocks.getJSONObject(it).getString("id") to blocks.getJSONObject(it) }
        for(change in changes.filter { it.pageId in selected }) {
            val block=requireNotNull(byId[change.elementId]) { "AI result removed a task you changed; process the current version again" }
            require(block.getString("type")=="task") { "AI result changed the type of a task you changed" }
            block.put("checked",change.checked)
        }
        return result
    }

    fun sheets(sheets: JSONArray, changes: List<Change>): JSONArray {
        val result=JSONArray(sheets.toString()); val states=changes.associate { it.elementId to it.checked }
        for(i in 0 until result.length()) {
            val boxes=result.getJSONObject(i).getJSONObject("sidecar").optJSONArray("textBoxes")?:continue
            for(n in 0 until boxes.length()) {
                val box=boxes.getJSONObject(n);val semantic=box.optJSONObject("semantic")?:continue
                val state=states[semantic.optString("id")]?:continue
                if(semantic.optString("role")=="checkbox" && semantic.optString("type")=="task" && box.optBoolean("checkbox"))setTick(box,state)
            }
        }
        return result
    }

    private fun normalize(snapshot: JSONObject): Map<Pair<String,String>,Boolean> {
        val states=linkedMapOf<Pair<String,String>,Boolean>()
        val pages=snapshot.getJSONArray("pages")
        for(i in 0 until pages.length()) {
            val page=pages.getJSONObject(i);val boxes=page.getJSONObject("sidecar").optJSONArray("textBoxes")?:continue
            for(n in 0 until boxes.length()) {
                val box=boxes.getJSONObject(n);val semantic=box.optJSONObject("semantic")?:continue
                if(semantic.optString("role")!="checkbox" || semantic.optString("type")!="task" || !box.optBoolean("checkbox"))continue
                val text=box.getString("text")
                require(text in setOf("☑","☐")) { "Invalid checkbox state" }
                val words=box.optJSONArray("words")
                if(words!=null)for(w in 0 until words.length())require(words.getJSONObject(w).getString("text")==text) { "Invalid checkbox word state" }
                val key=page.getString("id") to semantic.getString("id")
                require(states.put(key,text=="☑")==null) { "Duplicate checkbox identity" }
                setTick(box,false)
            }
        }
        return states
    }
    private fun setTick(box:JSONObject,checked:Boolean) {
        val text=if(checked)"☑" else "☐";box.put("text",text)
        val words=box.optJSONArray("words")?:return
        for(i in 0 until words.length())words.getJSONObject(i).put("text",text)
    }
    private fun canonical(value:Any?):String=when(value) {
        is JSONObject -> value.keys().asSequence().filter { it !in setOf("createdAt","updatedAt") }.sorted().joinToString(",","{","}"){JSONObject.quote(it)+":"+canonical(value.get(it))}
        is JSONArray -> (0 until value.length()).joinToString(",","[","]"){canonical(value.get(it))}
        is String -> JSONObject.quote(value)
        null, JSONObject.NULL -> "null"
        else -> value.toString()
    }
}
