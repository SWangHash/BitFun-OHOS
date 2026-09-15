package com.openbitfun.mobile.app.viewmodel

import android.util.AtomicFile
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.openbitfun.mobile.core.feature.session.ComposerImage
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Native image bytes stay off saved-state Bundles and outside cloud backups. */
internal class ComposerAttachmentsViewModel : ViewModel() {
    private val drafts = mutableMapOf<String, AttachmentDraft>()

    fun forSession(owner: String, directory: File): AttachmentDraft = drafts.getOrPut(owner) {
        val name = MessageDigest.getInstance("SHA-256").digest(owner.toByteArray()).joinToString("") { "%02x".format(it) }
        AttachmentDraft(AtomicFile(File(directory, "$name.json"))).also { it.restore() }
    }

    inner class AttachmentDraft internal constructor(private val file: AtomicFile) {
        private val state = mutableStateOf<List<ComposerImage>>(emptyList())
        private val mutex = Mutex()
        val loading = mutableStateOf(true)
        val saving = mutableStateOf(false)
        val failed = mutableStateOf(false)
        private var loaded = false
        @Volatile private var revision = 0
        val images: MutableState<List<ComposerImage>> = object : MutableState<List<ComposerImage>> {
            override var value: List<ComposerImage>
                get() = state.value
                set(value) {
                    if (!loaded || value == state.value) return
                    state.value = value.toList()
                    persist()
                }
            override fun component1() = value
            override fun component2(): (List<ComposerImage>) -> Unit = { value = it }
        }

        fun retry() { if (loaded) persist() else restore() }

        internal fun restore() {
            loading.value = true
            failed.value = false
            viewModelScope.launch {
                try {
                    val restored = withContext(Dispatchers.IO) {
                        mutex.withLock {
                            if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) emptyList() else {
                                val document = JSONObject(file.openRead().bufferedReader().use { it.readText() })
                                require(document.optInt("version", 1) == 1) { "Unsupported attachment draft version" }
                                val items = document.getJSONArray("images")
                                List(items.length()) { index ->
                                    val item = items.getJSONObject(index)
                                    ComposerImage(item.getString("id"), item.getString("dataUrl"), item.getString("mimeType"))
                                }
                            }
                        }
                    }
                    state.value = restored
                    loaded = true
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // Retain unreadable data; retry must never replace it with an empty draft.
                    failed.value = true
                } finally { loading.value = false }
            }
        }

        private fun persist() {
            val requestedRevision = ++revision
            val snapshot = state.value
            saving.value = true
            failed.value = false
            viewModelScope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        mutex.withLock {
                            if (requestedRevision != revision) return@withLock
                            val items = JSONArray()
                            snapshot.forEach { image ->
                                items.put(JSONObject().put("id", image.id).put("dataUrl", image.dataUrl).put("mimeType", image.mimeType))
                            }
                            val bytes = JSONObject().put("version", 1).put("images", items).toString().toByteArray()
                            val stream = file.startWrite()
                            try { stream.write(bytes); file.finishWrite(stream) }
                            catch (error: Exception) { file.failWrite(stream); throw error }
                        }
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    if (requestedRevision == revision) failed.value = true
                } finally {
                    if (requestedRevision == revision) saving.value = false
                }
            }
        }
    }
}
