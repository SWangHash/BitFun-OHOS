package com.openbitfun.mobile.core.persistence

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.openbitfun.mobile.core.persistence.db.MobileDatabase
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class RelayStreamStoreTest {
    @Test fun partialEventAndCursorSurviveStoreRecreationWithoutCrossAccountLeak() = runTest {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        MobileDatabase.Schema.create(driver).await()
        val first = SqlDelightRelayStreamStore(driver)
        first.commit("account-a/device/terminal", listOf(PersistedRelayFragment("event", 0, "encrypted-first")), 1)
        val reopened = SqlDelightRelayStreamStore(driver)
        assertEquals(1, reopened.cursor("account-a/device/terminal"))
        assertEquals(listOf("encrypted-first"), reopened.fragments("account-a/device/terminal", "event"))
        assertEquals(0, reopened.cursor("account-b/device/terminal"))
        reopened.commit("account-a/device/terminal", listOf(PersistedRelayFragment("event", 1, "encrypted-second")), 2)
        assertEquals(listOf("encrypted-first", "encrypted-second"), first.fragments("account-a/device/terminal", "event"))
        assertEquals(2, first.cursor("account-a/device/terminal"))
        driver.close()
    }
}
