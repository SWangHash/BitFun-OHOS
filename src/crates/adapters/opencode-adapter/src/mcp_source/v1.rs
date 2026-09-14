//! V1 keeps server names directly under `mcp` and recursively merges entries.
use super::*;

pub(super) fn servers(value: &Value) -> Result<BTreeMap<String, Value>, String> {
    match value.get("mcp") {
        None => Ok(BTreeMap::new()),
        Some(Value::Object(servers)) => Ok(servers.clone().into_iter().collect()),
        _ => Err("OpenCode V1 mcp must be an object".into()),
    }
}

pub(super) fn merge(current: &mut Value, patch: Value) {
    super::deep_merge(current, patch);
}
