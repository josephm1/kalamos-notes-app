package com.kalamos.notebook.ai

import org.json.JSONObject

/** Require a completed Responses stream before proposing any change to a notebook. */
internal object NotesPlanResponses {
    fun text(stream: String): String {
        val answer=StringBuilder();val event=StringBuilder();var completed=false;var finalText:String?=null
        fun consume(){
            if(event.isEmpty())return
            val raw=event.toString();event.setLength(0);if(raw=="[DONE]")return
            val value=JSONObject(raw)
            when(value.optString("type")) {
                "response.output_text.delta" -> {answer.append(value.getString("delta"));require(answer.length<=70000) { "The AI response is too large" }}
                "response.failed","response.incomplete","error" -> error("ChatGPT did not complete the response. Your note is unchanged. Check your plan usage or connection settings.")
                "response.completed" -> {
                    val response=value.getJSONObject("response");check(response.optString("status")=="completed") { "The AI response was incomplete. Your note is unchanged." }
                    val output=response.optJSONArray("output");val text=StringBuilder()
                    for(i in 0 until (output?.length() ?: 0)) {
                        val content=output?.optJSONObject(i)?.optJSONArray("content")
                        for(j in 0 until (content?.length() ?: 0)) { val block=content?.optJSONObject(j) ?: continue;if(block.optString("type")=="output_text")text.append(block.getString("text")) }
                    }
                    finalText=text.toString().takeIf { it.isNotBlank() };completed=true
                }
            }
        }
        stream.lineSequence().forEach { line -> if(line.isEmpty())consume() else if(line.startsWith("data:")){if(event.isNotEmpty())event.append('\n');event.append(line.substring(5).trimStart())} };consume()
        check(completed) { "The ChatGPT stream ended before completion. Your note is unchanged." }
        return (finalText ?: answer.toString()).trim().also { require(it.isNotBlank() && it.length<=70000) { "The AI response is empty or too large" } }
    }
}
