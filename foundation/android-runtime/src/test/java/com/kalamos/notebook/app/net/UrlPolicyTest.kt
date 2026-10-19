package com.kalamos.notebook.app.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** AFK-S2: native destination policy + redaction (JVM). */
class UrlPolicyTest {

    // ---- forbidden URLs ----
    @Test fun rejectsNonHttpSchemes() {
        assertFalse(UrlPolicy.checkHttp("file:///etc/passwd").ok)
        assertFalse(UrlPolicy.checkHttp("ftp://host/x").ok)
        assertFalse(UrlPolicy.checkHttp("content://media/external").ok)
        assertFalse(UrlPolicy.checkHttp("javascript:alert(1)").ok)
        assertFalse(UrlPolicy.checkHttp("").ok)
        assertFalse(UrlPolicy.checkHttp(null).ok)
        assertFalse(UrlPolicy.checkHttp("not a url").ok)
    }

    @Test fun rejectsCredentialsInUrl() {
        val v = UrlPolicy.checkHttp("https://user:pass@api.example.com/v1")
        assertFalse(v.ok)
        assertEquals("credentials-in-url", v.reason)
    }

    @Test fun rejectsFragments() {
        val v = UrlPolicy.checkHttp("https://api.example.com/v1#frag")
        assertFalse(v.ok)
        assertEquals("fragment-not-allowed", v.reason)
    }

    // ---- cleartext policy ----
    @Test fun cleartextToPublicHostRejected() {
        val v = UrlPolicy.checkHttp("http://api.example.com/v1")
        assertFalse(v.ok)
        assertEquals("cleartext-to-public-host", v.reason)
        assertFalse(UrlPolicy.checkHttp("http://8.8.8.8/x").ok)
    }

    @Test fun cleartextToPrivateHostsAllowed() {
        assertTrue(UrlPolicy.checkHttp("http://192.168.1.20:8642/v1/models").ok)
        assertTrue(UrlPolicy.checkHttp("http://10.1.2.3:8080/v1").ok)
        assertTrue(UrlPolicy.checkHttp("http://172.20.0.1:8080").ok)
        assertTrue(UrlPolicy.checkHttp("http://127.0.0.1:9999").ok)
        assertTrue(UrlPolicy.checkHttp("http://localhost:8642").ok)
        assertTrue(UrlPolicy.checkHttp("http://desktop.local:8642").ok)
        assertTrue(UrlPolicy.checkHttp("http://100.101.5.9:8642").ok)     // tailscale CGNAT
        assertTrue(UrlPolicy.checkHttp("http://desk.tail99.ts.net").ok)   // MagicDNS
    }

    @Test fun httpsAllowedAnywhere() {
        assertTrue(UrlPolicy.checkHttp("https://api.openai.com/v1/chat/completions").ok)
        assertTrue(UrlPolicy.checkHttp("https://desk.tail99.ts.net/v1/responses").ok)
        assertTrue(UrlPolicy.checkHttp("https://192.168.1.20:8443").ok)
    }

    @Test fun nearMissPrivateRangesArePublic() {
        assertFalse(UrlPolicy.checkHttp("http://172.32.0.1/x").ok)   // one past 172.31
        assertFalse(UrlPolicy.checkHttp("http://100.128.0.1/x").ok)  // one past CGNAT
        assertFalse(UrlPolicy.checkHttp("http://192.169.0.1/x").ok)
        assertFalse(UrlPolicy.checkHttp("http://11.0.0.1/x").ok)
    }

    // ---- websocket mapping ----
    @Test fun wsFollowsSameRules() {
        assertTrue(UrlPolicy.checkWs("ws://192.168.1.20:8377").ok)     // gateway on the LAN
        assertTrue(UrlPolicy.checkWs("wss://desk.tail99.ts.net").ok)
        assertFalse(UrlPolicy.checkWs("ws://evil.example.com").ok)     // cleartext ws to public
        assertFalse(UrlPolicy.checkWs("wss://user:pw@host/x").ok)
        assertFalse(UrlPolicy.checkWs("https://not-a-ws.example.com").ok)
    }

    // ---- header policy ----
    @Test fun forbiddenHeadersAreDeclared() {
        assertTrue("host" in UrlPolicy.forbiddenHeaders)
        assertTrue("cookie" in UrlPolicy.forbiddenHeaders)
    }

    // ---- redaction (secret-free exceptions / logs) ----
    @Test fun redactsBearerTokens() {
        val r = UrlPolicy.redact("401 from server, sent Bearer sk-abc123def456ghi789 in header")
        assertFalse(r.contains("sk-abc123def456ghi789"))
        assertTrue(r.contains("Bearer"))
    }

    @Test fun redactsSecretPlaceholders() {
        val r = UrlPolicy.redact("failed substituting {{secret:hermes_mr123_key}}")
        assertFalse(r.contains("hermes_mr123_key"))
    }

    @Test fun redactsApiKeyShapes() {
        val r = UrlPolicy.redact("request with key sk-proj1234567890abcdef failed")
        assertFalse(r.contains("sk-proj1234567890abcdef"))
    }

    @Test fun redactsQueryStrings() {
        val r = UrlPolicy.redact("GET https://api.example.com/v1/runs?api_key=sekret123&x=1 failed")
        assertFalse(r.contains("sekret123"))
        assertTrue(r.contains("https://api.example.com/v1/runs?…"))
    }

    @Test fun redactsAuthorizationHeaderDumps() {
        val r = UrlPolicy.redact("headers: authorization: TokenValue123456")
        assertFalse(r.contains("TokenValue123456"))
    }

    @Test fun plainMessagesPassThrough() {
        assertEquals("Connection refused", UrlPolicy.redact("Connection refused"))
        assertEquals("", UrlPolicy.redact(null))
    }
}
