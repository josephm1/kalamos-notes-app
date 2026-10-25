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
    private val secure = NotesAiTestSecrets()
    private val context get()=RuntimeEnvironment.getApplication()
    @Before fun clean(){context.getSharedPreferences("chatgpt-billing",0).edit().clear().commit();context.getSharedPreferences("notes-ai",0).edit().clear().commit();context.getSharedPreferences("scribe_secrets",0).edit().clear().commit()}
    private fun input(key:String="fixture-key")=JSONObject().put("baseUrl","https://example.invalid/v1").put("model","vision-model").put("apiKey",key)
    @Test fun ownConfigurationKeepsKeyNativeAndBlankInputPreservesIt(){
        val settings=secure.settings(context);assertFalse(settings.status().getBoolean("configured"))
        val result=settings.save(input());assertTrue(result.getBoolean("configured"));assertFalse(result.toString().contains("fixture-key"));assertFalse(result.has("apiKey"))
        assertEquals("fixture-key",secure.settings(context).provider().key)
        settings.save(input(""));assertEquals("fixture-key",settings.provider().key)
        settings.save(input("").put("clearKey",true));assertFalse(settings.status().getBoolean("hasKey"))
        assertThrows(IllegalStateException::class.java){settings.provider()}
    }
    @Test fun rejectsUnsafeEndpointsAndMissingModelWithoutSavingSecrets(){
        val settings=secure.settings(context)
        for(url in listOf("http://example.invalid/v1","https://user:secret@example.invalid/v1","https://example.invalid/v1?key=hidden","https://example.invalid/v1/chat/completions"))
            assertThrows(Exception::class.java){settings.save(input().put("baseUrl",url))}
        assertThrows(IllegalArgumentException::class.java){settings.save(input().put("model",""))}
        assertThrows(IllegalArgumentException::class.java){settings.save(input("invalid-€"))}
        assertFalse(settings.status().getBoolean("hasKey"))
    }
    @Test fun thinkingDefaultsOffPersistsAndRejectsInvalidValuesBeforeSaving(){
        val settings=secure.settings(context)
        assertEquals("none",settings.status().getString("thinking"))
        settings.save(input().put("thinking","low"));assertEquals("low",secure.settings(context).provider().thinking)
        settings.save(input(""));assertEquals("low",settings.provider().thinking)
        assertThrows(IllegalArgumentException::class.java){settings.save(input("replacement").put("thinking","invalid"))}
        assertEquals("low",settings.provider().thinking);assertEquals("fixture-key",settings.provider().key)
        settings.save(input("").put("thinking","none"));assertEquals("none",settings.provider().thinking)
    }

    @Test fun aChangedEndpointCannotInheritTheSavedCredential(){
        val settings=secure.settings(context)
        settings.save(input())
        assertThrows(IllegalArgumentException::class.java){
            settings.save(input("").put("baseUrl","https://different.invalid/v1"))
        }
        assertEquals("https://example.invalid/v1",settings.provider().baseUrl)
        assertEquals("fixture-key",settings.provider().key)
        settings.save(input("replacement").put("baseUrl","https://different.invalid/v1"))
        assertEquals("replacement",settings.provider().key)
    }

    @Test fun unavailableEncryptionDoesNotSaveAPlaintextKeyOrReportConfigurationSuccess(){
        val unavailable=object:com.kalamos.notebook.app.SecretCipher{
            override fun encrypt(plain:ByteArray):Pair<ByteArray,ByteArray>?=null
            override fun decrypt(iv:ByteArray,ct:ByteArray):ByteArray?=null
        }
        val settings=NotesAiSettings(context){com.kalamos.notebook.app.Secrets(context,unavailable)}
        assertThrows(IllegalStateException::class.java){settings.save(input())}
        assertFalse(settings.status().getBoolean("hasKey"))
        assertFalse(context.getSharedPreferences("scribe_secrets",0).all.toString().contains("fixture-key"))
    }

    @Test fun disconnectedPlanNeverUsesTheSavedApiKey() {
        val settings=secure.settings(context)
        settings.save(input())
        context.getSharedPreferences("chatgpt-billing",0).edit().putBoolean("usePlan",true).commit()
        assertEquals("chatgpt",settings.status().getString("billing"))
        assertFalse(settings.status().getBoolean("configured"))
        assertThrows(IllegalStateException::class.java) { settings.provider() }
        com.kalamos.notebook.auth.ChatGptPlan.setEnabled(false)
        assertEquals("fixture-key",settings.provider().key)
    }

}
