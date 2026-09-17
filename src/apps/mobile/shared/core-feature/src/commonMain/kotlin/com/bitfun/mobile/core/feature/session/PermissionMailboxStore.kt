package com.bitfun.mobile.core.feature.session

import com.bitfun.mobile.core.protocol.*
import com.bitfun.mobile.core.transport.*
import kotlinx.coroutines.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

public data class PermissionMailboxRequest public constructor(
    public val requestId: String, public val action: String, public val resources: List<String>,
    public val toolCallId: String?, public val source: String,
)
public data class PermissionMailboxUiState public constructor(
    public val requests: List<PermissionMailboxRequest>, public val busy: Boolean, public val failed: Boolean,
    public val questions: List<ToolCard>,
) {
    public constructor(requests: List<PermissionMailboxRequest>, busy: Boolean, failed: Boolean) : this(requests, busy, failed, emptyList())
}
@Serializable
private data class MailboxResult(override val resp: String? = null, override val message: String? = null,
    val ok: Boolean = false, val value: JsonElement = JsonNull) : CommandStatus

/** The runtime owns permissions. Transcript tool identifiers are never reply identities. */
internal class PermissionMailboxStore(private val scope: CoroutineScope, private val transport: RemoteCommandTransport,
    private val publish: (PermissionMailboxUiState) -> Unit) {
    private var state = PermissionMailboxUiState(emptyList(), false, false)
    private var session: String? = null
    private var epoch = 0L
    private var refresh: Job? = null
    private var reply: Job? = null
    private var dirty = false
    private val interacting = mutableSetOf<String>()
    private fun update(next: PermissionMailboxUiState) { state = next; publish(next) }
    fun select(id: String?) {
        if (session == id) return
        epoch++; refresh?.cancel(); reply?.cancel(); refresh = null; reply = null; dirty = false; interacting.clear(); session = id
        update(PermissionMailboxUiState(emptyList(), false, false))
        if (id != null) invalidate()
    }
    private suspend fun invoke(command: String, args: JsonObject): JsonElement {
        val result = transport.send<MailboxResult>(RemoteCommand(cmd = "host_invoke", command = command, args = args))
        check(result.ok) { "Runtime permission request failed" }
        return result.value
    }
    fun invalidate() {
        val selected = session ?: return
        dirty = true
        if (refresh?.isActive == true) return
        val ticket = epoch
        refresh = scope.launch {
            try {
                while (dirty && ticket == epoch) {
                    dirty = false
                    val snapshot = invoke("get_session_interaction_mailbox", buildJsonObject { put("request", buildJsonObject { put("sessionId", selected) }) }).jsonObject
                    check(snapshot.getValue("sessionId").jsonPrimitive.content == selected) { "Interaction mailbox session mismatch" }
                    val value = snapshot.getValue("permissions").jsonObject.getValue("requests").jsonArray
                    val questions = snapshot.getValue("userQuestions").jsonObject.getValue("questions").jsonArray.map { it.jsonObject }
                        .filter { it["sessionId"]?.jsonPrimitive?.content == selected }.map {
                            toolCard(RemoteToolStatusResponse(id = it.getValue("toolId").jsonPrimitive.content, name = "AskUserQuestion", status = "running", toolInput = it.getValue("questions")))
                        }
                    val requests = value.map { it.jsonObject }.filter { it["sessionId"]?.jsonPrimitive?.content == selected }.map {
                        PermissionMailboxRequest(it.getValue("requestId").jsonPrimitive.content,
                            it.getValue("action").jsonPrimitive.content,
                            it["resources"]?.jsonArray?.map { item -> item.jsonPrimitive.content }.orEmpty(),
                            it["toolCallId"]?.jsonPrimitive?.contentOrNull,
                            (it["source"] as? JsonObject)?.get("identity")?.jsonPrimitive?.contentOrNull.orEmpty())
                    }
                    if (ticket == epoch) update(state.copy(requests = requests, questions = questions, failed = false))
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Throwable) { if (ticket == epoch) update(state.copy(failed = true)) }
        }
    }
    fun startQuestion(toolId: String) {
        val selected = session ?: return
        if (!interacting.add(toolId)) return
        val ticket = epoch
        scope.launch {
            if (ticket != epoch) return@launch
            try { transport.send<CommandStatusResponse>(RemoteCommand(cmd = "start_question_interaction", sessionId = selected, toolId = toolId)) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Throwable) { if (ticket == epoch) { interacting.remove(toolId); update(state.copy(failed = true)) } }
        }
    }
    fun respond(requestId: String, approve: Boolean, updatedInput: String?) {
        if (state.busy || state.requests.none { it.requestId == requestId }) return
        val ticket = epoch
        update(state.copy(busy = true, failed = false))
        reply = scope.launch {
            try {
                val patch = updatedInput?.let { Json.parseToJsonElement(it) as? JsonObject ?: error("Input must be an object") }
                invoke("respond_permission", buildJsonObject { put("request", buildJsonObject {
                    put("requestId", requestId); put("reply", if (approve) "once" else "reject")
                    if (approve && patch != null) put("updatedInput", patch)
                }) })
                if (ticket == epoch) invalidate()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Throwable) { if (ticket == epoch) update(state.copy(failed = true)) }
            finally { if (ticket == epoch) update(state.copy(busy = false)) }
        }
    }
}
