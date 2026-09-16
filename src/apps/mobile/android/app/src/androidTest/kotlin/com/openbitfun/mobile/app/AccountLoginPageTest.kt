package com.openbitfun.mobile.app

import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.openbitfun.mobile.app.ui.account.AccountLoginPage
import com.openbitfun.mobile.app.ui.theme.OpenBitFunTheme
import com.openbitfun.mobile.core.feature.account.AccountUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AccountLoginPageTest {
    @get:Rule val rule = createComposeRule()
    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    @Test fun loginAutomaticallyOpensAuthorizationOnceWithoutAddingAButtonOrGrowingTheSheet() {
        val state = mutableStateOf<AccountUiState>(AccountUiState.SignedOut)
        val width = mutableStateOf(386.dp)
        val opened = mutableListOf<String>()
        rule.setContent {
            OpenBitFunTheme(dark = false) {
                AccountLoginPage(state.value, {}, { state.value = AccountUiState.SigningIn },
                    Modifier.requiredWidth(width.value).testTag("login-panel"), opened::add)
            }
        }
        rule.onNodeWithTag("login-panel").assertHeightIsEqualTo(280.dp)
        rule.onAllNodesWithText(text(R.string.account_login_title))[1].performClick()
        rule.onNodeWithText(text(R.string.account_signing_in)).assertIsNotEnabled()
        rule.runOnIdle { state.value = AccountUiState.Authorizing("https://github.com/login/oauth/authorize?state=first") }
        rule.waitForIdle()
        assertEquals(1, opened.size)
        rule.onNodeWithText(text(R.string.account_open_github)).assertDoesNotExist()
        rule.onNodeWithTag("login-panel").assertHeightIsEqualTo(280.dp)
        rule.runOnIdle { width.value = 560.dp }
        rule.waitForIdle()
        assertEquals(1, opened.size)
        rule.onNodeWithTag("login-panel").assertHeightIsEqualTo(280.dp)
        rule.runOnIdle { state.value = AccountUiState.Authorizing("https://github.com/login/oauth/authorize?state=second") }
        rule.waitForIdle()
        assertEquals(2, opened.size)
    }

    @Test fun browserFailureUsesTheExistingFooterToRetryTheSameAuthorization() {
        var attempts = 0
        rule.setContent {
            OpenBitFunTheme(dark = false) {
                AccountLoginPage(AccountUiState.Authorizing("https://github.com/login/oauth/authorize?state=retry"),
                    {}, { error("Must not start a second login transaction") }, Modifier.requiredWidth(386.dp),
                    openAuthorization = {
                        attempts++
                        if (attempts == 1) throw IllegalArgumentException("No browser activity")
                    })
            }
        }
        rule.onNodeWithText(text(R.string.account_authorization_open_failed)).assertIsDisplayed()
        rule.onNodeWithText(text(R.string.account_open_github)).assertDoesNotExist()
        rule.onNodeWithText(text(R.string.sessions_retry)).assertIsEnabled().performClick()
        rule.onNodeWithText(text(R.string.account_authorization_open_failed)).assertDoesNotExist()
        rule.onNodeWithText(text(R.string.account_signing_in)).assertIsNotEnabled()
        assertEquals(2, attempts)
    }
}
