package com.kalamos.notebook.ai

import android.content.Context
import com.kalamos.notebook.app.SecretCipher
import com.kalamos.notebook.app.Secrets
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

internal class NotesAiTestSecrets {
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val cipher = object : SecretCipher {
        override fun encrypt(plain: ByteArray): Pair<ByteArray, ByteArray> {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key)
            return c.iv to c.doFinal(plain)
        }
        override fun decrypt(iv: ByteArray, ct: ByteArray): ByteArray? = try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
            c.doFinal(ct)
        } catch (_: Exception) { null }
    }
    fun settings(context: Context) = NotesAiSettings(context) { Secrets(context, cipher) }
}
