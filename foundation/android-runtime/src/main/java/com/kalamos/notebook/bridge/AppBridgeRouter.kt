package com.kalamos.notebook.bridge

import android.webkit.JavascriptInterface

/**
 * Optional per-app native services, bound ONCE to the cached WebView as "AppBridge"
 * (same rebind constraint as [BridgeRouter]: addJavascriptInterface only takes effect on
 * a page reload, so the router is stable and only the delegate swaps per session).
 *
 * Unlike [BridgeRouter] this router is generic — one call(method, argsJson) entry point —
 * so the core never accumulates per-app methods. An app provides a delegate by shipping
 * `com.kalamos.notebook.app.AppBridgeFactory` (looked up by reflection in AppFragment);
 * base apps ship no factory and JS callers get {"err":"no-app-bridge"}.
 */
class AppBridgeRouter {
    @Volatile
    var delegate: AppBridgeDelegate? = null

    @JavascriptInterface
    fun call(method: String, argsJson: String): String =
        delegate?.call(method, argsJson) ?: """{"err":"no-app-bridge"}"""
}

interface AppBridgeDelegate {
    /**
     * Synchronous dispatch on the WebView's JS-bridge thread — must return fast.
     * Long work belongs on executors; results stream back via
     * webView.evaluateJavascript("window.onAppEvent(...)") on the main thread.
     */
    fun call(method: String, argsJson: String): String

    /** Session teardown: cancel streams, close sockets, drop view refs. */
    fun onRelease() {}
}
