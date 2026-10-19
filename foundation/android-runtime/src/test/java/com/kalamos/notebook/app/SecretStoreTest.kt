package com.kalamos.notebook.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/** AFK-S2: SecretStore format, migration, tamper and fallback behavior (JVM, fake cipher). */
class SecretStoreTest {

    private class MemKv : SecretKv {
        val map = LinkedHashMap<String, String>()
        override fun get(key: String) = map[key]
        override fun put(key: String, value: String) { map[key] = value }
        override fun remove(key: String) { map.remove(key) }
        override fun keys(): Set<String> = map.keys.toSet()
    }

    /** Real AES-GCM, ordinary JVM key — same math as the Keystore cipher without Android. */
    private class JvmCipher : SecretCipher {
        private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        var available = true
        override fun encrypt(plain: ByteArray): Pair<ByteArray, ByteArray>? {
            if (!available) return null
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key)
            return Pair(c.iv, c.doFinal(plain))
        }
        override fun decrypt(iv: ByteArray, ct: ByteArray): ByteArray? = try {
            if (!available) null else {
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
                c.doFinal(ct)
            }
        } catch (e: Exception) { null }
    }

    @Test fun setStoresCiphertextNotPlaintext() {
        val kv = MemKv()
        val store = SecretStore(kv, JvmCipher())
        store.set("api_key", "sk-supersecret-12345678")
        val stored = kv.map["api_key"]!!
        assertTrue(stored.startsWith(SecretStore.PREFIX))
        assertFalse(stored.contains("supersecret"))
        assertEquals("sk-supersecret-12345678", store.value("api_key"))
        assertTrue(store.has("api_key"))
    }

    @Test fun migratesLegacyPlaintextInPlace() {
        val kv = MemKv()
        kv.map["old_key"] = "plain-legacy-token"
        kv.map["other"] = "second-legacy"
        val store = SecretStore(kv, JvmCipher())
        assertEquals(2, store.migrateAll())
        assertTrue(kv.map["old_key"]!!.startsWith(SecretStore.PREFIX))
        assertFalse(kv.map["old_key"]!!.contains("legacy"))
        assertEquals("plain-legacy-token", store.value("old_key"))
        assertEquals("second-legacy", store.value("other"))
        // idempotent
        assertEquals(0, store.migrateAll())
    }

    @Test fun interruptedMigrationRetriesNextRun() {
        // cipher unavailable on the "first run" → entries stay plaintext AND stay readable;
        // the "next run" with a working cipher completes the migration.
        val kv = MemKv()
        kv.map["k"] = "legacy-value"
        val cipher = JvmCipher()
        cipher.available = false
        val store = SecretStore(kv, cipher)
        assertEquals(0, store.migrateAll())
        assertEquals("legacy-value", store.value("k"))     // still usable pre-migration
        cipher.available = true
        assertEquals(1, store.migrateAll())
        assertTrue(kv.map["k"]!!.startsWith(SecretStore.PREFIX))
        assertEquals("legacy-value", store.value("k"))
    }

    @Test fun tamperedCiphertextReadsAsMissing() {
        val kv = MemKv()
        val store = SecretStore(kv, JvmCipher())
        store.set("k", "value-1")
        val blob = kv.map["k"]!!
        // flip a character inside the ciphertext part
        kv.map["k"] = blob.dropLast(4) + (if (blob.endsWith("AAAA")) "BBBB" else "AAAA")
        assertNull(store.value("k"))
        assertFalse(store.has("k"))
    }

    @Test fun missingKeystoreEntryReadsAsMissing() {
        // decrypting with a DIFFERENT key (e.g. Keystore wiped by a factory reset) → missing
        val kv = MemKv()
        SecretStore(kv, JvmCipher()).set("k", "value-1")
        val storeWithNewKey = SecretStore(kv, JvmCipher())
        assertNull(storeWithNewKey.value("k"))
        assertFalse(storeWithNewKey.has("k"))
    }

    @Test fun cipherUnavailableFallsBackWithoutLoss() {
        val kv = MemKv()
        val cipher = JvmCipher()
        cipher.available = false
        val store = SecretStore(kv, cipher)
        store.set("k", "fallback-value")            // stored legacy-format, still functional
        assertEquals("fallback-value", store.value("k"))
        cipher.available = true
        store.migrateAll()                          // later run upgrades it
        assertTrue(kv.map["k"]!!.startsWith(SecretStore.PREFIX))
        assertEquals("fallback-value", store.value("k"))
    }

    @Test fun clearRemovesValueAndMeta() {
        val kv = MemKv()
        val store = SecretStore(kv, JvmCipher())
        store.set("k", "v")
        assertTrue(kv.map.containsKey("k${SecretStore.META_SUFFIX}"))
        store.clear("k")
        assertFalse(kv.map.containsKey("k"))
        assertFalse(kv.map.containsKey("k${SecretStore.META_SUFFIX}"))
        assertFalse(store.has("k"))
    }

    @Test fun metaExposesAgeNeverValue() {
        val kv = MemKv()
        val store = SecretStore(kv, JvmCipher())
        store.set("k", "hunter2-secret")
        val meta = store.meta("k")
        assertTrue(meta.getBoolean("exists"))
        assertTrue(meta.getLong("createdAt") > 0)
        assertFalse(meta.toString().contains("hunter2"))
        store.set("k", "rotated-secret")
        assertTrue(store.meta("k").has("rotatedAt"))
    }

    @Test fun metaEntriesAreNotSecrets() {
        val kv = MemKv()
        val store = SecretStore(kv, JvmCipher())
        store.set("k", "v")
        assertNull(store.value("k${SecretStore.META_SUFFIX}"))
        assertEquals(0, store.migrateAll())   // meta entries never treated as legacy plaintext
    }
}
