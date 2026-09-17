package com.bitfun.mobile.app

import android.os.Bundle
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.bitfun.mobile.app.ui.shell.StartupBrandReveal
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.bitfun.mobile.app.ui.shell.MobileScreen
import com.bitfun.mobile.app.platform.AppLocaleController
import com.bitfun.mobile.app.ui.preview.MobileDesignGallery
import com.bitfun.mobile.app.ui.preview.mobileDesignScenario
import com.bitfun.mobile.app.ui.theme.BitFunTheme
import com.bitfun.mobile.app.viewmodel.AppSettingsViewModel
import com.bitfun.mobile.app.viewmodel.AppThemeMode

class MainActivity : ComponentActivity() {
    private var showStartupBrand by mutableStateOf(true)
    override fun onCreate(savedInstanceState: Bundle?) {
        AppLocaleController.applySaved(this)
        super.onCreate(savedInstanceState)
        showStartupBrand = savedInstanceState == null
        enableEdgeToEdge()
        setContent {
            if (intent.getBooleanExtra(DESIGN_PREVIEW_EXTRA, false)) {
                val scenario = mobileDesignScenario(intent.getStringExtra(DESIGN_SCENARIO_EXTRA))
                MobileDesignGallery(scenario = scenario, dark = scenario.appearance == "dark")
                return@setContent
            }
            val settings: AppSettingsViewModel = viewModel(factory = AppSettingsViewModel.Factory)
            val theme by settings.theme.collectAsStateWithLifecycle()
            val dark = when (theme) {
                AppThemeMode.SYSTEM -> isSystemInDarkTheme()
                AppThemeMode.LIGHT -> false
                AppThemeMode.DARK -> true
            }
            BitFunTheme(dark = dark) {
                Box {
                    MobileScreen()
                    if (showStartupBrand) StartupBrandReveal { showStartupBrand = false }
                }
                if (!showStartupBrand) com.bitfun.mobile.app.ui.shell.NotificationOnboarding()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (!intent.getBooleanExtra(DESIGN_PREVIEW_EXTRA, false)) accountModel().setBackground(false)
    }

    override fun onStop() {
        showStartupBrand = false
        if (!intent.getBooleanExtra(DESIGN_PREVIEW_EXTRA, false)) accountModel().setBackground(true)
        super.onStop()
    }

    private fun accountModel() = androidx.lifecycle.ViewModelProvider(this,
        com.bitfun.mobile.app.viewmodel.AccountViewModel.Factory)[com.bitfun.mobile.app.viewmodel.AccountViewModel::class.java]

    private companion object {
        const val DESIGN_PREVIEW_EXTRA = "bitfun.design_preview"
        const val DESIGN_SCENARIO_EXTRA = "bitfun.design_scenario"
    }
}
