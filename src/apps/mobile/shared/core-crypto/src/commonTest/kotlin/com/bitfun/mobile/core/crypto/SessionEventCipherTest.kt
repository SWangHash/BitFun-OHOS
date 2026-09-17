package com.bitfun.mobile.core.crypto

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SessionEventCipherTest {
    @Test
    fun sharedSessionVectorDecryptsAcrossPlatforms() = runTest {
        assertEquals(
            "{\"session_id\":\"terminal-vector\",\"event\":\"terminal-output\",\"payload\":{\"terminal_id\":\"vector\",\"cursor\":42,\"text\":\"hello \u4e16\u754c\"}}",
            SessionEventCipher.decrypt("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", "ICEiIyQlJicoKSor", "qRjVFR/rc2F0Iyuq4yLWjbU7gfXp4Q/DGpMPZib4fCVX65Nh4FEX4DaJC+A1YHGpjgeD++5MWBXsTl1tLctmsrlC7zHttZHz+QeASdoxZgixtQkmwZ7laqA94AY4f+uucTtcdPJwrN/r6MF/19T3MRj04y7+/ku1xhWSg9f6//ko/ab9TxM5YCdz6YWvPhY="),
        )
    }
    @Test
    fun wrongSessionKeyRejectsTheVector() = runTest {
        assertFailsWith<RemoteCryptoException> {
            SessionEventCipher.decrypt("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "ICEiIyQlJicoKSor", "qRjVFR/rc2F0Iyuq4yLWjbU7gfXp4Q/DGpMPZib4fCVX65Nh4FEX4DaJC+A1YHGpjgeD++5MWBXsTl1tLctmsrlC7zHttZHz+QeASdoxZgixtQkmwZ7laqA94AY4f+uucTtcdPJwrN/r6MF/19T3MRj04y7+/ku1xhWSg9f6//ko/ab9TxM5YCdz6YWvPhY=" )
        }
    }
}
