// Adapted from josephm1/LearnHarness-Mobile Android account connection code.
package com.kalamos.notebook.auth;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.*;
import java.time.Instant;

/** Bounded allowlisted history: never tokens, codes, URLs, account IDs, email, or raw error bodies. */
public final class AuthDiagnostics {
    private final SharedPreferences preferences;
    public AuthDiagnostics(Context context) { preferences=context.getSharedPreferences("chatgpt-diagnostics",Context.MODE_PRIVATE); }
    public synchronized void event(String stage,Exception failure) {
        try {
            JSONArray rows=new JSONArray(preferences.getString("events","[]"));
            JSONObject row=new JSONObject().put("time",Instant.now().toString()).put("stage",stage);
            if(failure!=null) {
                row.put("exception",failure.getClass().getSimpleName());
                if(failure instanceof OpenAiHttp.Failure) {
                    OpenAiHttp.Failure f=(OpenAiHttp.Failure)failure;
                    row.put("http",f.status).put("code",f.code).put("param",f.param).put("request_id",f.requestId).put("shape",f.shape);
                }
            }
            rows.put(row);while(rows.length()>24)rows.remove(0);
            preferences.edit().putString("events",rows.toString()).commit();
            android.util.Log.i("ChatGptAuth",row.toString());
        } catch(Exception ignored) { /* Diagnostics must never affect authentication. */ }
    }
    public String summary() {
        try {
            JSONArray rows=new JSONArray(preferences.getString("events","[]"));StringBuilder result=new StringBuilder();
            for(int i=0;i<rows.length();i++) { JSONObject row=rows.getJSONObject(i);result.append(row.getString("time")).append(" · ").append(row.getString("stage"));
                if(row.has("http"))result.append(" · HTTP ").append(row.optInt("http")).append(" ").append(row.optString("code"));
                else if(row.has("exception"))result.append(" · ").append(row.optString("exception"));
                if(!row.optString("request_id").isEmpty())result.append("\nRequest: ").append(row.optString("request_id"));
                result.append("\n\n");
            }
            return result.length()==0?"No connection history yet. Try ChatGPT sign-in once to capture the result.":result.toString();
        } catch(Exception e) { return "Connection history could not be read."; }
    }
}
