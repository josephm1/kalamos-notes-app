package com.kalamos.notebook.app.net

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Native destination policy for the AI stack (AFK-S2). JS may still name the destination, but
 * the native layer no longer forwards ANY string to OkHttp:
 *
 *  - only http(s)/ws(s) URLs parse; credentials-in-URL and fragments are rejected;
 *  - HTTPS/WSS is allowed anywhere; cleartext HTTP/WS is allowed ONLY to private destinations
 *    (RFC1918, loopback, .local, Tailscale CGNAT/MagicDNS) — a compromised WebView cannot
 *    exfiltrate over cleartext to the public internet, and existing LAN setups keep working;
 *  - callers cannot supply Host/Cookie headers (native code owns those);
 *  - redirects are disabled in [HttpStreamer] (no cross-host redirect, no HTTPS→HTTP downgrade;
 *    a 3xx surfaces as a visible failure instead);
 *  - [redact] scrubs URLs-with-queries, bearer/key material, and secret placeholders out of any
 *    text that could reach logs or JS error events.
 *
 * Pure Kotlin/JVM (okhttp only) so all of it is unit-testable off-device.
 */
object UrlPolicy {
    data class Verdict(val ok: Boolean, val reason: String? = null)

    /** Headers a JS caller may never supply — the native layer owns them. */
    val forbiddenHeaders = setOf("host", "cookie")

    fun isPrivateHost(host: String): Boolean {
        val h = host.lowercase()
        if (h == "localhost" || h.endsWith(".local") || h.endsWith(".ts.net")) return true
        val m = Regex("""^(\d+)\.(\d+)\.(\d+)\.(\d+)$""").find(h) ?: return false
        val (a, b) = Pair(m.groupValues[1].toInt(), m.groupValues[2].toInt())
        return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b in 16..31) ||
               (a == 100 && b in 64..127)   // Tailscale CGNAT range
    }

    /** Validate an http(s) destination string from JS. */
    fun checkHttp(raw: String?): Verdict {
        val s = (raw ?: "").trim()
        if (s.contains("#")) return Verdict(false, "fragment-not-allowed")
        val url: HttpUrl = s.toHttpUrlOrNull() ?: return Verdict(false, "unsupported-url")
        if (url.username.isNotEmpty() || url.password.isNotEmpty())
            return Verdict(false, "credentials-in-url")
        if (url.scheme == "http" && !isPrivateHost(url.host))
            return Verdict(false, "cleartext-to-public-host")
        return Verdict(true)
    }

    /** Validate a ws(s) destination string from JS (same rules; ws maps to http). */
    fun checkWs(raw: String?): Verdict {
        val s = (raw ?: "").trim()
        val mapped = when {
            s.startsWith("ws://", ignoreCase = true) -> "http://" + s.substring(5)
            s.startsWith("wss://", ignoreCase = true) -> "https://" + s.substring(6)
            else -> return Verdict(false, "unsupported-url")
        }
        return checkHttp(mapped)
    }

    /**
     * Scrub secret-bearing material from text headed for logs or JS error events:
     * query strings, Authorization/Bearer values, api-key-shaped tokens, secret placeholders.
     */
    fun redact(text: String?): String {
        var s = text ?: return ""
        s = s.replace(Regex("""\{\{secret:[^}]*\}\}"""), "{{secret:…}}")
        s = s.replace(Regex("""(?i)(bearer\s+)[A-Za-z0-9._~+/=\-]{8,}"""), "$1…")
        s = s.replace(Regex("""(?i)(authorization[=:]\s*)\S+"""), "$1…")
        s = s.replace(Regex("""(sk-[A-Za-z0-9]{4})[A-Za-z0-9_\-]{8,}"""), "$1…")
        s = s.replace(Regex("""(https?://[^\s?#"']+)\?[^\s"']*"""), "$1?…")
        return s
    }
}
