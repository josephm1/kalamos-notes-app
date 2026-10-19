package com.kalamos.device.bigme

import android.content.Context
import android.util.Log
import android.view.View

/** View-specific image-preserving updates for an app-owned interactive surface. No package/ink preset changes. */
internal object BigmeInteractiveSurface {
    fun configure(view: View) {
        try {
            val applied = apply(
                Class.forName("xrz.framework.manager.XrzEinkManager"),
                Context::class.java, view.context, View::class.java, view, EinkCenter.MODE_COMIC,
            )
            if (applied) Log.i("BigmeInteractiveSurface", "Requested view refresh mode=${EinkCenter.MODE_COMIC}")
            else Log.w("BigmeInteractiveSurface", "View refresh mode request rejected: mode=${EinkCenter.MODE_COMIC}")
        } catch (error: Throwable) {
            Log.w("BigmeInteractiveSurface", "View refresh mode unavailable: ${error.message}")
        }
    }

    // Firmware SDK exposes a public Context constructor, rather than a singleton factory.
    internal fun apply(managerClass: Class<*>, contextType: Class<*>, context: Any,
                       viewType: Class<*>, view: Any, mode: Int): Boolean {
        val manager = managerClass.getConstructor(contextType).newInstance(context)
        val result = managerClass.getMethod("setRefreshModeByView", viewType, Int::class.javaPrimitiveType)
            .invoke(manager, view, mode)
        return result != false // The documented setter is void; respect boolean firmware variants.
    }
}
