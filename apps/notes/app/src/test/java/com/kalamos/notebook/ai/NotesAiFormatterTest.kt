package com.kalamos.notebook.ai

import android.app.Application
import com.kalamos.foundation.documents.NotesDocumentBundle as Bundle
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class NotesAiFormatterTest {
    private val provider=NotesAiSettings.Provider("https://example.invalid/v1","vision-model","fixture-secret")
    private fun image(image:Boolean=true):Pair<File,JSONObject> {
        val target=File.createTempFile("notes-format-",".jpg");target.writeBytes(if(image)byteArrayOf(1,2,3)else byteArrayOf())
        val metadata=JSONObject().put("documentId",UUID.randomUUID().toString()).put("revisionId","a".repeat(64)).put("title","Notebook title").put("pageId","first")
        return target to metadata
    }
    private fun response(text:String,finish:String="stop")=JSONObject().put("choices",JSONArray().put(JSONObject().put("finish_reason",finish).put("message",JSONObject().put("content",text)))).toString()
    @Test fun pageRequestContainsOnlyPromptAndJpegForHandwritingMixedAndTypedPages(){
        for(ink in listOf(true,false)) {
            val(source,manifest)=image()
            val formatter=NotesAiFormatter(provider){request->
                assertEquals("https://example.invalid/v1/chat/completions",request.url.toString());assertEquals("Bearer fixture-secret",request.header("Authorization"))
                val buffer=Buffer();request.body!!.writeTo(buffer);val payload=JSONObject(buffer.readUtf8())
                assertEquals("vision-model",payload.getString("model"));assertFalse(payload.getBoolean("stream"))
                val messages=payload.getJSONArray("messages");assertEquals(1,messages.length());assertEquals("user",messages.getJSONObject(0).getString("role"))
                val parts=messages.getJSONObject(0).getJSONArray("content");assertEquals(2,parts.length())
                assertEquals(NotesAiFormatter.MARKDOWN_PROMPT,parts.getJSONObject(0).getString("text"))
                assertEquals("data:image/jpeg;base64,AQID",parts.getJSONObject(1).getJSONObject("image_url").getString("url"))
                assertFalse(payload.toString().contains("Original text"));assertFalse(payload.toString().contains(manifest.getString("documentId")))
                response("# Groceries\n- [x] Milk")
            }
            val result=formatter.format(source,manifest)
            assertEquals("replace_page",result.getString("operation"));assertEquals(manifest.getString("documentId"),result.getString("documentId"))
            assertFalse(result.has("sourceInkRegions"));assertEquals(0,result.getJSONArray("blocks").length())
            assertEquals("Notebook title",result.getString("title"));assertEquals("# Groceries\n- [x] Milk",result.getString("markdown"))
            assertFalse(result.toString().contains("fixture-secret"))
        }
    }
    @Test fun incompleteEmptyAndMalformedResponsesCannotBecomeARevision(){
        val(source,manifest)=image()
        for(raw in listOf(response("partial","length"),response(""),"not json"))
            assertThrows(Exception::class.java){NotesAiFormatter(provider){raw}.format(source,manifest)}
    }
    @Test fun aPageWithoutAnImageCannotSilentlyFallBackToSendingText(){
        val(source,manifest)=image(false)
        assertThrows(Exception::class.java){NotesAiFormatter(provider){error("Must not send a request without image")}.format(source,manifest)}
    }
    @Test fun thinkingControlsUseProviderProtocolAndNeverRelyOnDefaultForOffOrLow(){
        val(source,manifest)=image()
        for(host in listOf("api.deepseek.com","openrouter.ai","example.invalid"))for(level in listOf("none","low","high","max","default")) {
            NotesAiFormatter(NotesAiSettings.Provider("https://$host/v1","deepseek-flash","fixture-secret",level)){request->
                val buffer=Buffer();request.body!!.writeTo(buffer);val body=JSONObject(buffer.readUtf8())
                if(level=="default") {assertFalse(body.has("thinking"));assertFalse(body.has("reasoning"));assertFalse(body.has("reasoning_effort"))}
                else when(host) {
                    "api.deepseek.com" -> {
                        assertEquals(if(level=="none")"disabled" else "enabled",body.getJSONObject("thinking").getString("type"))
                        if(level=="none")assertFalse(body.has("reasoning_effort"))else assertEquals(level,body.getString("reasoning_effort"))
                    }
                    "openrouter.ai" -> {assertEquals(level,body.getJSONObject("reasoning").getString("effort"));assertTrue(body.getJSONObject("provider").getBoolean("require_parameters"))}
                    else -> assertEquals(level,body.getString("reasoning_effort"))
                }
                response("Text")
            }.format(source,manifest)
        }
    }

    @Test fun chatGptPlanUsesOfficialResponsesAndOnlyCompletedTextBecomesAProposal() {
        val (source, manifest) = image()
        val plan = NotesAiSettings.Provider("https://untrusted.invalid/v1", "plan-model", "fixture-token", chatGptAccountId="fixture-account")
        val formatter = NotesAiFormatter(plan) { request ->
            assertEquals("https://api.openai.com/v1/responses", request.url.toString())
            assertEquals("Bearer fixture-token", request.header("Authorization"))
            assertEquals("text/event-stream", request.header("Accept"))
            val buffer=Buffer(); request.body!!.writeTo(buffer); val body=JSONObject(buffer.readUtf8())
            assertFalse(body.getBoolean("store")); assertTrue(body.getBoolean("stream"))
            assertFalse(body.has("messages")); assertFalse(body.has("reasoning"))
            val parts=body.getJSONArray("input").getJSONObject(0).getJSONArray("content")
            assertEquals("input_image",parts.getJSONObject(1).getString("type"))
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"# Plan note\"}\n\n" +
                "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n"
        }
        assertEquals("# Plan note", formatter.format(source,manifest).getString("markdown"))
    }
    @Test fun chatGptPartialFailedOrIncompleteStreamsNeverProduceAProposal() {
        val (source,manifest)=image()
        val plan=provider.copy(chatGptAccountId="fixture-account")
        val delta="data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n"
        for (tail in listOf("", "data: [DONE]\n\n", "data: {\"type\":\"response.failed\"}\n\n",
            "data: {\"type\":\"response.incomplete\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"incomplete\"}}\n\n")) {
            assertThrows(Exception::class.java) { NotesAiFormatter(plan) { delta+tail }.format(source,manifest) }
        }
    }

}
