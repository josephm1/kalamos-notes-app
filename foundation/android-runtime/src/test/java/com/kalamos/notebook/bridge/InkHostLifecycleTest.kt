package com.kalamos.notebook.bridge

import org.junit.Assert.*
import org.junit.Test

class InkHostLifecycleTest {
    @Test fun retiredLayoutCannotReconnectAndReplacementCan() {
        val host = InkHostLifecycle()
        val old = host.request()
        host.retire()
        assertFalse(host.accepts(old))
        assertTrue(host.accepts(host.request()))
    }
    @Test fun stoppingBlocksRequestsWithoutRevivingOldTicketsOnResume() {
        val host = InkHostLifecycle()
        val queuedHost = host.hostTicket()
        val layout = host.request()
        host.stop()
        val stoppedRequest = host.hostTicket()
        assertFalse(host.accepts(layout))
        assertFalse(host.accepts(host.request()))
        host.resume()
        assertFalse(host.acceptsHost(stoppedRequest))
        assertFalse(host.acceptsHost(queuedHost))
        assertFalse(host.accepts(layout))
        assertTrue(host.acceptsHost(host.hostTicket()))
        assertTrue(host.accepts(host.request()))
    }
    @Test fun orderedDetachThenAttachWithinTheSameHostRemainsAdmissible() {
        val host = InkHostLifecycle()
        val bridgeRequest = host.hostTicket()
        host.retire()
        assertTrue(host.acceptsHost(bridgeRequest))
        val first = host.request()
        val replacement = host.request()
        assertFalse(host.accepts(first))
        assertTrue(host.accepts(replacement))
    }
}
