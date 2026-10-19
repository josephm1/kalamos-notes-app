package com.kalamos.notebook

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.fragment.app.Fragment
import com.kalamos.device.api.DeviceRegistry
import com.kalamos.foundation.runtime.R
import com.kalamos.notebook.bridge.AndroidBridge
import com.kalamos.notebook.bridge.BookContentInterceptor
import com.kalamos.notebook.bridge.WebViewCache
import com.kalamos.notebook.bridge.CachedWebViewHolder
import com.kalamos.notebook.bridge.InkManager
import com.kalamos.notebook.storage.StorageManager
import com.kalamos.notebook.view.InkSurfaceView

/**
 * The single screen. Library and editor are two views inside ONE WebView (app.html), switched by
 * the JS router (window.App) — no fragment navigation, no WebView swap. The base-layer
 * InkSurfaceView is the visible writing layer in editor mode and hidden (GONE) in library mode.
 */
class AppFragment : Fragment() {

    private lateinit var storageManager: StorageManager
    private lateinit var bridge: AndroidBridge
    private var inkManager: InkManager? = null
    // External editor activities need their own view/bridges; they must not steal the warmed
    // launcher shell from a stopped activity that Android can subsequently resume.
    private val isolated get() = arguments?.getBoolean("isolatedWebView") == true
    private val holder by lazy {
        if (isolated) CachedWebViewHolder("file:///android_asset/web/app.html", false)
        else WebViewCache.app
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        storageManager = StorageManager(requireContext())
    }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View = inflater.inflate(R.layout.fragment_app, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        android.util.Log.i("PERF", "DIAG app onViewCreated t=${android.os.SystemClock.uptimeMillis()}")  // DIAG to remove
        // Request the normal display policy semantically; the selected device maps it to its own
        // mechanism (Bigme COMIC today, ordinary Android composition in the Standard backend).
        DeviceRegistry.require(requireContext()).setDefaultDisplay(requireContext())
        // (rotation lock is applied in MainActivity.onCreate)
        val container = view as ViewGroup
        val webView = holder.acquire(requireContext())
        webView.id = R.id.webView
        // index 0 → below the ink surface (the ink surface is the inflated top child).
        container.addView(webView, 0, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        wireWebView(webView)
    }

    private fun wireWebView(webView: WebView) {
        val inkSurfaceView = (view ?: return).findViewById<InkSurfaceView>(R.id.inkSurfaceView)
        inkManager = InkManager(inkSurfaceView, webView)
        bridge = AndroidBridge(this, storageManager, inkManager)
        holder.router.delegate = bridge
        // Optional per-app native services (see AppBridgeRouter). An app may ship its own
        // com.kalamos.notebook.app.AppBridgeFactory with @JvmStatic create(Fragment, WebView)
        // (Scribe does, for hwr fallback/voice extras); every other app falls back to the
        // shared CoreAppBridge so the web AI stack (HTTP/secrets/WebSocket) works everywhere.
        holder.appRouter.delegate?.onRelease()
        holder.appRouter.delegate = try {
            Class.forName("com.kalamos.notebook.app.AppBridgeFactory")
                .getMethod("create", Fragment::class.java, WebView::class.java)
                .invoke(null, this, webView) as? com.kalamos.notebook.bridge.AppBridgeDelegate
        } catch (t: Throwable) {
            android.util.Log.i("AppBridge", "no app factory (${t.cause ?: t}) — using CoreAppBridge")
            try {
                com.kalamos.notebook.app.CoreAppBridgeFactory.create(this, webView)
            } catch (t2: Throwable) {
                android.util.Log.w("AppBridge", "CoreAppBridge init failed: ${t2.cause ?: t2}")
                null
            }
        }
        webView.webViewClient = makeWebViewClient()
        if (holder.isLoaded) {
            // Reused WebView (e.g. after config change): make sure we're showing the library.
            webView.evaluateJavascript("window.App && window.App.start()", null)
        }
        // else: first load — app.html's DOMContentLoaded runs App.start() itself.
    }

    private fun makeWebViewClient() = object : WebViewClient() {
        // Keep the virtual book-content host alive after AppFragment replaces the pre-warm
        // WebViewClient. Without this override every PDF/EPUB request falls through to DNS, fails,
        // then pays the much slower base64 JavascriptInterface fallback.
        override fun shouldInterceptRequest(
            view: WebView,
            request: android.webkit.WebResourceRequest
        ): android.webkit.WebResourceResponse? {
            return BookContentInterceptor.intercept(request, storageManager)
                ?: super.shouldInterceptRequest(view, request)
        }

        override fun onPageFinished(view: WebView, url: String) {
            super.onPageFinished(view, url)
            holder.markLoaded()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            android.util.Log.w("AppFragment", "WebView renderer gone (didCrash=${detail.didCrash()}); rebuilding")
            recreateWebView()
            return true
        }
    }

    private fun recreateWebView() {
        val container = view as? ViewGroup ?: return
        inkManager?.detach()
        holder.reset(requireContext().applicationContext)
        val fresh = holder.acquire(requireContext())
        fresh.id = R.id.webView
        container.addView(fresh, 0, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        wireWebView(fresh)
    }

    /** Android back → let the JS router decide (editor → library, library → exit). */
    fun handleBack() {
        webView?.evaluateJavascript("window.App && window.App.onAndroidBack()", null)
    }

    /** Hardware page-turn button → the JS router (library pagination / notebook page nav). */
    fun onPageKey(dir: String) {
        webView?.evaluateJavascript("window.App && window.App.onPageKey('$dir')", null)
    }

    fun onNewIntent() {
        webView?.evaluateJavascript(
            "window.AppMode && window.AppMode.onNewIntent ? window.AppMode.onNewIntent() : " +
                "(window.KalamosAgent && window.KalamosAgent.checkIncomingNote && window.KalamosAgent.checkIncomingNote())",
            null
        )
    }

    override fun onPause() {
        inkManager?.traceHostLifecycle("pause", activity?.javaClass?.name)
        super.onPause()
        webView?.evaluateJavascript("window.App && window.App.onPauseApp()", null)
        // Device-owned background work must not depend on asynchronous WebView evaluation. Bigme
        // uses this checkpoint to refresh the already-rendered standby JPEG in place.
        DeviceRegistry.require(requireContext()).onAppBackground(requireContext())
    }

    override fun onResume() {
        inkManager?.onHostResumed()
        inkManager?.traceHostLifecycle("resume", activity?.javaClass?.name)
        super.onResume()
        webView?.evaluateJavascript("window.App && window.App.onResumeApp()", null)
    }

    override fun onStop() {
        // Release daemon ownership even if asynchronous JavaScript pause/save work is delayed.
        inkManager?.traceHostLifecycle("stop", activity?.javaClass?.name)
        inkManager?.onHostStopped()
        super.onStop()
    }

    override fun onDestroyView() {
        inkManager?.traceHostLifecycle("destroyView", activity?.javaClass?.name)
        inkManager?.detach()
        if (isolated) holder.reset(requireContext().applicationContext)
        else holder.release(requireContext().applicationContext)
        super.onDestroyView()
    }

    private val webView: WebView?
        get() = view?.findViewById(R.id.webView)

    companion object {
        fun newInstance(isolatedWebView: Boolean = false) = AppFragment().apply {
            arguments = Bundle().apply { putBoolean("isolatedWebView", isolatedWebView) }
        }
    }
}
