package com.kalamos.device.bigme

import org.junit.Assert.assertEquals
import org.junit.Test

class HandwrittenOverlayResetTest {
    interface Service { fun clearOverlay(id: Int) }
    class RecordingService : Service {
        val cleared = mutableListOf<Int>()
        override fun clearOverlay(id: Int) { cleared.add(id) }
    }
    class Client(private val mServer: Service?, private val mId: Int)

    @Test fun resetTargetsOnlyTheDepartingClientAndDoesNotUnregisterIt() {
        val service = RecordingService()
        assertEquals(14, clearHandwrittenOverlay(Client::class.java, Client(service, 14), Service::class.java))
        assertEquals(listOf(14), service.cleared)
    }

    @Test(expected = IllegalStateException::class)
    fun unregisteredClientCannotResetTheService() {
        clearHandwrittenOverlay(Client::class.java, Client(RecordingService(), -1), Service::class.java)
    }
}
