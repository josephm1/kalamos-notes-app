package com.kalamos.notebook.ai

import android.app.Application
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class NotesAiSettingsTest {
    private val context get()=RuntimeEnvironment.getApplication()
    @Before fun clean(){context.getSharedPreferences("notes-ai",0).edit().clear().commit();context.getSharedPreferences("scribe_secrets",0).edit().clear().commit()}
    private fun input(key:String="fixture-key")=JSONObject().put("baseUrl","https://example.invalid/v1").put("model","vision-model").put("apiKey",key)
    @Test fun ownConfigurationKeepsKeyNativeAndBlankInputPreservesIt(){
        val settings=NotesAiSettings(context);assertFalse(settings.status().getBoolean("configured"))
        val result=settings.save(input());assertTrue(result.getBoolean("configured"));assertFalse(result.toString().contains("fixture-key"));assertFalse(result.has("apiKey"))
        assertEquals("fixture-key",NotesAiSettings(context).provider().key)
        settings.save(input(""));assertEquals("fixture-key",settings.provider().key)
        settings.save(input("").put("clearKey",true));assertFalse(settings.status().getBoolean("hasKey"))
        assertThrows(IllegalStateException::class.java){settings.provider()}
    }
    @Test fun rejectsUnsafeEndpointsAndMissingModelWithoutSavingSecrets(){
        val settings=NotesAiSettings(context)
        for(url in listOf("http://example.invalid/v1","https://user:secret@example.invalid/v1","https://example.invalid/v1?key=hidden","https://example.invalid/v1/chat/completions"))
            assertThrows(Exception::class.java){settings.save(input().put("baseUrl",url))}
        assertThrows(IllegalArgumentException::class.java){settings.save(input().put("model",""))}
        assertThrows(IllegalArgumentException::class.java){settings.save(input("invalid-€"))}
        assertFalse(settings.status().getBoolean("hasKey"))
    }
    @Test fun thinkingDefaultsOffPersistsAndRejectsInvalidValuesBeforeSaving(){
        val settings=NotesAiSettings(context)
        assertEquals("none",settings.status().getString("thinking"))
        settings.save(input().put("thinking","low"));assertEquals("low",NotesAiSettings(context).provider().thinking)
        settings.save(input(""));assertEquals("low",settings.provider().thinking)
        assertThrows(IllegalArgumentException::class.java){settings.save(input("replacement").put("thinking","invalid"))}
        assertEquals("low",settings.provider().thinking);assertEquals("fixture-key",settings.provider().key)
        settings.save(input("").put("thinking","none"));assertEquals("none",settings.provider().thinking)
    }

}
