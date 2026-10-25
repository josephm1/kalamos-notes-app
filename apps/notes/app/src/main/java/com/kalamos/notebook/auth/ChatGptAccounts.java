// Adapted from josephm1/LearnHarness-Mobile Android account connection code.
package com.kalamos.notebook.auth;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import org.json.*;
import java.io.IOException;
import java.net.URI;
import java.util.*;
import java.util.concurrent.*;

/** App-scoped sign-in survives Activity recreation; encrypted account writes are serialized. */
public final class ChatGptAccounts {
    private static ChatGptAccounts instance;
    public static synchronized ChatGptAccounts get(Context context) throws Exception {
        if(instance==null)instance=new ChatGptAccounts(context.getApplicationContext()); return instance;
    }
    private final Context context;
    private final boolean keepSignInAlive;
    private final SecretStore secrets;
    private final AuthDiagnostics diagnostics;
    private final android.content.SharedPreferences state;
    private JSONObject database;
    private final Object refreshLock=new Object();
    private final ExecutorService authWorker=Executors.newSingleThreadExecutor();
    private final OpenAiHttp authHttp;
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile OAuthLoopback pending;
    private volatile boolean signingIn;
    private volatile int generation;
    private Runnable listener;
    private String notice="";
    public ChatGptAccounts(Context context) throws Exception { this(context,new OpenAiHttp(),true); }
    ChatGptAccounts(Context context,OpenAiHttp authHttp) throws Exception { this(context,authHttp,false); }
    private ChatGptAccounts(Context context,OpenAiHttp authHttp,boolean keepSignInAlive) throws Exception {
        this.context=context.getApplicationContext();this.keepSignInAlive=keepSignInAlive;
        this.authHttp=authHttp;
        diagnostics=new AuthDiagnostics(context);
        secrets=new SecretStore(context); state=context.getSharedPreferences("chatgpt-state",Context.MODE_PRIVATE);
        String saved=secrets.get("chatgpt-accounts");
        database=saved.isEmpty()?new JSONObject().put("accounts",new JSONArray()).put("active",""):new JSONObject(saved);
        database.getJSONArray("accounts");
    }
    public synchronized void observe(Runnable changed) { listener=changed; }
    private void changed() { main.post(() -> { Runnable callback; synchronized(this) { callback=listener; } if(callback!=null)callback.run(); }); }
    public synchronized String takeNotice() { String result=notice; notice=""; return result; }
    private synchronized void message(String text) { notice=text; changed(); }
    public boolean isSigningIn() { return signingIn; }
    public String diagnosticSummary() { return diagnostics.summary(); }
    public synchronized String interruptedClient() { return database.optString("pending_client"); }
    private synchronized JSONObject find(String id) throws Exception {
        JSONArray accounts=database.getJSONArray("accounts");
        for(int i=0;i<accounts.length();i++)if(accounts.getJSONObject(i).getString("client_id").equals(id))return new JSONObject(accounts.getJSONObject(i).toString());
        return null;
    }
    private synchronized void persist(JSONObject replacement) throws Exception { secrets.set("chatgpt-accounts",replacement.toString()); database=replacement; }
    private synchronized void store(JSONObject account,boolean activate) throws Exception {
        JSONObject next=new JSONObject(database.toString()); JSONArray accounts=next.getJSONArray("accounts"); int index=-1;
        for(int i=0;i<accounts.length();i++)if(accounts.getJSONObject(i).getString("client_id").equals(account.getString("client_id"))) {
            if(!accounts.getJSONObject(i).getString("subject").equals(account.getString("subject")))throw new IOException("Account identity did not match its registration.");
            index=i; break;
        }
        if(index<0)accounts.put(account);else accounts.put(index,account);
        if(activate)next.put("active",account.getString("client_id"));
        if(account.getString("client_id").equals(next.optString("pending_client")))next.remove("pending_client");
        persist(next);
    }
    public synchronized JSONArray accounts() throws Exception {
        JSONArray result=new JSONArray(); JSONArray rows=database.getJSONArray("accounts");
        for(int i=0;i<rows.length();i++) { JSONObject row=rows.getJSONObject(i); result.put(new JSONObject().put("client_id",row.getString("client_id")).put("label",label(row)).put("connected",!row.optString("access_token").isEmpty()).put("plan",OAuthProtocol.canUsePlan(row.optString("scope")))); }
        return result;
    }
    public static String label(JSONObject account) {
        String client=account.optString("client_id"); String suffix=client.substring(Math.max(0,client.length()-6));
        return account.optString("email","ChatGPT account")+" · "+suffix;
    }
    public synchronized JSONObject active() throws Exception {
        JSONObject row=find(database.optString("active"));
        if(row==null)return null;
        return new JSONObject().put("client_id",row.getString("client_id")).put("label",label(row)).put("connected",!row.optString("access_token").isEmpty()).put("plan",OAuthProtocol.canUsePlan(row.optString("scope"))).put("models",row.optJSONArray("models")==null?new JSONArray():row.getJSONArray("models")).put("model",row.optString("model"));
    }
    public synchronized void select(String id) throws Exception {
        if(signingIn)throw new IOException("Finish or cancel sign-in before switching accounts.");
        if(find(id)==null)throw new IOException("Saved account not found.");
        persist(new JSONObject(database.toString()).put("active",id));
    }
    public synchronized void model(String id,String model) throws Exception {
        JSONObject row=find(id); if(row==null)throw new IOException("Account not found.");
        boolean valid=false; JSONArray models=row.optJSONArray("models");
        for(int i=0;models!=null && i<models.length();i++)if(models.getJSONObject(i).getString("slug").equals(model))valid=true;
        if(!valid)throw new IOException("Choose a model in this account's catalog.");
        row.put("model",model); store(row,false);
    }
    public String startSignIn(String id,boolean consent) throws Exception {
        if(signingIn)throw new IOException("A ChatGPT sign-in is already open.");
        JSONObject prior=id.isEmpty()?null:find(id);
        if(!id.isEmpty() && prior==null && !id.equals(interruptedClient()))throw new IOException("Saved account not found.");
        String host=state.getString("host","");
        if(host.isEmpty()) { host="urn:uuid:"+UUID.randomUUID(); if(!state.edit().putString("host",host).commit())throw new IOException("Could not save this installation's sign-in identity."); }
        OAuthLoopback loop=new OAuthLoopback(context.getPackageName());
        OAuthProtocol.Attempt attempt=new OAuthProtocol.Attempt(OAuthProtocol.random(),OAuthProtocol.random(),OAuthProtocol.random(),loop.redirect(),prior==null?(id.isEmpty()?"dynamic_agent_client":id):prior.getString("client_id"),prior==null?"":prior.getString("subject"),prior==null?"":prior.optString("email"));
        String url;
        try { url=OAuthProtocol.authorize(attempt,host,consent); }
        catch(Exception e) { loop.close(); throw e; }
        diagnostics.event("browser_sign_in_started",null);
        signingIn=true;pending=loop;int request=++generation;
        if(keepSignInAlive) {
            try { androidx.core.content.ContextCompat.startForegroundService(context,new android.content.Intent(context,SignInService.class));diagnostics.event("foreground_sign_in_started",null); }
            catch(RuntimeException e){loop.close();pending=null;signingIn=false;diagnostics.event("foreground_sign_in_failed",e);throw new IOException("Android could not keep sign-in running. Reopen Kalamos Notes and try again.");}
        }
        changed();
        authWorker.submit(() -> {
            try {
                Map<String,String> callback=loop.await(attempt);
                String client=OAuthProtocol.callbackClient(attempt,callback);
                diagnostics.event("browser_callback_accepted",null);
                Map<String,String> form=new LinkedHashMap<>(); form.put("grant_type","authorization_code"); form.put("client_id",client); form.put("code",callback.get("code")); form.put("code_verifier",attempt.verifier()); form.put("redirect_uri",attempt.redirect()); form.put("resource",OpenAiHttp.API);
                JSONObject tokens;
                try { diagnostics.event("token_exchange_started",null);tokens=authHttp.form(OpenAiHttp.AUTH+"/api/accounts/oauth/token",form);diagnostics.event("token_exchange_completed",null); }
                catch(Exception exchangeError) {
                    diagnostics.event("token_exchange_failed",exchangeError);
                    // Preserve an issued registration after a failed exchange, without treating it as a verified account.
                    synchronized(this) { if(prior==null && request==generation)persist(new JSONObject(database.toString()).put("pending_client",client)); }
                    throw exchangeError;
                }
                diagnostics.event("identity_validation_started",null);
                JSONObject discovery=discovery(authHttp);
                JSONObject identity=OAuthProtocol.validateId(tokens.getString("id_token"),authHttp.get(endpoint(discovery,"jwks_uri"),""),client,attempt.nonce(),attempt.subject(),System.currentTimeMillis()/1000);
                JSONObject account=new JSONObject().put("client_id",client).put("subject",identity.getString("sub")).put("email",identity.optString("email","ChatGPT account"));
                if(prior!=null) { account.put("model",prior.optString("model")).put("models",prior.optJSONArray("models")==null?new JSONArray():prior.getJSONArray("models")); }
                applyTokens(account,tokens,false);
                diagnostics.event("identity_validation_completed",null);
                synchronized(this) { if(request!=generation)return; store(account,true); }
                boolean plan=OAuthProtocol.canUsePlan(account.optString("scope"));
                diagnostics.event(plan?"account_connected_with_plan_permission":"account_connected_without_plan_permission",null);
                if(plan && !state.getBoolean("welcomed."+client,false))state.edit().putBoolean("welcomed."+client,true).putBoolean("welcome-pending",true).apply();
                String catalogNotice="";
                if(plan)try { refreshModels(client,authHttp); } catch(Exception catalogError) { catalogNotice=" The model catalog could not be loaded yet; use Refresh available models."; }
                message(plan?"ChatGPT sign-in completed. Choose an available model and enable Use ChatGPT plan."+catalogNotice:"Signed in, but ChatGPT plan usage was not granted. Enable plan permission in Settings or explicitly choose your API provider.");
            } catch(Exception e) { if(request==generation){diagnostics.event("sign_in_failed",e);message(safeError(e));} }
            finally { loop.close(); if(request==generation) { pending=null;signingIn=false;stopSignInService();changed(); } }
        });
        return url;
    }
    public void cancelSignIn() { diagnostics.event("sign_in_cancelled",null);generation++; OAuthLoopback loop=pending; pending=null; signingIn=false; if(loop!=null)loop.close(); authHttp.cancel();stopSignInService();changed(); }
    private void stopSignInService(){if(keepSignInAlive)context.stopService(new android.content.Intent(context,SignInService.class));}
    public boolean takeWelcome() { boolean value=state.getBoolean("welcome-pending",false); if(value)state.edit().putBoolean("welcome-pending",false).apply(); return value; }
    public String token(String id,OpenAiHttp http) throws Exception {
        synchronized(refreshLock) {
        JSONObject row=find(id);
        if(row==null || row.optString("access_token").isEmpty())throw new IOException("Continue with your saved ChatGPT account in Settings to sign in.");
        if(!OAuthProtocol.canUsePlan(row.optString("scope")))throw new IOException("ChatGPT plan permission is disabled. Enable it in Settings before making requests.");
        long now=System.currentTimeMillis()/1000;
        if(now>=row.optLong("expires_at")-60) {
            if(now<row.optLong("earliest_refresh_at",0))throw new IOException("ChatGPT token renewal is not ready yet. Try again shortly.");
            try {
                Map<String,String> form=new LinkedHashMap<>(); form.put("grant_type","refresh_token");form.put("client_id",id);form.put("refresh_token",row.getString("refresh_token"));form.put("resource",OpenAiHttp.API);
                JSONObject tokens=http.form(OpenAiHttp.AUTH+"/api/accounts/oauth/token",form);
                if(tokens.has("id_token")) { JSONObject discovery=discovery(http); OAuthProtocol.validateId(tokens.getString("id_token"),http.get(endpoint(discovery,"jwks_uri"),""),id,null,row.getString("subject"),now); }
                applyTokens(row,tokens,true); store(row,false);
            } catch(OpenAiHttp.Failure failure) {
                if(failure.terminalRefresh()) { clearTokens(row);store(row,false);changed(); }
                throw failure;
            }
        }
        if(!OAuthProtocol.canUsePlan(row.optString("scope")))throw new IOException("ChatGPT plan permission is no longer enabled. Review your connection in Settings.");
        return row.getString("access_token");
        }
    }
    public void refreshModels(String id,OpenAiHttp http) throws Exception {
        String access=token(id,http); JSONArray catalog=http.get(OpenAiHttp.API+"/models",access).getJSONArray("models");
        JSONArray shown=new JSONArray();
        for(int i=0;i<catalog.length();i++) { JSONObject item=catalog.getJSONObject(i); if(item.optString("visibility").equals("list") && !item.optString("slug").isEmpty())shown.put(new JSONObject().put("slug",item.getString("slug")).put("display_name",item.optString("display_name",item.getString("slug")))); }
        if(shown.length()==0)throw new IOException("This account did not return any available models. Keep your sign-in and check account eligibility or try again later.");
        synchronized(this) {
            JSONObject row=find(id); if(row==null || row.optString("access_token").isEmpty())return;
            boolean retained=false; for(int i=0;i<shown.length();i++)if(shown.getJSONObject(i).getString("slug").equals(row.optString("model")))retained=true;
            row.put("models",shown); if(!retained)row.put("model",""); store(row,false);
        }
    }
    public boolean signOut(String id,OpenAiHttp http) throws Exception {
        JSONObject row=find(id); if(row==null)return true;
        boolean revoked=row.optString("refresh_token").isEmpty();
        try {
            if(!revoked) {
                String url=endpoint(discovery(http),"revocation_endpoint");
                Map<String,String> form=new LinkedHashMap<>();form.put("client_id",id);form.put("token",row.getString("refresh_token"));form.put("token_type_hint","refresh_token");
                for(int retry=0;retry<2;retry++) {
                    try { http.form(url,form); revoked=true; break; }
                    catch(OpenAiHttp.Failure e) { if(e.status<500 || retry==1)break; Thread.sleep(700); }
                    catch(IOException e) { if(retry==1)break; Thread.sleep(700); }
                }
            }
        } catch(Exception ignored) { /* Local logout still removes credentials if remote revocation fails. */ }
        finally { synchronized(this) { JSONObject latest=find(id); if(latest!=null){clearTokens(latest);store(latest,false);} } changed(); }
        return revoked;
    }
    private static void clearTokens(JSONObject row) { for(String key:new String[]{"access_token","refresh_token","id_token","scope","expires_at","earliest_refresh_at","models","model"})row.remove(key); }
    static void applyTokens(JSONObject account,JSONObject tokens,boolean refresh) throws Exception {
        if(!tokens.optString("token_type").equalsIgnoreCase("Bearer") || tokens.optString("access_token").isEmpty() || tokens.optString("refresh_token").isEmpty() || tokens.optLong("expires_in")<=0)throw new IOException("ChatGPT returned incomplete credentials. Sign in again.");
        account.put("access_token",tokens.getString("access_token")).put("refresh_token",tokens.getString("refresh_token"));
        if(tokens.has("id_token"))account.put("id_token",tokens.getString("id_token"));
        if(tokens.has("scope"))account.put("scope",tokens.getString("scope")); else if(!refresh)account.put("scope","");
        account.put("expires_at",System.currentTimeMillis()/1000+tokens.getLong("expires_in")).put("earliest_refresh_at",tokens.optLong("earliest_refresh_at",0));
    }
    private static JSONObject discovery(OpenAiHttp http) throws Exception {
        JSONObject value=http.get(OpenAiHttp.AUTH+"/.well-known/openid-configuration","");
        if(!value.getString("issuer").equals(OpenAiHttp.AUTH))throw new IOException("Unexpected OpenAI identity issuer.");return value;
    }
    private static String endpoint(JSONObject discovery,String key) throws Exception {
        String value=discovery.getString(key); URI uri=new URI(value);
        if(!"https".equals(uri.getScheme()) || !"auth.openai.com".equals(uri.getHost()) || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null || uri.getPort()!=-1 && uri.getPort()!=443)throw new IOException("Unexpected OpenAI identity endpoint.");
        return value;
    }
    public static String safeError(Exception e) {
        if(e instanceof OpenAiHttp.Failure)return ((OpenAiHttp.Failure)e).diagnostic();
        // Network/crypto exceptions may include implementation details, never an authorization URL.
        if(e instanceof IOException && e.getMessage()!=null && !e.getMessage().contains("http") && !e.getMessage().contains("token="))return e.getMessage();
        return "ChatGPT connection could not be completed. Check your internet connection and try sign-in again. Existing accounts and learning records have been kept.";
    }
}
