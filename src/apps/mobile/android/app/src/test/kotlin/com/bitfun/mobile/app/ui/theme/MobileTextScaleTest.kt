package com.bitfun.mobile.app.ui.theme

import com.bitfun.mobile.app.ui.theme.generated.MobileTextScale
import org.junit.Assert.assertEquals
import org.junit.Test

class MobileTextScaleTest {
    @Test
    fun referenceClassStaysUnscaled() {
        // 460 ppi at 3x is the ramp's reference; anything denser per dp caps at 1.
        assertEquals(1f, MobileTextScale.resolve(xdpi = 460f, density = 3f), 0.0001f)
        assertEquals(1f, MobileTextScale.resolve(xdpi = 489f, density = 3f), 0.0001f)
    }

    @Test
    fun largerDpShrinksText() {
        // HUAWEI Mate X7 outer screen: 415.6 xdpi at density 3.125.
        assertEquals(0.868f, MobileTextScale.resolve(xdpi = 415.636f, density = 3.125f), 0.0001f)
    }

    @Test
    fun neverDropsBelowFloor() {
        assertEquals(0.85f, MobileTextScale.resolve(xdpi = 300f, density = 3f), 0.0001f)
    }

    @Test
    fun implausibleMetricsFallBackToUnscaled() {
        assertEquals(1f, MobileTextScale.resolve(xdpi = 0f, density = 3f), 0.0001f)
        assertEquals(1f, MobileTextScale.resolve(xdpi = 96f, density = 3f), 0.0001f)
        assertEquals(1f, MobileTextScale.resolve(xdpi = 2000f, density = 3f), 0.0001f)
        assertEquals(1f, MobileTextScale.resolve(xdpi = 415f, density = 0f), 0.0001f)
    }
}
