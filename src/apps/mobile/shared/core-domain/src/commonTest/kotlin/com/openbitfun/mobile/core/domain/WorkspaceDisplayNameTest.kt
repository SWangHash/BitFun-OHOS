package com.openbitfun.mobile.core.domain

import kotlin.test.Test
import kotlin.test.assertEquals

class WorkspaceDisplayNameTest {
    @Test fun appendsHostWithoutChangingNameOrPath() {
        val remote = RecentWorkspace("/app", "App", "", "normal", "10.0.0.8")
        assertEquals("App · 10.0.0.8", remote.displayName)
        assertEquals("App", remote.name)
        assertEquals("/app", remote.path)
        assertEquals("App", RecentWorkspace("/app", "App", "", "normal").displayName)
        assertEquals("App", remote.copy(remoteSshHost = " ").displayName)
    }
}
