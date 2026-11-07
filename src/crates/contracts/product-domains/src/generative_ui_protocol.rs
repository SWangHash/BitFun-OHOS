//! Assembly for the single GenUI source protocol.
//!
//! A generation is an ordered source document followed by optional state
//! values. The former graph protocol was deliberately removed: accepting it
//! here would keep the old renderer and its failure modes alive.
use super::generative_ui::{
    canonicalize_app_identities, catalog, safe, validate, validate_generation, validate_state,
};
use serde_json::{json, Map, Value};

pub fn assemble(input: &Value) -> Result<(Value, Value), String> {
    // Some Anthropic-compatible tool bridges serialize deeply nested array
    // arguments as a JSON string. Accept that wire-level representation at
    // this boundary, then validate and assemble the canonical array shape.
    let mut normalized_input = input.clone();
    let mut messages = match input.get("messages") {
        Some(Value::Array(messages)) => messages.clone(),
        Some(Value::String(serialized)) => serde_json::from_str::<Value>(serialized)
            .ok()
            .and_then(|value| value.as_array().cloned())
            .ok_or("generation.messages must be an array")?,
        _ => return Err("generation.messages must be an array".into()),
    };
    for message in &mut messages {
        if let Some(surface) = message.get_mut("createSurface") {
            *surface = canonicalize_app_identities(surface);
        }
    }
    normalized_input["messages"] = Value::Array(messages.clone());
    if normalized_input
        .get("protocol")
        .and_then(Value::as_str)
        .is_some_and(|protocol| {
            catalog()["legacyProtocols"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(protocol)))
        })
    {
        normalized_input["protocol"] = Value::String(catalog()["protocol"].as_str().unwrap_or("bitfun.genui.v1").to_owned());
    }
    if messages.iter().any(|message| {
        message.get("updateComponents").is_some() || message.get("updateLogic").is_some()
    }) {
        return Err("GenUI graph messages were removed; send a complete source document in createSurface.source".into());
    }
    validate(&catalog()["generation"], &normalized_input, "generation")?;
    let first = messages
        .first()
        .ok_or("generation.messages: createSurface is required")?;
    let surface = first
        .get("createSurface")
        .ok_or("generation.messages[0]: createSurface is required and must be first")?;
    if messages
        .iter()
        .skip(1)
        .any(|message| message.get("createSurface").is_some())
    {
        return Err("generation.messages: createSurface may occur only once".into());
    }
    surface["template"]
        .as_str()
        .ok_or("generation.messages[0].createSurface.template is required")?;
    let source = surface
        .get("source")
        .ok_or("generation.messages[0].createSurface.source is required")?;
    if !matches!(
        source["kind"].as_str(),
        Some("openui-lang" | "html-document")
    ) {
        return Err("createSurface.source.kind must be openui-lang or html-document".into());
    }
    let mut document = json!({"schemaVersion": 2, "state": {}});
    document
        .as_object_mut()
        .unwrap()
        .extend(surface.as_object().unwrap().clone());
    let mut values = Map::new();
    for (index, message) in messages.iter().enumerate().skip(1) {
        let update = message.get("updateDataModel").ok_or_else(|| {
            format!("generation.messages[{index}]: only updateDataModel is supported after createSurface")
        })?;
        for field in ["state", "values"] {
            if let Some(fields) = update[field].as_object() {
                if fields.keys().any(|key| !safe(key)) {
                    return Err(format!(
                        "generation.messages[{index}].updateDataModel: reserved state ID"
                    ));
                }
                if field == "state" {
                    document["state"]
                        .as_object_mut()
                        .unwrap()
                        .extend(fields.clone());
                } else {
                    values.extend(fields.clone());
                }
            }
        }
    }
    validate_generation(&document)?;
    let state = Value::Object(values);
    validate_state(&document, Some(&state))?;
    Ok((document, state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assembles_source_and_values() {
        let input = json!({"protocol":"bitfun.genui.v1","messages":[
            {"createSurface":{"id":"a","title":"A","template":"bitfun.app","libraryId":"bitfun.composable.v1","libraryRevision":2,"designSpec":{"id":"bitfun.desktop.v1","revision":1},"source":{"kind":"openui-lang","content":"root = Col([])"}}},
            {"updateDataModel":{"values":{"name":"Ada"}}}
        ]});
        let (app, state) = assemble(&input).unwrap();
        assert_eq!(app["source"]["kind"], "openui-lang");
        assert!(app.get("nodes").is_none());
        assert_eq!(state, json!({"name":"Ada"}));
    }

    #[test]
    fn accepts_legacy_protocol_and_identities_then_emits_canonical_app() {
        let input = json!({"protocol":"openbitfun.genui.v1","messages":[
            {"createSurface":{"id":"a","title":"A","template":"openbitfun.app","libraryId":"openbitfun.composable.v1","libraryRevision":2,"designSpec":{"id":"openbitfun.desktop.v1","revision":1},"source":{"kind":"openui-lang","content":"root = Col([])"}}}
        ]});
        let (app, state) = assemble(&input).unwrap();
        assert_eq!(app["template"], "bitfun.app");
        assert_eq!(app["libraryId"], "bitfun.composable.v1");
        assert_eq!(app["designSpec"]["id"], "bitfun.desktop.v1");
        assert_eq!(state, json!({}));
    }

    #[test]
    fn rejects_graph_messages() {
        let input = json!({"protocol":"bitfun.genui.v1","messages":[
            {"createSurface":{"id":"a","title":"A","template":"bitfun.app","libraryId":"bitfun.composable.v1","libraryRevision":2,"designSpec":{"id":"bitfun.desktop.v1","revision":1},"source":{"kind":"openui-lang","content":"root = Col([])"}}},
            {"updateComponents":{"components":[]}}
        ]});
        let error = assemble(&input).unwrap_err();
        assert!(error.contains("graph messages were removed"));
    }

    #[test]
    fn accepts_stringified_messages_from_compatible_tool_bridges() {
        let messages = json!([
            {"createSurface": {
                "id":"a", "title":"A", "template":"bitfun.app",
                "libraryId":"bitfun.composable.v1", "libraryRevision":2,
                "designSpec":{"id":"bitfun.desktop.v1","revision":1},
                "source":{"kind":"openui-lang","content":"root = Col([])"}
            }}
        ]);
        let input = json!({
            "protocol":"bitfun.genui.v1",
            "messages": serde_json::to_string(&messages).unwrap(),
        });
        let (app, state) = assemble(&input).unwrap();
        assert_eq!(app["source"]["kind"], "openui-lang");
        assert_eq!(state, json!({}));
    }
}
