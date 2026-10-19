package com.kalamos.notebook.ai

import android.app.Application
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class NotesAiModelsTest {
    @Test fun discoveryDoesNotRequireAModelOrWriteConfiguration(){
        val context=RuntimeEnvironment.getApplication()
        context.getSharedPreferences("notes-ai",0).edit().clear().commit()
        context.getSharedPreferences("scribe_secrets",0).edit().clear().commit()
        val settings=NotesAiSettings(context)
        val provider=settings.modelProvider(JSONObject().put("baseUrl","https://example.invalid/v1/").put("apiKey","fixture-key"))
        val request=NotesAiModels.request(provider)
        assertEquals("GET",request.method);assertNull(request.body)
        assertEquals("https://example.invalid/v1/models",request.url.toString());assertEquals("Bearer fixture-key",request.header("Authorization"))
        assertFalse(settings.status().getBoolean("configured"));assertFalse(settings.status().getBoolean("hasKey"))
        settings.save(JSONObject().put("baseUrl",provider.baseUrl).put("model","saved-model").put("apiKey","saved-key"))
        assertEquals("saved-key",settings.modelProvider(JSONObject().put("baseUrl",provider.baseUrl)).key)
        assertThrows(IllegalArgumentException::class.java){settings.modelProvider(JSONObject().put("baseUrl","https://different.invalid/v1"))}
        assertEquals("new-key",settings.modelProvider(JSONObject().put("baseUrl","https://different.invalid/v1").put("apiKey","new-key")).key)
        assertEquals(provider.baseUrl,settings.status().getString("baseUrl"))
    }
    @Test fun supportsOpenAICompatibleIdsAndOpenRouterNamesAndCapabilities(){
        val result=NotesAiModels.parse("""{"data":[{"id":"z-model"},{"id":"a/model","name":"A Model","architecture":{"input_modalities":["text","image"],"output_modalities":["text"]}},{"id":"a/model"},{"id":"image-generator","architecture":{"output_modalities":["image"]}}]}""")
        val models=result.getJSONArray("models");assertEquals(2,models.length())
        assertEquals("a/model",models.getJSONObject(0).getString("id"));assertTrue(models.getJSONObject(0).getBoolean("vision"))
        assertFalse(models.getJSONObject(1).has("vision"));assertFalse(result.getBoolean("truncated"))
    }
    @Test fun malformedEmptyAndInvalidCataloguesFailWithoutInventingModels(){
        for(body in listOf("not json","""{"data":[]}""","""{"data":[{"id":""},{"id":8},{"name":"missing-id"}]}"""))
            assertThrows(Exception::class.java){NotesAiModels.parse(body)}
    }
    @Test fun largeOrPaginatedCataloguesReportLimitsAndFitTheNativeEventChannel(){
        val rows=JSONArray();for(i in 0..2999)rows.put(JSONObject().put("id","model-$i").put("name","Model "+"n".repeat(100)))
        val result=NotesAiModels.parse(JSONObject().put("data",rows).toString())
        assertTrue(result.getBoolean("truncated"));assertTrue(result.toString().toByteArray().size<200000)
        assertTrue(result.getJSONArray("models").length()>0)
        assertTrue(NotesAiModels.parse("""{"has_more":true,"data":[{"id":"first"}]}""").getBoolean("truncated"))
    }
}
