// Adapted from josephm1/LearnHarness-Mobile Android account connection code.
package com.kalamos.notebook.auth;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Small HTTPS transport. Credentials are headers/form fields, never URLs or diagnostics. */
public class OpenAiHttp {
    public static final String AUTH = "https://auth.openai.com";
    public static final String API = "https://api.openai.com/v1";
    public static final String USAGE = "https://chatgpt.com/settings/usage";
    private volatile HttpURLConnection active;
    public void cancel() { HttpURLConnection connection = active; if (connection != null) connection.disconnect(); }
    public JSONObject get(String url, String token) throws Exception { return request(url, "GET", "", "", token); }
    public JSONObject form(String url, Map<String,String> values) throws Exception {
        return request(url, "POST", "application/x-www-form-urlencoded", OAuthProtocol.encode(values), "");
    }
    public JSONObject request(String url, String method, String mime, String body, String token) throws Exception {
        HttpURLConnection connection = connect(url, method, mime, body, token);
        try {
            check(connection);
            try (InputStream in = connection.getInputStream()) {
                byte[] bytes = readBounded(in, 2_000_000);
                return bytes.length == 0 ? new JSONObject() : new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); if (active == connection) active = null; }
    }
    public static byte[] readBounded(InputStream input,int limit)throws IOException {
        ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
        while((n=input.read(buffer))!=-1){if(output.size()+n>limit)throw new IOException("OpenAI response was too large.");output.write(buffer,0,n);}return output.toByteArray();
    }
    private HttpURLConnection connect(String url, String method, String mime, String body, String token) throws Exception {
        URI uri = new URI(url);
        if (!"https".equals(uri.getScheme()) || !("auth.openai.com".equals(uri.getHost()) || "api.openai.com".equals(uri.getHost())) || uri.getUserInfo()!=null || uri.getFragment()!=null || uri.getQuery()!=null || (uri.getPort()!=-1 && uri.getPort()!=443))
            throw new IOException("Refusing an unexpected OpenAI endpoint.");
        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection(); active = connection;
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(180000); connection.setRequestMethod(method);
            if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (!mime.isEmpty()) connection.setRequestProperty("Content-Type", mime);
            connection.setRequestProperty("Accept", url.endsWith("/responses") ? "text/event-stream" : "application/json");
            if (method.equals("POST")) {
                connection.setDoOutput(true);
                try (OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
            }
            return connection;
        } catch (Exception e) { connection.disconnect(); if (active == connection) active=null; throw e; }
    }
    private void check(HttpURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        if (status >= 200 && status < 300) return;
        String code = "", param = "", shape = "empty";
        try (InputStream in = connection.getErrorStream()) {
            if (in != null) {
                JSONObject body = new JSONObject(new String(readBounded(in, 32000), StandardCharsets.UTF_8));
                JSONObject error = body.optJSONObject("error");
                if (error != null) { shape="error object"; code=error.optString("code"); param=error.optString("param"); }
                else if (body.opt("error") instanceof String) { shape="OAuth error"; code=body.optString("error"); }
                else shape=body.has("detail") ? "detail" : "JSON object";
            }
        } catch (Exception ignored) { shape="unstructured"; }
        throw new Failure(status, code, param, connection.getHeaderField("x-request-id"), shape);
    }
    public static final class Failure extends IOException {
        public final int status; public final String code, param, requestId, shape;
        public Failure(int status, String code, String param, String requestId, String shape) {
            super(message(status, code)); this.status=status; this.code=safe(code); this.param=safe(param); this.requestId=safe(requestId); this.shape=shape;
        }
        private static String safe(String value) { return value != null && value.matches("[a-zA-Z0-9_.:/-]{1,160}") ? value : ""; }
        private static String message(int status, String code) {
            if ("subscription_sharing_usage_limit_exceeded".equals(code) || status==429) return "ChatGPT plan or app usage limit reached. Review your limits in Manage usage. No API-key fallback was used.";
            if ("subscription_sharing_user_not_eligible".equals(code)) return "ChatGPT plan usage is unavailable for this account, workspace, or policy. You can choose another account or explicitly select your API provider.";
            if ("subscription_sharing_unsupported_capability".equals(code)) return "This model or request capability is not supported by ChatGPT plan usage.";
            if ("invalid_grant".equals(code) || code != null && code.contains("refresh_token")) return "ChatGPT sign-in has expired or was revoked. Continue with the saved account to sign in again.";
            if (status==401) return "ChatGPT authentication was not accepted. Check the selected account and sign in again if access was revoked.";
            if (status==403) return "ChatGPT plan access was not permitted. Check your account, permissions, and region. No other billing path was used.";
            if (status==503) return "ChatGPT plan usage is temporarily unavailable or not enabled for this account. Your sign-in has been kept. Try again later.";
            return "OpenAI returned HTTP " + status + ". Check your ChatGPT connection and try again.";
        }
        public String diagnostic() { return getMessage()+"\n\nHTTP "+status+(code.isEmpty()?"":"\nCode: "+code)+(param.isEmpty()?"":"\nParameter: "+param)+(requestId.isEmpty()?"":"\nRequest ID: "+requestId)+"\nResponse shape: "+shape; }
        public boolean terminalRefresh() { return java.util.Arrays.asList("invalid_grant","invalid_refresh_token","token_expired","refresh_token_expired","refresh_token_invalidated","refresh_token_reused").contains(code); }
    }
}
