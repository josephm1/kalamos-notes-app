// Adapted from josephm1/LearnHarness-Mobile Android account connection code.
package com.kalamos.notebook.auth;

import android.app.*;
import android.content.*;
import android.os.*;
import androidx.core.app.NotificationCompat;

/** Keeps the loopback listener responsive while the system browser is foregrounded. */
public final class SignInService extends Service {
    private static final String CHANNEL="chatgpt-sign-in";
    public static final String CANCEL="com.kalamos.notebook.auth.CANCEL_SIGN_IN";
    @Override public void onCreate(){
        super.onCreate();
        NotificationManager notifications=getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL,"ChatGPT sign-in",NotificationManager.IMPORTANCE_LOW));
        Intent back=new Intent(this,ChatGptActivity.class).setAction(Intent.ACTION_VIEW).setData(android.net.Uri.parse(getPackageName()+".chatgpt://signin-complete")).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent returnToApp=PendingIntent.getActivity(this,51,back,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent cancel=PendingIntent.getService(this,52,new Intent(this,SignInService.class).setAction(CANCEL),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification=new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Connecting to ChatGPT")
            .setContentText("Complete sign-in in your browser. Tap to return to Kalamos Notes.").setContentIntent(returnToApp).setOngoing(true).setSilent(true)
            .addAction(0,"Cancel",cancel).build();
        startForeground(51,notification);
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){if(intent!=null && CANCEL.equals(intent.getAction()))cancel();return START_NOT_STICKY;}
    private void cancel(){try{ChatGptAccounts.get(this).cancelSignIn();}catch(Exception ignored){}stopSelf();}
    @Override public void onTaskRemoved(Intent root){cancel();super.onTaskRemoved(root);}
    @Override public IBinder onBind(Intent intent){return null;}
}
