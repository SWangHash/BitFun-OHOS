//! Request translation for subscription models carried by Code Assist.

use crate::types::ReasoningPresetAction;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

pub(crate) const EMPTY_PARAMETER_NAME: &str = "_bitfun_no_args";
const DEFAULT_THINKING_BUDGET: u32 = 8192;

fn is_gemini_3(model: &str) -> bool {
    model.starts_with("gemini-3-") || model.starts_with("gemini-3.")
}

pub(super) fn compile_reasoning_action(
    action: &ReasoningPresetAction,
    body: &mut Value,
    model: &str,
    max_tokens: Option<u32>,
) -> Result<Option<bool>> {
    let model = model.to_ascii_lowercase();
    let config = if is_gemini_3(&model) {
        match action {
            ReasoningPresetAction::Effort { value } => json!({
                "includeThoughts": true, "thinkingLevel": value.trim().to_ascii_uppercase()
            }),
            _ => return Ok(None),
        }
    } else if model.starts_with("claude-") && model.contains("thinking") {
        match action {
            ReasoningPresetAction::BudgetTokens { value } => claude_thinking(*value, max_tokens)?,
            ReasoningPresetAction::Toggle { enabled: true } => {
                let budget = max_tokens
                    .map(|limit| DEFAULT_THINKING_BUDGET.min(limit / 2))
                    .unwrap_or(DEFAULT_THINKING_BUDGET);
                claude_thinking(budget, max_tokens)?
            }
            ReasoningPresetAction::Toggle { enabled: false } => json!({"include_thoughts": false}),
            ReasoningPresetAction::Effort { value } => {
                let budget = match value.trim().to_ascii_lowercase().as_str() {
                    "low" => 8192,
                    "medium" => 16384,
                    "high" => 32768,
                    _ => return Ok(Some(false)),
                };
                // Effort is relative; keep an explicitly configured output limit.
                let budget = max_tokens
                    .map(|limit| budget.min(limit / 2))
                    .unwrap_or(budget);
                claude_thinking(budget, max_tokens)?
            }
            _ => return Ok(None),
        }
    } else {
        return Ok(None);
    };
    if !body["generationConfig"].is_object() {
        body["generationConfig"] = json!({});
    }
    body["generationConfig"]["thinkingConfig"] = config;
    Ok(Some(true))
}

fn claude_thinking(budget: u32, max_tokens: Option<u32>) -> Result<Value> {
    if budget == 0 || max_tokens.is_some_and(|limit| budget >= limit) {
        return Err(anyhow!(
            "Claude thinking budget must be positive and below max output tokens"
        ));
    }
    Ok(json!({"include_thoughts": true, "thinking_budget": budget}))
}

/// Return names whose transport-only placeholder must be removed from tool calls.
pub(super) fn prepare_request(model: &str, body: &mut Value) -> Result<Vec<String>> {
    let model = model.to_ascii_lowercase();
    let mut empty_tools = Vec::new();
    if is_gemini_3(&model) {
        if body["generationConfig"]["thinkingConfig"].is_null() {
            if let Some(level) = ["low", "medium", "high", "minimal"]
                .into_iter()
                .find(|level| model.ends_with(&format!("-{level}")))
            {
                if !body["generationConfig"].is_object() {
                    body["generationConfig"] = json!({});
                }
                body["generationConfig"]["thinkingConfig"] = json!({
                    "includeThoughts": true, "thinkingLevel": level.to_ascii_uppercase()
                });
            }
        }
        return Ok(empty_tools);
    }
    if !model.starts_with("claude-") {
        return Ok(empty_tools);
    }

    if model == "claude-sonnet-4-6" {
        if let Some(config) = body["generationConfig"].as_object_mut() {
            config.remove("thinkingConfig");
        }
    } else {
        if model.contains("thinking") && body["generationConfig"]["thinkingConfig"].is_null() {
            if !body["generationConfig"].is_object() {
                body["generationConfig"] = json!({});
            }
            let budget = body["generationConfig"]["maxOutputTokens"]
                .as_u64()
                .map(|limit| (DEFAULT_THINKING_BUDGET as u64).min(limit / 2))
                .unwrap_or(DEFAULT_THINKING_BUDGET as u64);
            body["generationConfig"]["thinkingConfig"] =
                json!({"include_thoughts": true, "thinking_budget": budget});
        }
        if let Some(config) = body["generationConfig"]["thinkingConfig"].as_object_mut() {
            if let Some(value) = config.remove("includeThoughts") {
                config.entry("include_thoughts").or_insert(value);
            }
            if let Some(value) = config.remove("thinkingBudget") {
                config.entry("thinking_budget").or_insert(value);
            }
        }
        if let Some(budget) = body["generationConfig"]["thinkingConfig"]["thinking_budget"].as_u64()
        {
            if budget == 0 {
                return Err(anyhow!("Claude thinking budget must be positive"));
            }
            if let Some(limit) = body["generationConfig"]["maxOutputTokens"].as_u64() {
                if budget >= limit {
                    return Err(anyhow!(
                        "Claude thinking budget must be below max output tokens"
                    ));
                }
            } else {
                let limit =
                    64_000.max(budget.checked_add(1).ok_or_else(|| {
                        anyhow!("Claude thinking budget leaves no room for output")
                    })?);
                body["generationConfig"]["maxOutputTokens"] = json!(limit);
            }
        }
    }

    if let Some(tools) = body["tools"].as_array_mut() {
        for tool in tools {
            if let Some(declarations) = tool["functionDeclarations"].as_array_mut() {
                for declaration in declarations {
                    let key = if declaration.get("parametersJsonSchema").is_some() {
                        "parametersJsonSchema"
                    } else {
                        "parameters"
                    };
                    let schema = &mut declaration[key];
                    if schema["type"] == "object"
                        && schema["properties"]
                            .as_object()
                            .is_none_or(|properties| properties.is_empty())
                    {
                        schema["properties"] = json!({EMPTY_PARAMETER_NAME: {
                            "type": "boolean", "description": "Reserved transport field for a tool without parameters; omit it."
                        }});
                        if let Some(name) = declaration["name"].as_str() {
                            empty_tools.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
    if body["tools"].as_array().is_some_and(|tools| {
        tools
            .iter()
            .any(|tool| tool["functionDeclarations"].is_array())
    }) {
        if !body["toolConfig"].is_object() {
            body["toolConfig"] = json!({});
        }
        if !body["toolConfig"]["functionCallingConfig"].is_object() {
            body["toolConfig"]["functionCallingConfig"] = json!({});
        }
        body["toolConfig"]["functionCallingConfig"]["mode"] = json!("VALIDATED");
    }
    Ok(empty_tools)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_model_specific_thinking_without_mutating_unknown_wire_ids() {
        let mut gemini = json!({"contents": []});
        prepare_request("gemini-3.1-pro-high", &mut gemini).unwrap();
        assert_eq!(
            gemini["generationConfig"]["thinkingConfig"]["thinkingLevel"],
            "HIGH"
        );
        let mut unknown = json!({"contents": []});
        prepare_request("future-model-medium", &mut unknown).unwrap();
        assert_eq!(unknown, json!({"contents": []}));
        let mut claude = json!({"generationConfig": {"maxOutputTokens": 16384,
            "thinkingConfig": {"includeThoughts": true, "thinkingBudget": 4096}}});
        prepare_request("claude-opus-4-6-thinking", &mut claude).unwrap();
        assert_eq!(
            claude["generationConfig"]["thinkingConfig"],
            json!({"include_thoughts": true, "thinking_budget": 4096})
        );
        assert_eq!(claude["generationConfig"]["maxOutputTokens"], 16384);
        prepare_request("claude-sonnet-4-6", &mut claude).unwrap();
        assert!(claude["generationConfig"].get("thinkingConfig").is_none());
    }

    #[test]
    fn claude_empty_tool_placeholder_is_optional_and_normal_tools_keep_their_contract() {
        let normal = json!({"name": "read", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}});
        let mut body = json!({"toolConfig": {"functionCallingConfig": {"mode": "AUTO", "allowedFunctionNames": ["list", "read"]}}, "tools": [{"functionDeclarations": [
            {"name": "list", "parameters": {"type": "object", "properties": {}, "additionalProperties": false}}, normal.clone()
        ]}]});
        assert_eq!(
            prepare_request("claude-sonnet-4-6", &mut body).unwrap(),
            ["list"]
        );
        let schema = &body["tools"][0]["functionDeclarations"][0]["parameters"];
        assert!(schema.get("required").is_none());
        assert_eq!(
            schema["properties"][EMPTY_PARAMETER_NAME]["type"],
            "boolean"
        );
        assert_eq!(body["tools"][0]["functionDeclarations"][1], normal);
        assert_eq!(
            body["toolConfig"]["functionCallingConfig"]["allowedFunctionNames"],
            json!(["list", "read"])
        );
        assert_eq!(
            body["toolConfig"]["functionCallingConfig"]["mode"],
            "VALIDATED"
        );
    }
}
