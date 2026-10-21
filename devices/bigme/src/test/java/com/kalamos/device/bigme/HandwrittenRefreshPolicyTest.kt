package com.kalamos.device.bigme

import org.junit.Assert.*
import org.junit.Test

class HandwrittenRefreshPolicyTest {
    class Client {
        val policies = mutableListOf<Triple<Boolean, Int, Int>>()
        fun setRecommitEnabled(enabled: Boolean, delay: Int, mode: Int) { policies.add(Triple(enabled, delay, mode)) }
        fun setInputEnabled(enabled: Boolean) { error("Refresh policy must not toggle input: $enabled") }
    }
    @Test fun disablesOnlyTheRegisteredClientsDelayedReplayWithoutTouchingInput() {
        val current = Client()
        val other = Client()
        disableHandwrittenRecommit(Client::class.java, current)
        assertEquals(listOf(Triple(false, 0, EinkCenter.MODE_GU16)), current.policies)
        assertTrue(other.policies.isEmpty())
    }
    @Test(expected = NoSuchMethodException::class)
    fun missingOptionalFirmwareApiIsReportedToTheAttachOwnersBestEffortBoundary() {
        disableHandwrittenRecommit(Any::class.java, Any())
    }
}
