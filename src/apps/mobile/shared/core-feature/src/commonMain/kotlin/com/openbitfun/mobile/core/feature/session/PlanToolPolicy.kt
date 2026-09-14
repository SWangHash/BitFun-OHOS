package com.openbitfun.mobile.core.feature.session

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

public data class PlanToolDescriptor(public val path: String, public val name: String, public val overview: String)

/** Recognizes both legacy CreatePlan and modern plan-file writes without host path semantics. */
public object PlanToolPolicy {
    public fun descriptor(name: String, input: String, fallbackPath: String): PlanToolDescriptor? {
        val fields = runCatching { Json.parseToJsonElement(input) as? JsonObject }.getOrNull()
        fun value(key: String): String = (fields?.get(key) as? JsonPrimitive)?.content.orEmpty()
        val path = listOf("plan_file_path", "file_path", "filePath", "path").map(::value)
            .firstOrNull { it.isNotBlank() } ?: fallbackPath
        val normalized = name.filterNot { it.isWhitespace() || it == '_' || it == '-' }.lowercase()
        if (normalized != "createplan" &&
            !(normalized in setOf("write", "writefile", "createfile") && path.lowercase().endsWith(".plan.md"))) return null
        val file = path.replace('\\', '/').substringAfterLast('/')
        val title = value("name").ifBlank { value("title") }.ifBlank {
            if (file.lowercase().endsWith(".plan.md")) file.dropLast(8) else file
        }
        return PlanToolDescriptor(path, title, value("overview"))
    }
}
