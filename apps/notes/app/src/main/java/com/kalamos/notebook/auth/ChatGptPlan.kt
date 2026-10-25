// Adapted from josephm1/LearnHarness-Mobile Android account connection code.
package com.kalamos.notebook.auth

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

/** App-local account owner. Billing is explicit; plan failures never select an API key. */
object ChatGptPlan {
    @Volatile private var app: Context? = null
    val changes = MutableStateFlow(0L)
    @JvmStatic fun initialize(context: Context) { app = context.applicationContext }
    private fun context() = checkNotNull(app) { "Open ChatGPT connection settings first" }
    @JvmStatic fun accounts(): ChatGptAccounts = ChatGptAccounts.get(context())
    @JvmStatic fun enabled(): Boolean = app?.getSharedPreferences("chatgpt-billing",0)?.getBoolean("usePlan",false) == true
    @JvmStatic fun activeId(): String? = runCatching { accounts().active()?.optString("client_id")?.takeIf { it.isNotBlank() } }.getOrNull()
    @JvmStatic fun configured(): Boolean = runCatching { val account=accounts().active(); account!=null && account.optBoolean("connected") && account.optBoolean("plan") }.getOrDefault(false)
    @JvmStatic fun setEnabled(enabled: Boolean) {
        check(!enabled || configured()) { "Connect ChatGPT and grant plan permission first" }
        check(context().getSharedPreferences("chatgpt-billing",0).edit().putBoolean("usePlan",enabled).commit())
        notifyChanged()
    }
    @JvmStatic fun token(account: String): String = accounts().token(account,OpenAiHttp())
    @JvmStatic fun notifyChanged() { changes.update { it+1 } }
}
