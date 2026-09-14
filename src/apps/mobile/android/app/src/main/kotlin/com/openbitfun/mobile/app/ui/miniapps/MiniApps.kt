package com.openbitfun.mobile.app.ui.miniapps

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.openbitfun.mobile.app.R
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** Local, bundled tools remain available without an account or a connected host. */
@Composable
internal fun MiniAppsButton() {
    var open by rememberSaveable { mutableStateOf(false) }
    TextButton(onClick = { open = true }) { Text(stringResource(R.string.miniapps_title)) }
    if (open) MiniAppsDialog { open = false }
}

@Composable
private fun MiniAppsDialog(onClose: () -> Unit) {
    val context = LocalContext.current
    val locale = if (LocalConfiguration.current.locales[0].language == "zh") "zh-CN" else "en-US"
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    val catalog = remember {
        org.json.JSONArray(context.assets.open("miniapps/catalog.json").bufferedReader().use { it.readText() })
    }
    Dialog(onDismissRequest = { if (selected != null) selected = null else onClose() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().systemBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(stringResource(R.string.miniapps_title), style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = { if (selected != null) selected = null else onClose() }) {
                        Text(stringResource(if (selected == null) R.string.miniapps_close else R.string.miniapps_back))
                    }
                }
                if (selected == null) {
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        for (index in 0 until catalog.length()) {
                            val app = catalog.getJSONObject(index)
                            val copy = app.getJSONObject("locales").getJSONObject(locale)
                            OutlinedCard(onClick = { selected = app.getString("id") }, modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(20.dp)) {
                                    Text(copy.getString("name"), style = MaterialTheme.typography.titleMedium)
                                    Text(copy.getString("description"), style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                } else {
                    key(selected, locale) { MiniAppWebView(selected!!, locale, Modifier.weight(1f)) }
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun MiniAppWebView(appId: String, locale: String, modifier: Modifier) {
    AndroidView(modifier = modifier.fillMaxWidth(), factory = { context ->
        WebView(context).apply {
            // A wrap-content WebView gives a percentage-height iframe a zero-height viewport.
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return request.url.scheme !in setOf("blob", "about")
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    // Blob frames contain only bundled bytes. No app can request a network resource.
                    if (request.url.scheme == "blob" || request.url.scheme == "data") return null
                    return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                }
            }
            addJavascriptInterface(BuiltinMiniAppBridge(context, appId) { reply ->
                post { evaluateJavascript("window.__miniappReply($reply)", null) }
            }, "miniappNative")
            val html = context.assets.open("miniapps/$appId.$locale.html").bufferedReader().use { it.readText() }
            loadDataWithBaseURL("https://miniapp.local/", html, "text/html", "UTF-8", null)
        }
    }, onRelease = { view ->
        view.removeJavascriptInterface("miniappNative")
        view.stopLoading()
        view.destroy()
    })
}

/** Per-app key allowlist; unparseable persisted JSON is retained and reported, never reset. */
internal class BuiltinMiniAppBridge(private val context: Context, private val appId: String, private val reply: (String) -> Unit) {
    @JavascriptInterface
    @Synchronized
    fun request(raw: String) {
        val request = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val id = request.optString("id")
        if (id.isEmpty()) return
        val response = JSONObject().put("id", id)
        try {
            val params = request.getJSONObject("params")
            val method = request.getString("method")
            val key = params.optString("key")
            val allowedKey = when (appId) {
                "builtin-gomoku" -> "stats"
                "builtin-regex-playground" -> "regex-state"
                "builtin-daily-divination" -> "lastReading"
                else -> error("Unsupported MiniApp")
            }
            val result = when (method) {
                "clipboard.writeText" -> {
                    val text = params.getString("text")
                    android.os.Handler(context.mainLooper).post {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("", text))
                    }
                    JSONObject.NULL
                }
                "storage.get", "storage.set" -> {
                    require(key == allowedKey) { "Unsupported storage key" }
                    val store = context.getSharedPreferences("miniapps-$appId", Context.MODE_PRIVATE)
                    if (method == "storage.get") {
                        store.getString(key, null)?.let { JSONObject(it).get("value") } ?: JSONObject.NULL
                    } else {
                        val encoded = JSONObject().put("value", params.opt("value") ?: JSONObject.NULL).toString()
                        // Store an envelope so scalar/null values retain valid JSON too.
                        check(store.edit().putString(key, encoded).commit()) { "Unable to save MiniApp data" }
                        JSONObject.NULL
                    }
                }
                else -> error("Unsupported capability")
            }
            response.put("result", result)
        } catch (error: Exception) {
            response.put("error", JSONObject().put("message", error.message ?: "MiniApp operation failed"))
        }
        reply(response.toString())
    }
}
