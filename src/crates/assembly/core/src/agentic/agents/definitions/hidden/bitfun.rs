use crate::agentic::agents::{Agent, UserContextPolicy};
use async_trait::async_trait;

pub struct BitFunAgent;

#[async_trait]
impl Agent for BitFunAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn id(&self) -> &str {
        "BitFun"
    }
    fn name(&self) -> &str {
        "BitFun"
    }
    fn description(&self) -> &str {
        "The persistent BitFun product-control assistant"
    }
    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "bitfun_agent"
    }
    fn default_tools(&self) -> Vec<String> {
        vec![
            "BitFunControl".into(),
            "GetToolSpec".into(),
            "AskUserQuestion".into(),
        ]
    }
    fn user_context_policy(&self) -> UserContextPolicy {
        UserContextPolicy::empty()
    }
    fn is_readonly(&self) -> bool {
        false
    }
}
