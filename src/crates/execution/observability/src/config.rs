use crate::TelemetryLevel;
use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};

pub const TELEMETRY_USER_CONFIG_VERSION: u16 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TelemetryUserConfigV1 {
    pub version: u16,
    pub level: TelemetryLevel,
}

impl TelemetryUserConfigV1 {
    pub const fn new(level: TelemetryLevel) -> Self {
        Self { version: 1, level }
    }
}

impl Default for TelemetryUserConfigV1 {
    fn default() -> Self {
        Self::new(TelemetryLevel::Off)
    }
}

/// Persisted consent contract. Debug is effective only when the separate
/// sensitive-content consent bit is present and true.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TelemetryUserConfigV2 {
    pub version: u16,
    pub level: TelemetryLevel,
    pub sensitive_content_consent: bool,
}

impl TelemetryUserConfigV2 {
    pub const fn new(level: TelemetryLevel, sensitive_content_consent: bool) -> Self {
        Self {
            version: TELEMETRY_USER_CONFIG_VERSION,
            level,
            sensitive_content_consent,
        }
    }

    pub const fn effective_level(self) -> TelemetryLevel {
        if matches!(self.level, TelemetryLevel::Debug) && !self.sensitive_content_consent {
            TelemetryLevel::Off
        } else {
            self.level
        }
    }
}

impl Default for TelemetryUserConfigV2 {
    fn default() -> Self {
        Self::new(TelemetryLevel::Off, false)
    }
}

/// Version-tolerant persisted user configuration.
///
/// Unknown newer objects are retained byte-for-byte at the JSON value level,
/// but execute as `off` until this client understands their semantics.
#[derive(Debug, Clone, PartialEq)]
pub enum TelemetryUserConfig {
    V1(TelemetryUserConfigV1),
    V2(TelemetryUserConfigV2),
    Unknown(serde_json::Value),
}

impl TelemetryUserConfig {
    pub const fn new(level: TelemetryLevel) -> Self {
        Self::V2(TelemetryUserConfigV2::new(level, false))
    }

    pub const fn with_sensitive_content_consent(
        level: TelemetryLevel,
        sensitive_content_consent: bool,
    ) -> Self {
        Self::V2(TelemetryUserConfigV2::new(level, sensitive_content_consent))
    }

    pub const fn effective_level(&self) -> TelemetryLevel {
        match self {
            Self::V1(config) => match config.level {
                TelemetryLevel::Debug => TelemetryLevel::Off,
                level => level,
            },
            Self::V2(config) => config.effective_level(),
            Self::Unknown(_) => TelemetryLevel::Off,
        }
    }

    pub const fn sensitive_content_consent(&self) -> bool {
        matches!(self, Self::V2(config) if config.sensitive_content_consent)
    }

    pub const fn v1(&self) -> Option<TelemetryUserConfigV1> {
        match self {
            Self::V1(config) => Some(*config),
            _ => None,
        }
    }

    pub const fn v2(&self) -> Option<TelemetryUserConfigV2> {
        match self {
            Self::V2(config) => Some(*config),
            _ => None,
        }
    }

    pub fn set_level(&mut self, level: TelemetryLevel) {
        // Consent is an independently persisted acknowledgement. Lowering the
        // active level revokes the runtime generation, but does not make the
        // user acknowledge the same disclosure again on the next Debug enable.
        let consent = self.sensitive_content_consent();
        *self = Self::with_sensitive_content_consent(level, consent);
    }
}

impl Default for TelemetryUserConfig {
    fn default() -> Self {
        Self::V2(TelemetryUserConfigV2::default())
    }
}

impl Serialize for TelemetryUserConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::V1(config) => config.serialize(serializer),
            Self::V2(config) => config.serialize(serializer),
            Self::Unknown(raw) => raw.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for TelemetryUserConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = serde_json::Value::deserialize(deserializer)?;
        if let Some(enabled) = raw.as_bool() {
            return Ok(Self::V2(TelemetryUserConfigV2::new(
                if enabled {
                    TelemetryLevel::Basic
                } else {
                    TelemetryLevel::Off
                },
                false,
            )));
        }

        let version = raw
            .as_object()
            .ok_or_else(|| D::Error::custom("telemetry config must be a boolean or object"))?
            .get("version")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(1);
        match version {
            1 => TelemetryUserConfigV1::deserialize(raw)
                .map(Self::V1)
                .map_err(D::Error::custom),
            2 => TelemetryUserConfigV2::deserialize(raw)
                .map(Self::V2)
                .map_err(D::Error::custom),
            _ => Ok(Self::Unknown(raw)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_boolean_migrates_and_serializes_as_v2() {
        let enabled: TelemetryUserConfig = serde_json::from_str("true").unwrap();
        assert_eq!(enabled.effective_level(), TelemetryLevel::Basic);
        assert_eq!(
            serde_json::to_value(enabled).unwrap(),
            serde_json::json!({
                "version": 2,
                "level": "basic",
                "sensitive_content_consent": false
            })
        );

        let disabled: TelemetryUserConfig = serde_json::from_str("false").unwrap();
        assert_eq!(disabled.effective_level(), TelemetryLevel::Off);
    }

    #[test]
    fn v1_remains_compatible_and_cannot_authorize_debug() {
        let diagnostic: TelemetryUserConfig = serde_json::from_value(serde_json::json!({
            "version": 1,
            "level": "diagnostic"
        }))
        .unwrap();
        assert_eq!(diagnostic.effective_level(), TelemetryLevel::Diagnostic);

        let debug: TelemetryUserConfig = serde_json::from_value(serde_json::json!({
            "version": 1,
            "level": "debug"
        }))
        .unwrap();
        assert_eq!(debug.effective_level(), TelemetryLevel::Off);
    }

    #[test]
    fn debug_requires_explicit_sensitive_content_consent() {
        assert_eq!(
            TelemetryUserConfig::new(TelemetryLevel::Debug).effective_level(),
            TelemetryLevel::Off
        );
        let authorized =
            TelemetryUserConfig::with_sensitive_content_consent(TelemetryLevel::Debug, true);
        assert_eq!(authorized.effective_level(), TelemetryLevel::Debug);
    }

    #[test]
    fn sensitive_content_consent_survives_level_changes() {
        let mut config =
            TelemetryUserConfig::with_sensitive_content_consent(TelemetryLevel::Debug, true);
        config.set_level(TelemetryLevel::Basic);
        assert_eq!(config.effective_level(), TelemetryLevel::Basic);
        assert!(config.sensitive_content_consent());

        config.set_level(TelemetryLevel::Debug);
        assert_eq!(config.effective_level(), TelemetryLevel::Debug);
    }

    #[test]
    fn unknown_version_is_preserved_but_executes_as_off() {
        let raw = serde_json::json!({
            "version": 99,
            "level": "debug",
            "future_setting": {"enabled": true}
        });
        let config: TelemetryUserConfig = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(config.effective_level(), TelemetryLevel::Off);
        assert_eq!(serde_json::to_value(config).unwrap(), raw);
    }
}
