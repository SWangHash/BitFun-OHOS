package com.bitfun.mobile.app.platform

import android.content.Context

/** Installation-local presentation state; account changes and upgrades do not reset it. */
internal object StartupRevealPreference {
    @Synchronized
    fun claim(context: Context): Boolean {
        val preferences = context.getSharedPreferences("startup_presentation", Context.MODE_PRIVATE)
        if (preferences.getBoolean("brand_reveal_shown", false)) return false
        // Claim before playback, including when the first reveal is interrupted.
        preferences.edit().putBoolean("brand_reveal_shown", true).apply()
        return true
    }
}
