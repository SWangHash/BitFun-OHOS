package com.bitfun.mobile.app

import androidx.test.platform.app.InstrumentationRegistry

/** Assertions follow the device locale while fixture transcript text remains literal. */
internal fun testString(resource: Int, vararg arguments: Any): String =
    InstrumentationRegistry.getInstrumentation().targetContext.getString(resource, *arguments)
