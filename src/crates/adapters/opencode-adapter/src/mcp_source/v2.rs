//! V2 has an explicit server collection, whole-entry replacement and three timers.
use super::*;

pub(super) fn matches(value: &Value) -> bool {
    let Some(mcp) = value.get("mcp").and_then(Value::as_object) else {
        return false;
    };
    // V1 permits a server literally named `servers` (or `timeout`).
    ["servers", "timeout"].iter().any(|key| {
        mcp.get(*key).is_some_and(|entry| {
            !entry.get("type").is_some_and(Value::is_string)
                && !entry.get("command").is_some_and(Value::is_array)
                && !entry.get("url").is_some_and(Value::is_string)
                && !entry.get("enabled").is_some_and(Value::is_boolean)
        })
    })
}

pub(super) fn parse(value: &Value) -> Result<(BTreeMap<String, Value>, Value), String> {
    let mcp = value
        .get("mcp")
        .and_then(Value::as_object)
        .ok_or("OpenCode V2 mcp must be an object")?;
    if mcp
        .keys()
        .any(|key| !["servers", "timeout"].contains(&key.as_str()))
    {
        return Err("OpenCode V2 mcp accepts only servers and timeout; mixed V1/V2 declarations are unsupported".into());
    }
    let servers = match mcp.get("servers") {
        None => BTreeMap::new(),
        Some(Value::Object(servers)) => servers.clone().into_iter().collect(),
        _ => return Err("OpenCode V2 mcp.servers must be an object".into()),
    };
    let timeout = mcp
        .get("timeout")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    validate_timeout(&timeout)?;
    Ok((servers, timeout))
}

fn validate_timeout(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or("OpenCode V2 timeout must be an object")?;
    if object.iter().any(|(key, value)| {
        !["startup", "catalog", "execution"].contains(&key.as_str())
            || !value
                .as_u64()
                .is_some_and(|n| (1..=MAX_EXTERNAL_MCP_TIMEOUT_MS).contains(&n))
    }) {
        return Err("OpenCode V2 timeouts require positive bounded integer startup, catalog and execution milliseconds".into());
    }
    Ok(())
}

pub(super) fn materialize(
    context: &ExternalSourceContext,
    revision_key: &openbitfun_product_domains::external_sources::ExternalMcpRevisionKey,
    source: SourceKey,
    provenance: Vec<SourceKey>,
    name: String,
    value: Value,
    defaults: &Value,
) -> Result<MaterializedServer, ExternalSourceProviderError> {
    let mut normalized = value.clone();
    let mut reason = None;
    let mut timers = serde_json::json!({"startup": 30000, "catalog": 30000, "execution": 43200000});
    deep_merge(&mut timers, defaults.clone());
    if let Some(object) = normalized.as_object_mut() {
        if !matches!(
            object.get("type").and_then(Value::as_str),
            Some("local" | "remote")
        ) {
            reason = Some("OpenCode V2 server requires type local or remote".to_string());
        }
        if object.contains_key("enabled") {
            reason = Some("OpenCode V2 uses disabled, not enabled".to_string());
        }
        if let Some(disabled) = object.remove("disabled") {
            match disabled.as_bool() {
                Some(disabled) => {
                    object.insert("enabled".into(), Value::Bool(!disabled));
                }
                None => {
                    reason = Some("OpenCode V2 disabled must be a boolean".into());
                }
            }
        }
        if object
            .remove("codemode")
            .is_some_and(|value| !value.is_boolean())
        {
            reason = Some("OpenCode V2 codemode must be a boolean".into());
        }
        if let Some(timeout) = object.remove("timeout") {
            match validate_timeout(&timeout) {
                Ok(()) => deep_merge(&mut timers, timeout),
                Err(error) => {
                    reason = Some(error);
                }
            }
        }
    }
    let mut server = super::materialize_server(
        context,
        revision_key,
        source,
        provenance,
        name.clone(),
        normalized,
    )?;
    server.definition.timeouts = ExternalMcpTimeouts {
        startup_ms: timers["startup"].as_u64(),
        catalog_ms: timers["catalog"].as_u64(),
        execution_ms: timers["execution"].as_u64(),
    };
    let encoded = serde_json::to_vec(&(value, defaults)).expect("JSON values serialize");
    server.definition.behavior_version = revision_key.opaque_revision(
        "opencode.mcp.behavior.v2",
        [name.as_bytes(), encoded.as_slice()],
    );
    if let Some(reason) = reason {
        server.definition.static_status = ExternalMcpStaticStatus::Unsupported { reason };
    }
    Ok(server)
}
