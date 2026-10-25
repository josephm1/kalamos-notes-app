package com.kalamos.notebook.auth;
import org.junit.*;
import org.json.*;
import java.security.*;
import java.security.interfaces.RSAPublicKey;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.io.IOException;
import static org.junit.Assert.*;

@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner.class)
@org.robolectric.annotation.Config(sdk = 34, application = android.app.Application.class)
public class OAuthProtocolTest {
    static KeyPair pair; static JSONObject jwks;
    @BeforeClass public static void key() throws Exception {
        KeyPairGenerator gen=KeyPairGenerator.getInstance("RSA");gen.initialize(2048);pair=gen.generateKeyPair();
        RSAPublicKey pub=(RSAPublicKey)pair.getPublic();
        jwks=new JSONObject().put("keys",new JSONArray().put(new JSONObject().put("kty","RSA").put("kid","test").put("alg","RS256").put("n",OAuthProtocol.base64(unsigned(pub.getModulus().toByteArray()))).put("e",OAuthProtocol.base64(unsigned(pub.getPublicExponent().toByteArray())))));
    }
    static byte[] unsigned(byte[] b) { return b[0]==0?Arrays.copyOfRange(b,1,b.length):b; }
    JSONObject identity() throws Exception { return new JSONObject().put("iss",OpenAiHttp.AUTH).put("aud","issued-client").put("sub","learner").put("nonce","test-nonce").put("exp",2000); }
    String signed(JSONObject claims) throws Exception {
        String header=OAuthProtocol.base64("{\"alg\":\"RS256\",\"kid\":\"test\"}".getBytes(StandardCharsets.UTF_8));
        String payload=OAuthProtocol.base64(claims.toString().getBytes(StandardCharsets.UTF_8));
        Signature sig=Signature.getInstance("SHA256withRSA");sig.initSign(pair.getPrivate());sig.update((header+"."+payload).getBytes(StandardCharsets.US_ASCII));
        return header+"."+payload+"."+OAuthProtocol.base64(sig.sign());
    }
    OAuthProtocol.Attempt attempt(String client) { return new OAuthProtocol.Attempt("state","nonce","verifier","http://127.0.0.1:12345/auth/callback",client,"",""); }
    @Test public void rfc7636Pkce() throws Exception { assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",OAuthProtocol.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")); }
    @Test public void distinctCryptographicValues() { assertNotEquals(OAuthProtocol.random(),OAuthProtocol.random());assertEquals(43,OAuthProtocol.random().length()); }
    @Test public void firstRegistrationAsksPlanScope() throws Exception {
        Map<String,String> params=OAuthProtocol.query(new java.net.URI(OAuthProtocol.authorize(attempt("dynamic_agent_client"),"urn:uuid:test",false)).getRawQuery());
        assertEquals("Kalamos Notes",params.get("agent_name_hint"));assertTrue(params.get("scope").contains("chatgpt.tokens.use.direct"));assertEquals("S256",params.get("code_challenge_method"));assertFalse(params.containsKey("prompt"));
    }
    @Test public void returningRegistrationUsesIssuedClient() throws Exception { Map<String,String> p=OAuthProtocol.query(new java.net.URI(OAuthProtocol.authorize(attempt("issued-client"),"urn:uuid:test",true)).getRawQuery());assertEquals("issued-client",p.get("client_id"));assertFalse(p.containsKey("agent_name_hint"));assertEquals("consent",p.get("prompt")); }
    @Test(expected=IOException.class) public void rejectsDuplicateQuery() throws Exception { OAuthProtocol.query("state=one&state=two"); }
    @Test(expected=IOException.class) public void rejectsWrongState() throws Exception { OAuthProtocol.callbackClient(attempt("dynamic_agent_client"),Map.of("state","other","code","code","client_id","issued-client")); }
    @Test(expected=IOException.class) public void rejectsUnissuedClient() throws Exception { OAuthProtocol.callbackClient(attempt("dynamic_agent_client"),Map.of("state","state","code","code")); }
    @Test(expected=IOException.class) public void rejectsSwappedReturningClient() throws Exception { OAuthProtocol.callbackClient(attempt("issued-client"),Map.of("state","state","code","code","client_id","other-client")); }
    @Test(expected=IOException.class) public void consentDenialNeverReturnsClient() throws Exception { OAuthProtocol.callbackClient(attempt("issued-client"),Map.of("state","state","error","access_denied")); }
    @Test public void validatesSignedIdentity() throws Exception { assertEquals("learner",OAuthProtocol.validateId(signed(identity()),jwks,"issued-client","test-nonce","",1000).getString("sub")); }
    @Test(expected=IOException.class) public void rejectsWrongNonce() throws Exception { OAuthProtocol.validateId(signed(identity()),jwks,"issued-client","wrong","",1000); }
    @Test(expected=IOException.class) public void rejectsWrongAudience() throws Exception { OAuthProtocol.validateId(signed(identity()),jwks,"other-client","test-nonce","",1000); }
    @Test(expected=IOException.class) public void rejectsIssuer() throws Exception { OAuthProtocol.validateId(signed(identity().put("iss","https://attacker.example")),jwks,"issued-client","test-nonce","",1000); }
    @Test(expected=IOException.class) public void rejectsExpiredIdentity() throws Exception { OAuthProtocol.validateId(signed(identity()),jwks,"issued-client","test-nonce","",2001); }
    @Test(expected=IOException.class) public void rejectsAccountSwap() throws Exception { OAuthProtocol.validateId(signed(identity()),jwks,"issued-client","test-nonce","someone-else",1000); }
    @Test(expected=IOException.class) public void rejectsTamperedSignature() throws Exception { String jwt=signed(identity());String[] p=jwt.split("\\.");OAuthProtocol.validateId(p[0]+"."+OAuthProtocol.base64(identity().put("sub","attacker").toString().getBytes(StandardCharsets.UTF_8))+"."+p[2],jwks,"issued-client","test-nonce","",1000); }
    @Test public void signedIdentityAloneIsNotPlanPermission() { assertFalse(OAuthProtocol.canUsePlan("openid profile email"));assertTrue(OAuthProtocol.canUsePlan(OAuthProtocol.SCOPES)); }
    @Test public void refreshAtomicallyReplacesBothTokens() throws Exception {
        JSONObject row=new JSONObject().put("access_token","old").put("refresh_token","old-refresh").put("scope",OAuthProtocol.SCOPES);
        ChatGptAccounts.applyTokens(row,new JSONObject().put("access_token","new").put("refresh_token","new-refresh").put("token_type","Bearer").put("expires_in",3600),true);
        assertEquals("new",row.getString("access_token"));assertEquals("new-refresh",row.getString("refresh_token"));assertTrue(OAuthProtocol.canUsePlan(row.getString("scope")));
    }
    @Test(expected=IOException.class) public void incompleteRefreshDoesNotReplaceOldCredentials() throws Exception {
        JSONObject row=new JSONObject().put("access_token","old").put("refresh_token","old-refresh");
        try { ChatGptAccounts.applyTokens(row,new JSONObject().put("access_token","new").put("token_type","Bearer").put("expires_in",3600),true); }
        finally { assertEquals("old",row.getString("access_token"));assertEquals("old-refresh",row.getString("refresh_token")); }
    }
}
