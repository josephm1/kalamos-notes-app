package com.kalamos.koreader

import android.view.SurfaceHolder
import android.view.SurfaceView

/** Public Android rendering needs a real Surface, not merely a posted layout callback. */
internal fun runWhenInkSurfaceReady(view: SurfaceView, action: Runnable) {
    var fired = false
    val callback = object : SurfaceHolder.Callback {
        private fun ready() {
            if (fired || view.width <= 0 || view.height <= 0 || view.holder.surface?.isValid != true) return
            fired = true
            view.holder.removeCallback(this)
            action.run()
        }
        override fun surfaceCreated(holder: SurfaceHolder) = ready()
        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = ready()
        override fun surfaceDestroyed(holder: SurfaceHolder) {}
        fun check() = ready()
    }
    view.holder.addCallback(callback)
    view.post { callback.check() }
}
