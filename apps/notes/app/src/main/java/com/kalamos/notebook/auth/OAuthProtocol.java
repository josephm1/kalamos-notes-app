// Adapted from josephm1/LearnHarness-Mobile Android account connection code.
package com.kalamos.notebook.auth;

import org.json.*;
import java.io.IOException;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.RSAPublicKeySpec;
import java.math.BigInteger;
import java.util.*;

/** OAuth/OIDC validation has no Android dependencies so adversarial cases run on the JVM. */
public final class OAuthProtocol {
    public static final String SCOPES="openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    public static final class Attempt {
        private final String state,nonce,verifier,redirect,clientId,subject,email;
        public Attempt(String state,String nonce,String verifier,String redirect,String clientId,String subject,String email){this.state=state;this.nonce=nonce;this.verifier=verifier;this.redirect=redirect;this.clientId=clientId;this.subject=subject;this.email=email;}
        public String state(){return state;}public String nonce(){return nonce;}public String verifier(){return verifier;}public String redirect(){return redirect;}public String clientId(){return clientId;}public String subject(){return subject;}public String email(){return email;}
    }
    private OAuthProtocol() {}
    public static String random() { byte[] bytes=new byte[32]; new SecureRandom().nextBytes(bytes); return base64(bytes); }
    public static String base64(byte[] bytes) { return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    public static String challenge(String verifier) throws Exception { return base64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))); }
    public static String encode(Map<String,String> params) throws Exception {
        StringBuilder body=new StringBuilder();
        for(var item:params.entrySet()) { if(body.length()>0)body.append('&'); body.append(URLEncoder.encode(item.getKey(),"UTF-8")).append('=').append(URLEncoder.encode(item.getValue(),"UTF-8")); }
        return body.toString();
    }
    public static String authorize(Attempt attempt,String host,boolean consent) throws Exception {
        LinkedHashMap<String,String> values=new LinkedHashMap<>();
        values.put("client_id",attempt.clientId()); values.put("ext_agent_host_id",host);
        if(attempt.clientId().equals("dynamic_agent_client"))values.put("agent_name_hint","Kalamos Notes");
        if(!attempt.email().isEmpty())values.put("login_hint",attempt.email());
        values.put("response_type","code"); values.put("redirect_uri",attempt.redirect()); values.put("scope",SCOPES);
        values.put("resource",OpenAiHttp.API); values.put("state",attempt.state()); values.put("nonce",attempt.nonce());
        values.put("code_challenge_method","S256"); values.put("code_challenge",challenge(attempt.verifier()));
        if(consent)values.put("prompt","consent");
        // Avoid ID tokens in Android browser intents and OS intent diagnostics; login_hint suffices.
        return OpenAiHttp.AUTH+"/api/accounts/authorize?"+encode(values);
    }
    public static Map<String,String> query(String raw) throws Exception {
        Map<String,String> result=new HashMap<>();
        for(String part:(raw==null?"":raw).split("&")) {
            if(part.isEmpty())continue; String[] pair=part.split("=",2);
            String key=URLDecoder.decode(pair[0],"UTF-8"),value=pair.length==2?URLDecoder.decode(pair[1],"UTF-8"):"";
            if(result.put(key,value)!=null)throw new IOException("Duplicate OAuth callback parameter.");
        }
        return result;
    }
    public static String callbackClient(Attempt pending,Map<String,String> query) throws Exception {
        if(!equal(pending.state(),query.get("state")))throw new IOException("Sign-in callback did not match this attempt.");
        if(query.containsKey("error"))throw new IOException("ChatGPT sign-in was declined or cancelled. You can continue with another provider or try sign-in again.");
        if(query.getOrDefault("code","").isEmpty())throw new IOException("Sign-in callback was missing its code.");
        String client=query.getOrDefault("client_id",pending.clientId());
        if(pending.clientId().equals("dynamic_agent_client")) {
            if(client.equals("dynamic_agent_client") || !client.matches("[A-Za-z0-9_-]{3,200}"))throw new IOException("ChatGPT did not return a registered client ID.");
        } else if(!client.equals(pending.clientId()))throw new IOException("ChatGPT returned a different account registration.");
        return client;
    }
    public static boolean equal(String a,String b) { return a!=null && b!=null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8)); }
    public static boolean canUsePlan(String scopes) { return Arrays.asList(scopes.split("\\s+")).contains("chatgpt.tokens.use.direct"); }
    public static JSONObject validateId(String jwt,JSONObject jwks,String client,String nonce,String subject,long now) throws Exception {
        String[] parts=jwt.split("\\.",-1);
        if(parts.length!=3)throw new IOException("Invalid ChatGPT identity token.");
        JSONObject header=new JSONObject(new String(Base64.getUrlDecoder().decode(parts[0]),StandardCharsets.UTF_8));
        if(!"RS256".equals(header.optString("alg")) || header.has("crit"))throw new IOException("Unsupported identity signature.");
        String kid=header.getString("kid"); JSONObject key=null; JSONArray keys=jwks.getJSONArray("keys");
        for(int i=0;i<keys.length();i++) { JSONObject candidate=keys.getJSONObject(i); if(kid.equals(candidate.optString("kid"))) { if(key!=null)throw new IOException("Ambiguous identity signing key."); key=candidate; } }
        if(key==null || !"RSA".equals(key.optString("kty")) || !"RS256".equals(key.optString("alg","RS256")) || !"sig".equals(key.optString("use","sig")))throw new IOException("ChatGPT identity signing key was not found.");
        BigInteger modulus=new BigInteger(1,Base64.getUrlDecoder().decode(key.getString("n")));
        if(modulus.bitLength()<2048)throw new IOException("Identity signing key was too small.");
        PublicKey publicKey=KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(modulus,new BigInteger(1,Base64.getUrlDecoder().decode(key.getString("e")))));
        Signature signature=Signature.getInstance("SHA256withRSA"); signature.initVerify(publicKey); signature.update((parts[0]+"."+parts[1]).getBytes(StandardCharsets.US_ASCII));
        if(!signature.verify(Base64.getUrlDecoder().decode(parts[2])))throw new IOException("ChatGPT identity signature did not validate.");
        JSONObject claims=new JSONObject(new String(Base64.getUrlDecoder().decode(parts[1]),StandardCharsets.UTF_8));
        Object audience=claims.opt("aud"); boolean matches=client.equals(audience);
        if(audience instanceof JSONArray) { JSONArray audiences=(JSONArray)audience; for(int i=0;i<audiences.length();i++)if(client.equals(audiences.optString(i)))matches=true; if(audiences.length()>1 && !client.equals(claims.optString("azp")))matches=false; }
        if(!OpenAiHttp.AUTH.equals(claims.optString("iss")) || !matches || claims.optLong("exp",0)<=now || claims.optLong("nbf",0)>now+30 || (nonce!=null && !equal(nonce,claims.optString("nonce"))) || claims.optString("sub").isEmpty())throw new IOException("ChatGPT identity, expiry, or nonce did not validate.");
        if(!subject.isEmpty() && !equal(subject,claims.getString("sub")))throw new IOException("Sign-in returned a different account. Use Add another account instead.");
        return claims;
    }
}
