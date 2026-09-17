//! Shared persisted configuration records and live provider interface.

use crate::util::errors::BitFunResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
pub use bitfun_config_contracts::*;

/// Status of a local model (downloaded, undownloaded, downloading, paused, or failed).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum LocalModelStatus {
    Downloaded,
    #[default]
    Undownloaded,
    Downloading,
    Paused,
    Failed,
}

/// Details of a local model (format, family, parameter size, quantization level).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelDetails {
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub families: Vec<String>,
    #[serde(default)]
    pub parameter_size: String,
    #[serde(default)]
    pub quantization_level: String,
}

/// A local model entry returned by the local model service.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub model_type: String,
    #[serde(default)]
    pub status: LocalModelStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed: Option<u64>,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub details: LocalModelDetails,
}

/// Status of the local model service (availability, port, model list).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalServiceStatus {
    pub available: bool,
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default)]
    pub models: Vec<LocalModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelPullProgress {
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub completed: u64,
}

/// Configuration provider interface.
#[async_trait]
pub trait ConfigProvider: Send + Sync {
    /// Provider name.
    fn name(&self) -> &str;

    /// Returns the default configuration.
    fn get_default_config(&self) -> serde_json::Value;

    /// Validates configuration.
    async fn validate_config(&self, config: &serde_json::Value) -> BitFunResult<Vec<String>>;

    /// Called when configuration changes.
    async fn on_config_changed(
        &self,
        old_config: &serde_json::Value,
        new_config: &serde_json::Value,
    ) -> BitFunResult<()>;
}
