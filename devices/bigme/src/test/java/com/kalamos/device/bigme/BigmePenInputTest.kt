package com.kalamos.device.bigme

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BigmePenInputTest {
    @Test
    fun `dedicated Bigme pen is distinguished from the touchscreen`() {
        assertTrue(BigmePenInput.isPenDeviceName("fts_ts_pen"))
        assertTrue(BigmePenInput.isPenDeviceName("FTS_TS_PEN"))
        assertFalse(BigmePenInput.isPenDeviceName("istaric_ts"))
        assertFalse(BigmePenInput.isPenDeviceName(null))
    }
}
