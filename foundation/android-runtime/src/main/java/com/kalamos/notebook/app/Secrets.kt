package com.kalamos.notebook.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import com.kalamos.foundation.documents.KalamosAiConfig
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * API keys / tokens, app-private and (since AFK-S2) encrypted at rest. JS refers to secrets only
 * by name via a "{{secret:NAME}}" placeholder that [com.kalamos.notebook.app.net.HttpStreamer]/
 * [com.kalamos.notebook.app.net.WsClient] substitute natively — key material never crosses into
 * the WebView, providers.json, or any saved document.
 *
 * Storage: values live in the same "scribe_secrets" SharedPreferences file as before (so
 * existing installs migrate in place) but each value is now AES-GCM ciphertext under a
 * non-exportable Android Keystore key ([SecretStore] format). Legacy plaintext entries are
 * migrated on first construction. The prefs file must stay excluded from Android backup —
 * see res/xml/data_extraction_rules.xml + backup_rules.xml in each app.
 */
class Secrets(context: Context, cipher: SecretCipher = KeystoreCipher()) {
    private val prefs = context.getSharedPreferences("scribe_secrets", Context.MODE_PRIVATE)

    private val store = SecretStore(object : SecretKv {
        override fun get(key: String): String? = prefs.getString(key, null)
        override fun put(key: String, value: String) { check(prefs.edit().putString(key, value).commit()) { "Could not save secure storage" } }
        override fun remove(key: String) { check(prefs.edit().remove(key).commit()) { "Could not clear secure storage" } }
        override fun keys(): Set<String> = prefs.all.keys
    }, cipher)

    init {
        val n = store.migrateAll()
        if (n > 0) Log.i("Secrets", "migrated $n legacy secret(s) to encrypted storage")
    }

    fun set(key: String, value: String) = store.set(key, value)
    fun has(key: String): Boolean = store.has(key)
    fun clear(key: String) = store.clear(key)
    /** Status/age only — never the value. */
    fun meta(key: String) = store.meta(key)

    // Braces and the hyphen are escaped so Android's (ICU-backed) regex engine accepts it.
    private val placeholder = Regex("""\{\{secret:([A-Za-z0-9_.\-]+)\}\}""")

    /** Replace {{secret:NAME}} placeholders; returns null if a referenced secret is missing. */
    fun substitute(value: String): String? {
        var missing = false
        val out = placeholder.replace(value) { m ->
            val key = m.groupValues[1]
            val resolved = when (key) {
                KalamosAiConfig.SECRET_REF -> KalamosAiConfig.active()?.apiKey
                KalamosAiConfig.IMAGE_SECRET_REF -> KalamosAiConfig.imageKey()
                else -> store.value(key)
            }
            resolved ?: run { missing = true; "" }
        }
        return if (missing) null else out
    }
}

/**
 * AES-GCM via a non-exportable Android Keystore key. No StrongBox requirement — the Bigme
 * firmware may not expose it; the default hardware-backed (or TEE/software) Keystore is used.
 * Cipher failures return null: writes fail closed and reads treat the entry as missing.
 * A missing key is created only for encryption, never as a side effect of reading ciphertext.
 */
private class KeystoreCipher : SecretCipher {
    companion object {
        private const val ALIAS = "kalamos_secret_store_v1"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private val KEY_LOCK = Any()
    }

    private fun key(create: Boolean): SecretKey? = synchronized(KEY_LOCK) { try {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey) ?: if (!create) null else run {
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            gen.init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            )
            gen.generateKey()
        }
    } catch (e: Exception) {
        Log.w("Secrets", "Keystore unavailable: ${e.javaClass.simpleName}")
        null
    } }

    override fun encrypt(plain: ByteArray): Pair<ByteArray, ByteArray>? {
        return try {
            val k = key(create = true) ?: return null
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.ENCRYPT_MODE, k)
            Pair(c.iv, c.doFinal(plain))
        } catch (e: Exception) { null }
    }

    override fun decrypt(iv: ByteArray, ct: ByteArray): ByteArray? {
        return try {
            val k = key(create = false) ?: return null
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, iv))
            c.doFinal(ct)
        } catch (e: Exception) { null }   // AEADBadTagException = tampered → treated as missing
    }
}
