package com.kalamos.device.standard

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class StandardDeviceProviderTest {
    @Test
    fun providerSelectsARealStandardController() {
        val provider = StandardDeviceProvider()
        val controller = provider.createInkController()

        assertEquals("standard", provider.id)
        assertEquals(StandardInkController::class.java, controller.javaClass)
        assertFalse(controller.isActive)
        assertFalse(controller.consumesMotionEvents)
        assertFalse(provider.supportsPersistentDisplayHandoff)
    }
}
