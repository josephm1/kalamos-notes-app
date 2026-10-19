package com.kalamos.notebook.app

import org.json.JSONObject
import java.util.Base64

/**
 * Encrypted-at-rest secret storage (AFK-S2). [Secrets] wires this to SharedPreferences and an
 * Android Keystore AES-GCM cipher; the store itself is pure Kotlin/JVM so the value format and
 * the legacy migration are unit-testable without a device.
 *
 * Value format v1:  "kse1:" + base64(iv) + ":" + base64(ciphertext)
 * Metadata entry:   "<key>#meta" = {"createdAt":ms, "rotatedAt":ms}  — status/age only, NEVER
 * the value; nothing here ever returns a secret to a caller other than [value] (used by the
 * native substitution path).
 *
 * Migration: a stored entry WITHOUT the "kse1:" prefix is a legacy plaintext secret. Each is
 * migrated independently: encrypt → verify decrypt round-trip → replace in one put. An
 * interrupted migration therefore leaves any given entry either fully plaintext (picked up on
 * the next run) or fully encrypted — never a broken half. Migration is idempotent.
 *
 * Cipher unavailability (firmware without a working Keystore): set() falls back to the legacy
 * plaintext format rather than losing functionality — the same trade the pre-AFK-S2 code made
 * unconditionally — and a later run with a working cipher migrates it. Tampered or undecryptable
 * ciphertext is treated as MISSING (the user re-enters the key), never surfaced as bytes.
 */
interface SecretCipher {
    /** Returns (iv, ciphertext), or null when encryption is unavailable. */
    fun encrypt(plain: ByteArray): Pair<ByteArray, ByteArray>?
    /** Returns plaintext, or null when the blob cannot be decrypted (tampered / key gone). */
    fun decrypt(iv: ByteArray, ct: ByteArray): ByteArray?
}

interface SecretKv {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
    fun keys(): Set<String>
}

class SecretStore(private val kv: SecretKv, private val cipher: SecretCipher) {
    companion object {
        const val PREFIX = "kse1:"
        const val META_SUFFIX = "#meta"
        private val B64E = Base64.getEncoder()
        private val B64D = Base64.getDecoder()
    }

    private fun isMeta(key: String) = key.endsWith(META_SUFFIX)

    private fun encode(plain: String): String? {
        val pair = cipher.encrypt(plain.toByteArray(Charsets.UTF_8)) ?: return null
        return PREFIX + B64E.encodeToString(pair.first) + ":" + B64E.encodeToString(pair.second)
    }

    private fun decode(stored: String): String? {
        if (!stored.startsWith(PREFIX)) return stored   // legacy plaintext (pre-migration)
        val parts = stored.substring(PREFIX.length).split(":")
        if (parts.size != 2) return null
        val plain = try {
            cipher.decrypt(B64D.decode(parts[0]), B64D.decode(parts[1]))
        } catch (e: IllegalArgumentException) { null }   // corrupt base64 = tampered
        return plain?.toString(Charsets.UTF_8)
    }

    private fun touchMeta(key: String) {
        val metaKey = key + META_SUFFIX
        val now = System.currentTimeMillis()
        val meta = try { JSONObject(kv.get(metaKey) ?: "{}") } catch (e: Exception) { JSONObject() }
        if (!meta.has("createdAt")) meta.put("createdAt", now) else meta.put("rotatedAt", now)
        kv.put(metaKey, meta.toString())
    }

    fun set(key: String, value: String) {
        kv.put(key, encode(value) ?: value)   // cipher unavailable → legacy-format fallback
        touchMeta(key)
    }

    /** The secret value — for the native substitution path ONLY. Null = missing/undecryptable. */
    fun value(key: String): String? {
        if (isMeta(key)) return null
        val stored = kv.get(key) ?: return null
        val plain = decode(stored)
        return if (plain.isNullOrEmpty()) null else plain
    }

    fun has(key: String): Boolean = value(key) != null

    fun clear(key: String) {
        kv.remove(key)
        kv.remove(key + META_SUFFIX)
    }

    /** Status/age metadata — never the value. */
    fun meta(key: String): JSONObject {
        val out = JSONObject().put("exists", has(key))
        val meta = try { JSONObject(kv.get(key + META_SUFFIX) ?: "{}") } catch (e: Exception) { JSONObject() }
        if (meta.has("createdAt")) out.put("createdAt", meta.getLong("createdAt"))
        if (meta.has("rotatedAt")) out.put("rotatedAt", meta.getLong("rotatedAt"))
        return out
    }

    /**
     * Encrypt every legacy plaintext entry in place. Returns the number migrated. Safe to call
     * on every startup: encrypted entries are skipped; a failed/unavailable cipher leaves the
     * entry untouched for the next attempt.
     */
    fun migrateAll(): Int {
        var migrated = 0
        for (key in kv.keys().toList()) {
            if (isMeta(key)) continue
            val stored = kv.get(key) ?: continue
            if (stored.startsWith(PREFIX)) continue
            val enc = encode(stored) ?: continue          // cipher unavailable → retry next run
            if (decode(enc) != stored) continue           // verify round-trip BEFORE replacing
            kv.put(key, enc)
            if (kv.get(key + META_SUFFIX) == null) touchMeta(key)
            migrated++
        }
        return migrated
    }
}
