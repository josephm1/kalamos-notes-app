// Adapted from josephm1/LearnHarness-Mobile Android account connection code.
package com.kalamos.notebook.auth;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.concurrent.*;

/** Native connection controls: credentials never enter a WebView or the clipboard. */
public final class ChatGptActivity extends Activity {
    private ChatGptAccounts accounts;private LinearLayout body;private final ExecutorService worker=Executors.newSingleThreadExecutor();private boolean working;
    @Override public void onCreate(Bundle state){super.onCreate(state);ChatGptPlan.initialize(this);try{accounts=ChatGptPlan.accounts();render();}catch(Exception error){showError(error);}}
    @Override protected void onResume(){super.onResume();if(accounts!=null){accounts.observe(this::render);render();}}
    @Override protected void onPause(){if(accounts!=null)accounts.observe(null);super.onPause();}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private void text(String value,int size,boolean bold){TextView view=new TextView(this);view.setText(value);view.setTextColor(Color.BLACK);view.setTextSize(size);view.setPadding(0,dp(8),0,dp(8));if(bold)view.setTypeface(null,Typeface.BOLD);body.addView(view);}
    private void action(String title,Runnable run){Button button=new Button(this);button.setText(title);button.setAllCaps(false);button.setTextColor(Color.BLACK);button.setMinHeight(dp(48));GradientDrawable shape=new GradientDrawable();shape.setColor(Color.WHITE);shape.setStroke(dp(1),Color.BLACK);shape.setCornerRadius(dp(24));button.setBackground(shape);button.setStateListAnimator(null);button.setEnabled(!working && (accounts==null || !accounts.isSigningIn()));button.setOnClickListener(view->run.run());LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(6),0,dp(6));body.addView(button,p);}
    private void render(){
        if(isFinishing() || isDestroyed() || accounts==null)return;
        ScrollView scroll=new ScrollView(this);scroll.setBackgroundColor(Color.WHITE);body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(24),dp(24),dp(24),dp(24));scroll.addView(body);setContentView(scroll);
        text("ChatGPT connection",24,true);text("Connect your account, then choose whether to use your ChatGPT plan for AI requests in Kalamos Notes. API-key billing remains a separate option.",16,false);
        try{
            JSONObject account=accounts.active();String id=account==null?"":account.getString("client_id");
            if(account!=null){text(account.optString("label"),16,true);text(account.optBoolean("connected")?(account.optBoolean("plan")?"Signed in · plan permission granted":"Signed in · plan permission not granted"):"Sign in again to reconnect",14,false);}
            if(accounts.isSigningIn()){
                text("Complete sign-in in your browser, then return here.",16,false);
                Button cancel=new Button(this);cancel.setText("Cancel sign-in");cancel.setOnClickListener(view->accounts.cancelSignIn());body.addView(cancel);
            }else{
                action(account==null?"Continue with ChatGPT":"Continue with saved ChatGPT account",()->signIn(id,false));
                action("Add another account or workspace",()->signIn("",false));
                if(!accounts.interruptedClient().isEmpty())action("Resume interrupted registration",()->signIn(accounts.interruptedClient(),false));
                JSONArray saved=accounts.accounts();if(saved.length()>1)action("Choose saved account",()->{try{String[] labels=new String[saved.length()];for(int i=0;i<labels.length;i++)labels[i]=saved.getJSONObject(i).getString("label");new AlertDialog.Builder(this).setTitle("ChatGPT account").setItems(labels,(dialog,which)->{try{accounts.select(saved.getJSONObject(which).getString("client_id"));render();}catch(Exception error){showError(error);}}).show();}catch(Exception error){showError(error);}});
                if(account!=null && account.optBoolean("connected")){
                    if(!account.optBoolean("plan"))action("Enable ChatGPT plan permission",()->signIn(id,true));
                    else{
                        action("Refresh available models",()->background(()->accounts.refreshModels(id,new OpenAiHttp())));
                        JSONArray models=account.optJSONArray("models");String selected=account.optString("model");text("Model: "+(selected.isEmpty()?"Choose an available model":selected),16,true);
                        if(models!=null && models.length()>0)action("Choose ChatGPT model",()->{try{String[] names=new String[models.length()];for(int i=0;i<names.length;i++)names[i]=models.getJSONObject(i).optString("display_name",models.getJSONObject(i).getString("slug"));new AlertDialog.Builder(this).setTitle("Available ChatGPT models").setItems(names,(dialog,which)->{try{accounts.model(id,models.getJSONObject(which).getString("slug"));render();}catch(Exception error){showError(error);}}).show();}catch(Exception error){showError(error);}});
                        if(!selected.isEmpty())action(ChatGptPlan.enabled()?"ChatGPT plan selected":"Use ChatGPT plan",()->{try{ChatGptPlan.setEnabled(true);render();}catch(Exception error){showError(error);}});
                    }
                    action("Sign out of this account",()->background(()->accounts.signOut(id,new OpenAiHttp())));
                }
                action("Use API-key billing",()->{ChatGptPlan.setEnabled(false);render();});
            }
            text(ChatGptPlan.enabled()?"Billing: ChatGPT plan. Limits or account errors stop the request; they never switch to an API key.":"Billing: configured API provider. ChatGPT plan usage is not selected.",14,true);
            action("Usage and app limits",()->startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(OpenAiHttp.USAGE))));
            action("Connection details",()->new AlertDialog.Builder(this).setTitle("Connection details").setMessage(accounts.diagnosticSummary()).setPositiveButton("Close",null).show());
            action("Done",()->{try{JSONObject selected=accounts.active();if(selected!=null)setResult(RESULT_OK,new Intent().putExtra("model",selected.optString("model")));}catch(Exception ignored){}finish();});
            String notice=accounts.takeNotice();if(!notice.isEmpty())Toast.makeText(this,notice,Toast.LENGTH_LONG).show();
            ChatGptPlan.notifyChanged();
        }catch(Exception error){text("Connection could not be read. "+error.getMessage(),16,false);}
    }
    private void signIn(String id,boolean consent){try{String url=accounts.startSignIn(id,consent);startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(url)));render();}catch(Exception error){accounts.cancelSignIn();showError(error);}}
    private interface Work{void run()throws Exception;}
    private void background(Work work){working=true;render();worker.submit(()->{Exception failure=null;try{work.run();}catch(Exception error){failure=error;}Exception result=failure;runOnUiThread(()->{working=false;if(!isFinishing() && !isDestroyed()){render();if(result!=null)showError(result);}});});}
    private void showError(Exception error){if(isFinishing() || isDestroyed())return;new AlertDialog.Builder(this).setTitle("ChatGPT connection").setMessage(error.getMessage()==null?"The connection could not complete.":error.getMessage()).setPositiveButton("Close",null).show();}
    @Override protected void onDestroy(){worker.shutdownNow();super.onDestroy();}
}
