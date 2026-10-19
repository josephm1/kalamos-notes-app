package com.kalamos.device.bigme

import org.junit.Assert.*
import org.junit.Test

class BigmeInteractiveSurfaceTest {
    class ContextStub
    class ViewStub
    class VoidManager(val context: ContextStub) {
        init { created = this }
        var view: ViewStub? = null
        var mode = -1
        fun setRefreshModeByView(view: ViewStub, mode: Int) { this.view = view; this.mode = mode }
        companion object { var created: VoidManager? = null }
    }
    class RejectingManager(context: ContextStub) {
        fun setRefreshModeByView(view: ViewStub, mode: Int): Boolean = false
    }
    @Test fun usesPublicContextConstructorAndVoidViewSetter() {
        val context = ContextStub()
        val view = ViewStub()
        assertTrue(BigmeInteractiveSurface.apply(VoidManager::class.java, ContextStub::class.java,
            context, ViewStub::class.java, view, EinkCenter.MODE_COMIC))
        assertSame(context, VoidManager.created!!.context)
        assertSame(view, VoidManager.created!!.view)
        assertEquals(EinkCenter.MODE_COMIC, VoidManager.created!!.mode)
    }
    @Test fun respectsBooleanRejectionFromFirmwareVariant() {
        assertFalse(BigmeInteractiveSurface.apply(RejectingManager::class.java, ContextStub::class.java,
            ContextStub(), ViewStub::class.java, ViewStub(), EinkCenter.MODE_COMIC))
    }
}
