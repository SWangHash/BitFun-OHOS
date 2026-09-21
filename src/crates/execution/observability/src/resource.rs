use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const TELEMETRY_SCHEMA_VERSION: u16 = 1;
pub const INSTRUMENTATION_SCOPE_NAME: &str = "bitfun-observability";
pub const INSTRUMENTATION_SCOPE_VERSION: &str = env!("CARGO_PKG_VERSION");

const ENTRYPOINT_VALUES: &[&str] = &[
    "desktop",
    "cli",
    "server",
    "remote",
    "relay",
    "web",
    "mobile_web",
    "mobile_native",
    "acp",
    "sdk",
    "other",
];
const HOST_ARCH_VALUES: &[&str] = &["x86_64", "aarch64", "x86", "arm", "riscv64", "other"];
const OS_TYPE_VALUES: &[&str] = &[
    "windows",
    "linux",
    "darwin",
    "android",
    "ios",
    "harmonyos",
    "other",
];
const ENVIRONMENT_VALUES: &[&str] = &["production", "staging", "development", "test"];
const RELEASE_CHANNEL_VALUES: &[&str] = &["stable", "beta", "nightly", "development"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceValueType {
    Enum,
    BuildVersion,
    StaticString,
    InstanceId,
    ScopedPseudonymousId,
    U16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceFieldView {
    key: &'static str,
    value_type: ResourceValueType,
    enum_values: &'static [&'static str],
    required: bool,
}

impl ResourceFieldView {
    pub const fn key(self) -> &'static str {
        self.key
    }

    pub const fn value_type(self) -> ResourceValueType {
        self.value_type
    }

    pub const fn enum_values(self) -> &'static [&'static str] {
        self.enum_values
    }

    pub const fn is_required(self) -> bool {
        self.required
    }
}

const RESOURCE_FIELDS: &[ResourceFieldView] = &[
    ResourceFieldView {
        key: "bitfun.entrypoint",
        value_type: ResourceValueType::Enum,
        enum_values: ENTRYPOINT_VALUES,
        required: true,
    },
    ResourceFieldView {
        key: "service.name",
        value_type: ResourceValueType::StaticString,
        enum_values: &[],
        required: true,
    },
    ResourceFieldView {
        key: "service.version",
        value_type: ResourceValueType::BuildVersion,
        enum_values: &[],
        required: true,
    },
    ResourceFieldView {
        key: "service.instance.id",
        value_type: ResourceValueType::InstanceId,
        enum_values: &[],
        required: true,
    },
    ResourceFieldView {
        key: "deployment.environment.name",
        value_type: ResourceValueType::Enum,
        enum_values: ENVIRONMENT_VALUES,
        required: true,
    },
    ResourceFieldView {
        key: "host.arch",
        value_type: ResourceValueType::Enum,
        enum_values: HOST_ARCH_VALUES,
        required: false,
    },
    ResourceFieldView {
        key: "os.type",
        value_type: ResourceValueType::Enum,
        enum_values: OS_TYPE_VALUES,
        required: false,
    },
    ResourceFieldView {
        key: "bitfun.release.channel",
        value_type: ResourceValueType::Enum,
        enum_values: RELEASE_CHANNEL_VALUES,
        required: false,
    },
    ResourceFieldView {
        key: "bitfun.installation.pseudonymous_id",
        value_type: ResourceValueType::ScopedPseudonymousId,
        enum_values: &[],
        required: false,
    },
    ResourceFieldView {
        key: "bitfun.telemetry.schema.version",
        value_type: ResourceValueType::U16,
        enum_values: &[],
        required: true,
    },
    ResourceFieldView {
        key: "InstrumentationScope.name",
        value_type: ResourceValueType::StaticString,
        enum_values: &[],
        required: true,
    },
    ResourceFieldView {
        key: "InstrumentationScope.version",
        value_type: ResourceValueType::BuildVersion,
        enum_values: &[],
        required: true,
    },
];

pub const fn resource_descriptor() -> &'static [ResourceFieldView] {
    RESOURCE_FIELDS
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryEntrypoint {
    Desktop,
    Cli,
    Server,
    Remote,
    Relay,
    Web,
    MobileWeb,
    MobileNative,
    Acp,
    Sdk,
    Other,
}

impl TelemetryEntrypoint {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Cli => "cli",
            Self::Server => "server",
            Self::Remote => "remote",
            Self::Relay => "relay",
            Self::Web => "web",
            Self::MobileWeb => "mobile_web",
            Self::MobileNative => "mobile_native",
            Self::Acp => "acp",
            Self::Sdk => "sdk",
            Self::Other => "other",
        }
    }

    pub const fn service_name(self) -> &'static str {
        match self {
            Self::Desktop => "bitfun-desktop",
            Self::Cli => "bitfun-cli",
            Self::Server => "bitfun-server",
            Self::Remote => "bitfun-remote",
            Self::Relay => "bitfun-relay",
            Self::Web => "bitfun-web",
            Self::MobileWeb => "bitfun-mobile-web",
            Self::MobileNative => "bitfun-mobile-native",
            Self::Acp => "bitfun-acp",
            Self::Sdk => "bitfun-sdk",
            Self::Other => "bitfun",
        }
    }

    const fn is_native(self) -> bool {
        !matches!(self, Self::Web | Self::MobileWeb)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentEnvironment {
    Production,
    Staging,
    Development,
    Test,
}

impl DeploymentEnvironment {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Production => "production",
            Self::Staging => "staging",
            Self::Development => "development",
            Self::Test => "test",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseChannel {
    Stable,
    Beta,
    Nightly,
    Development,
}

impl ReleaseChannel {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Nightly => "nightly",
            Self::Development => "development",
        }
    }
}

/// Receiver-scoped identifier derived from a local root ID. The root ID itself
/// is never represented by this type and cannot enter a Telemetry Resource.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct PseudonymousInstallationId(String);

impl PseudonymousInstallationId {
    pub fn from_hmac_digest(digest: [u8; 32]) -> Self {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut value = String::with_capacity(32);
        for byte in digest.into_iter().take(16) {
            value.push(HEX[(byte >> 4) as usize] as char);
            value.push(HEX[(byte & 0x0f) as usize] as char);
        }
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HostArch {
    X86_64,
    Aarch64,
    X86,
    Arm,
    Riscv64,
    Other,
}

impl HostArch {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::X86_64 => "x86_64",
            Self::Aarch64 => "aarch64",
            Self::X86 => "x86",
            Self::Arm => "arm",
            Self::Riscv64 => "riscv64",
            Self::Other => "other",
        }
    }

    fn current() -> Self {
        match std::env::consts::ARCH {
            "x86_64" => Self::X86_64,
            "aarch64" => Self::Aarch64,
            "x86" => Self::X86,
            "arm" => Self::Arm,
            "riscv64" => Self::Riscv64,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OsType {
    Windows,
    Linux,
    Darwin,
    Android,
    Ios,
    HarmonyOs,
    Other,
}

impl OsType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Linux => "linux",
            Self::Darwin => "darwin",
            Self::Android => "android",
            Self::Ios => "ios",
            Self::HarmonyOs => "harmonyos",
            Self::Other => "other",
        }
    }

    fn current() -> Self {
        match std::env::consts::OS {
            "windows" => Self::Windows,
            "linux" => Self::Linux,
            "macos" => Self::Darwin,
            "android" => Self::Android,
            "ios" => Self::Ios,
            "ohos" => Self::HarmonyOs,
            _ => Self::Other,
        }
    }
}

/// Immutable, bounded attributes attached by an exporter as its OTel Resource.
///
/// Exact OS versions, machine identity, user identity, endpoint data, paths,
/// and installation identity are deliberately absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TelemetryResource {
    entrypoint: TelemetryEntrypoint,
    service_name: &'static str,
    service_version: &'static str,
    service_instance_id: Uuid,
    deployment_environment: DeploymentEnvironment,
    host_arch: Option<HostArch>,
    os_type: Option<OsType>,
    release_channel: Option<ReleaseChannel>,
    pseudonymous_installation_id: Option<PseudonymousInstallationId>,
    schema_version: u16,
}

impl TelemetryResource {
    pub fn current(
        entrypoint: TelemetryEntrypoint,
        deployment_environment: DeploymentEnvironment,
    ) -> Self {
        let (host_arch, os_type) = if entrypoint.is_native() {
            (Some(HostArch::current()), Some(OsType::current()))
        } else {
            (None, None)
        };
        Self {
            entrypoint,
            service_name: entrypoint.service_name(),
            service_version: env!("CARGO_PKG_VERSION"),
            service_instance_id: Uuid::new_v4(),
            deployment_environment,
            host_arch,
            os_type,
            release_channel: None,
            pseudonymous_installation_id: None,
            schema_version: TELEMETRY_SCHEMA_VERSION,
        }
    }

    pub fn with_release_channel(mut self, release_channel: ReleaseChannel) -> Self {
        self.release_channel = Some(release_channel);
        self
    }

    pub fn with_pseudonymous_installation_id(
        mut self,
        pseudonymous_installation_id: PseudonymousInstallationId,
    ) -> Self {
        self.pseudonymous_installation_id = Some(pseudonymous_installation_id);
        self
    }

    pub const fn entrypoint(&self) -> TelemetryEntrypoint {
        self.entrypoint
    }

    pub const fn service_name(&self) -> &'static str {
        self.service_name
    }

    pub const fn service_version(&self) -> &'static str {
        self.service_version
    }

    pub const fn service_instance_id(&self) -> Uuid {
        self.service_instance_id
    }

    pub const fn deployment_environment(&self) -> DeploymentEnvironment {
        self.deployment_environment
    }

    pub const fn host_arch(&self) -> Option<HostArch> {
        self.host_arch
    }

    pub const fn os_type(&self) -> Option<OsType> {
        self.os_type
    }

    pub const fn release_channel(&self) -> Option<ReleaseChannel> {
        self.release_channel
    }

    pub fn pseudonymous_installation_id(&self) -> Option<&PseudonymousInstallationId> {
        self.pseudonymous_installation_id.as_ref()
    }

    pub const fn schema_version(&self) -> u16 {
        self.schema_version
    }
}

impl Default for TelemetryResource {
    fn default() -> Self {
        Self::current(
            TelemetryEntrypoint::Other,
            DeploymentEnvironment::Development,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_resource_contains_only_bounded_build_and_platform_facts() {
        let resource =
            TelemetryResource::current(TelemetryEntrypoint::Cli, DeploymentEnvironment::Test);
        let serialized = serde_json::to_value(&resource).unwrap();

        assert_eq!(resource.entrypoint(), TelemetryEntrypoint::Cli);
        assert_eq!(resource.schema_version(), TELEMETRY_SCHEMA_VERSION);
        assert_eq!(resource.service_name(), "bitfun-cli");
        assert_eq!(
            resource.deployment_environment(),
            DeploymentEnvironment::Test
        );
        assert_eq!(serialized.as_object().unwrap().len(), 10);
        for forbidden in ["os_version", "username", "machine_name", "endpoint", "path"] {
            assert!(!serialized.to_string().contains(forbidden));
        }
        assert!(serialized["pseudonymous_installation_id"].is_null());
    }

    #[test]
    fn resource_descriptor_covers_the_frozen_mapping() {
        let keys = resource_descriptor()
            .iter()
            .map(|field| field.key())
            .collect::<Vec<_>>();
        assert_eq!(
            keys,
            vec![
                "bitfun.entrypoint",
                "service.name",
                "service.version",
                "service.instance.id",
                "deployment.environment.name",
                "host.arch",
                "os.type",
                "bitfun.release.channel",
                "bitfun.installation.pseudonymous_id",
                "bitfun.telemetry.schema.version",
                "InstrumentationScope.name",
                "InstrumentationScope.version",
            ]
        );
        assert!(resource_descriptor()
            .iter()
            .filter(|field| field.value_type() == ResourceValueType::Enum)
            .all(|field| !field.enum_values().is_empty()));
    }
}
