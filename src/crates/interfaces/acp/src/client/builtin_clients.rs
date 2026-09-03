use std::collections::HashMap;

use super::config::{AcpClientConfig, AcpClientConfigFile, AcpClientPermissionMode};

const CLAUDE_ACP_PACKAGE: &str = "@agentclientprotocol/claude-agent-acp";
const CLAUDE_ACP_ARGS: &[&str] = &["--yes", "@agentclientprotocol/claude-agent-acp@latest"];
const LEGACY_CLAUDE_ACP_ARGS: &[&str] = &["--yes", "@zed-industries/claude-code-acp@latest"];
const CODEX_ACP_PACKAGE: &str = "@agentclientprotocol/codex-acp";
const CODEX_ACP_ARGS: &[&str] = &["--yes", "@agentclientprotocol/codex-acp@latest"];
const LEGACY_CODEX_ACP_ARGS: &[&str] = &["--yes", "@zed-industries/codex-acp@latest"];
const CLAUDE_CODE_OHOS_VERSION: &str = "2.1.112";
// 0.29.1 depends on claude-agent-sdk 0.2.112, matching the pinned CLI release.
const CLAUDE_ACP_OHOS_VERSION: &str = "0.29.1";
// HarmonyBrew currently packages Codex 0.151. codex-acp 1.8 moved its
// app-server baseline to Codex 0.152, while 1.7 targets the preceding protocol
// generation and remains the safer adapter for the packaged OHOS binary.
const CODEX_ACP_OHOS_VERSION: &str = "1.7.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OhosNpmManagedPreset {
    pub(crate) package: &'static str,
    pub(crate) install_version: &'static str,
    pub(crate) entry_relative_path: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OhosHarmonyBrewFormulaPreset {
    pub(crate) formula: &'static str,
    pub(crate) auto_install: bool,
    pub(crate) entry_relative_path: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OhosNpmManagedAdapterPreset {
    pub(crate) npm: OhosNpmManagedPreset,
    pub(crate) cli_path_env: &'static str,
    pub(crate) propagate_node_compat: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OhosAcpSupport {
    Unsupported,
    HarmonyBrewFormula(OhosHarmonyBrewFormulaPreset),
    HarmonyBrewNpm(OhosNpmManagedPreset),
}

impl OhosAcpSupport {
    pub(crate) fn is_supported(self) -> bool {
        !matches!(self, Self::Unsupported)
    }

    pub(crate) fn formula(self) -> Option<OhosHarmonyBrewFormulaPreset> {
        match self {
            Self::HarmonyBrewFormula(preset) => Some(preset),
            Self::Unsupported | Self::HarmonyBrewNpm(_) => None,
        }
    }

    pub(crate) fn allows_managed_install(self) -> bool {
        match self {
            Self::HarmonyBrewFormula(preset) => preset.auto_install,
            Self::HarmonyBrewNpm(_) => true,
            Self::Unsupported => false,
        }
    }

    pub(crate) fn npm(self) -> Option<OhosNpmManagedPreset> {
        match self {
            Self::HarmonyBrewNpm(npm) => Some(npm),
            Self::Unsupported | Self::HarmonyBrewFormula(_) => None,
        }
    }
}

#[derive(Debug)]
pub(crate) struct BuiltinAcpClientPreset {
    pub(crate) id: &'static str,
    pub(crate) command: &'static str,
    pub(crate) args: &'static [&'static str],
    pub(crate) tool_command: &'static str,
    /// npm package BitFun can install on the user's behalf. `None` means the
    /// agent is user-managed (BitFun only provides the integration, the user
    /// installs the CLI themselves) — the UI then shows no one-click installer.
    pub(crate) install_package: Option<&'static str>,
    /// Optional local HarmonyOS strategy. Standard local and remote hosts keep
    /// using the portable command and npm metadata above.
    pub(crate) ohos: OhosAcpSupport,
    /// Optional ACP adapter installed with HarmonyBrew's exact Node/npm
    /// toolchain. Its runtime is bound to the managed CLI through
    /// `cli_path_env`, so an HNP or system executable cannot be selected by
    /// accident.
    pub(crate) ohos_adapter: Option<OhosNpmManagedAdapterPreset>,
    pub(crate) adapter_package: Option<&'static str>,
    pub(crate) adapter_bin: Option<&'static str>,
}

impl BuiltinAcpClientPreset {
    pub(crate) fn supports_ohos(&self) -> bool {
        self.ohos.is_supported()
    }
}

const BUILTIN_ACP_CLIENT_PRESETS: &[BuiltinAcpClientPreset] = &[
    BuiltinAcpClientPreset {
        id: "opencode",
        command: "opencode",
        args: &["acp"],
        tool_command: "opencode",
        install_package: Some("opencode-ai"),
        // OpenCode's verified HarmonyOS formula lives in a third-party tap.
        // HiShell owns that tap's private trust state, which BitFun cannot
        // observe or reuse. Detect existing installations, but never install.
        ohos: OhosAcpSupport::HarmonyBrewFormula(OhosHarmonyBrewFormulaPreset {
            formula: "opencode",
            auto_install: false,
            entry_relative_path: "bin/opencode",
        }),
        ohos_adapter: None,
        adapter_package: None,
        adapter_bin: None,
    },
    // Kimi Code ships a native `kimi acp` entry point and HarmonyBrew owns an
    // OHOS arm64 formula (including its matching Node.js dependency). Local
    // HarmonyOS provisioning must go through that formula rather than npm.
    BuiltinAcpClientPreset {
        id: "kimi-code",
        command: "kimi",
        args: &["acp"],
        tool_command: "kimi",
        install_package: Some("@moonshot-ai/kimi-code"),
        ohos: OhosAcpSupport::HarmonyBrewFormula(OhosHarmonyBrewFormulaPreset {
            formula: "kimi-code",
            auto_install: true,
            entry_relative_path: "bin/kimi",
        }),
        ohos_adapter: None,
        adapter_package: None,
        adapter_bin: None,
    },
    // Qwen Code exposes ACP directly through `qwen --acp`. HarmonyBrew ships
    // an OHOS arm64 bottle with its matching Node and ripgrep dependencies, so
    // local HarmonyOS provisioning must use that formula and exact executable.
    BuiltinAcpClientPreset {
        id: "qwen-code",
        command: "qwen",
        args: &["--acp"],
        tool_command: "qwen",
        install_package: Some("@qwen-code/qwen-code"),
        ohos: OhosAcpSupport::HarmonyBrewFormula(OhosHarmonyBrewFormulaPreset {
            formula: "qwen-code",
            auto_install: true,
            entry_relative_path: "bin/qwen",
        }),
        ohos_adapter: None,
        adapter_package: None,
        adapter_bin: None,
    },
    // CodeBuddy's ACP entry is a bundled Node script. On HarmonyOS BitFun
    // installs the device-verified version under HarmonyBrew's explicit prefix
    // and launches it with HarmonyBrew's exact Node binary. Optional native npm
    // dependencies are omitted because the ACP/headless path does not use them.
    BuiltinAcpClientPreset {
        id: "codebuddy-code",
        command: "codebuddy",
        args: &["--acp"],
        tool_command: "codebuddy",
        install_package: Some("@tencent-ai/codebuddy-code"),
        ohos: OhosAcpSupport::HarmonyBrewNpm(OhosNpmManagedPreset {
            package: "@tencent-ai/codebuddy-code",
            install_version: "2.138.0",
            entry_relative_path: "lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy",
        }),
        ohos_adapter: None,
        adapter_package: None,
        adapter_bin: None,
    },
    // Oh My Pi (omp) — a terminal coding agent that speaks ACP natively via
    // `omp acp` (no adapter needed, like opencode). User-managed: omp targets
    // the bun runtime (installed via `bun install -g @oh-my-pi/pi-coding-agent`
    // or `curl -fsSL https://omp.sh/install | sh`), which BitFun's npm-based
    // installer cannot provide — so install_package is None and BitFun only
    // detects `omp` on PATH and launches it. https://github.com/can1357/oh-my-pi
    BuiltinAcpClientPreset {
        id: "omp",
        command: "omp",
        args: &["acp"],
        tool_command: "omp",
        install_package: None,
        ohos: OhosAcpSupport::Unsupported,
        ohos_adapter: None,
        adapter_package: None,
        adapter_bin: None,
    },
    BuiltinAcpClientPreset {
        id: "claude-code",
        command: "npx",
        args: CLAUDE_ACP_ARGS,
        tool_command: "claude",
        install_package: Some("@anthropic-ai/claude-code"),
        ohos: OhosAcpSupport::HarmonyBrewNpm(OhosNpmManagedPreset {
            package: "@anthropic-ai/claude-code",
            install_version: CLAUDE_CODE_OHOS_VERSION,
            entry_relative_path: "lib/node_modules/@anthropic-ai/claude-code/cli.js",
        }),
        ohos_adapter: Some(OhosNpmManagedAdapterPreset {
            npm: OhosNpmManagedPreset {
                package: CLAUDE_ACP_PACKAGE,
                install_version: CLAUDE_ACP_OHOS_VERSION,
                entry_relative_path:
                    "lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
            },
            cli_path_env: "CLAUDE_CODE_EXECUTABLE",
            propagate_node_compat: true,
        }),
        adapter_package: Some(CLAUDE_ACP_PACKAGE),
        adapter_bin: Some("claude-agent-acp"),
    },
    BuiltinAcpClientPreset {
        id: "codex",
        command: "npx",
        args: CODEX_ACP_ARGS,
        tool_command: "codex",
        install_package: Some("@openai/codex"),
        ohos: OhosAcpSupport::HarmonyBrewFormula(OhosHarmonyBrewFormulaPreset {
            formula: "codex",
            auto_install: true,
            entry_relative_path: "bin/codex",
        }),
        ohos_adapter: Some(OhosNpmManagedAdapterPreset {
            npm: OhosNpmManagedPreset {
                package: CODEX_ACP_PACKAGE,
                install_version: CODEX_ACP_OHOS_VERSION,
                entry_relative_path:
                    "lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js",
            },
            cli_path_env: "CODEX_PATH",
            propagate_node_compat: false,
        }),
        adapter_package: Some(CODEX_ACP_PACKAGE),
        adapter_bin: Some("codex-acp"),
    },
];

pub(crate) fn builtin_client_ids() -> impl Iterator<Item = &'static str> {
    BUILTIN_ACP_CLIENT_PRESETS.iter().map(|preset| preset.id)
}

pub(crate) fn builtin_acp_client_preset(
    client_id: &str,
) -> Option<&'static BuiltinAcpClientPreset> {
    BUILTIN_ACP_CLIENT_PRESETS
        .iter()
        .find(|preset| preset.id == client_id)
}

pub(crate) fn default_config_for_builtin_client(client_id: &str) -> Option<AcpClientConfig> {
    let preset = builtin_acp_client_preset(client_id)?;
    Some(AcpClientConfig {
        name: None,
        command: preset.command.to_string(),
        args: preset
            .args
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        env: HashMap::new(),
        enabled: true,
        readonly: false,
        permission_mode: AcpClientPermissionMode::Ask,
        local_override: None,
    })
}

pub(crate) fn migrate_legacy_builtin_client_configs(config_file: &mut AcpClientConfigFile) {
    for (client_id, legacy_args, current_args) in [
        ("claude-code", LEGACY_CLAUDE_ACP_ARGS, CLAUDE_ACP_ARGS),
        ("codex", LEGACY_CODEX_ACP_ARGS, CODEX_ACP_ARGS),
    ] {
        let Some(config) = config_file.acp_clients.get_mut(client_id) else {
            continue;
        };
        let uses_legacy_preset = config.command == "npx"
            && config
                .args
                .iter()
                .map(String::as_str)
                .eq(legacy_args.iter().copied());
        if uses_legacy_preset {
            config.args = current_args
                .iter()
                .map(|value| (*value).to_string())
                .collect();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_default_config_for_builtin_client() {
        let config = default_config_for_builtin_client("claude-code").expect("builtin config");
        assert!(config.enabled);
        assert_eq!(config.command, "npx");
        assert_eq!(
            config.args,
            vec!["--yes", "@agentclientprotocol/claude-agent-acp@latest"]
        );
    }

    #[test]
    fn omp_is_a_native_acp_preset() {
        let preset = builtin_acp_client_preset("omp").expect("omp preset registered");
        assert_eq!(preset.command, "omp");
        assert_eq!(preset.args, &["acp"]);
        assert_eq!(preset.tool_command, "omp");
        // Native ACP — no adapter package/bin, like opencode.
        assert!(preset.adapter_package.is_none());
        assert!(preset.adapter_bin.is_none());
        // User-managed: BitFun provides no installer for omp.
        assert!(preset.install_package.is_none());

        let config = default_config_for_builtin_client("omp").expect("omp config");
        assert!(config.enabled);
        assert_eq!(config.command, "omp");
        assert_eq!(config.args, vec!["acp"]);
    }

    #[test]
    fn harmonybrew_managed_presets_keep_their_exact_acp_entries() {
        let kimi = builtin_acp_client_preset("kimi-code").expect("kimi preset registered");
        assert_eq!(kimi.command, "kimi");
        assert_eq!(kimi.args, &["acp"]);
        assert_eq!(kimi.install_package, Some("@moonshot-ai/kimi-code"));
        assert_eq!(
            kimi.ohos.formula().map(|formula| formula.formula),
            Some("kimi-code")
        );
        assert!(kimi.adapter_package.is_none());
        assert!(kimi.adapter_bin.is_none());

        let qwen = builtin_acp_client_preset("qwen-code").expect("qwen preset registered");
        assert_eq!(qwen.command, "qwen");
        assert_eq!(qwen.args, &["--acp"]);
        assert_eq!(qwen.install_package, Some("@qwen-code/qwen-code"));
        assert_eq!(
            qwen.ohos.formula().map(|formula| formula.formula),
            Some("qwen-code")
        );
        assert!(qwen.adapter_package.is_none());
        assert!(qwen.adapter_bin.is_none());

        let codebuddy =
            builtin_acp_client_preset("codebuddy-code").expect("CodeBuddy preset registered");
        assert_eq!(codebuddy.command, "codebuddy");
        assert_eq!(codebuddy.args, &["--acp"]);
        assert_eq!(
            codebuddy.ohos,
            OhosAcpSupport::HarmonyBrewNpm(OhosNpmManagedPreset {
                package: "@tencent-ai/codebuddy-code",
                install_version: "2.138.0",
                entry_relative_path: "lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy",
            })
        );
        assert!(codebuddy.adapter_package.is_none());
        assert!(codebuddy.adapter_bin.is_none());

        assert_eq!(
            BUILTIN_ACP_CLIENT_PRESETS
                .iter()
                .filter(|preset| preset.supports_ohos())
                .map(|preset| preset.id)
                .collect::<Vec<_>>(),
            vec![
                "opencode",
                "kimi-code",
                "qwen-code",
                "codebuddy-code",
                "claude-code",
                "codex"
            ]
        );
    }

    #[test]
    fn ohos_adapter_presets_bind_to_exact_managed_cli_paths() {
        let claude_npm = builtin_acp_client_preset("claude-code").expect("Claude npm preset");
        assert_eq!(
            claude_npm.ohos.npm(),
            Some(OhosNpmManagedPreset {
                package: "@anthropic-ai/claude-code",
                install_version: CLAUDE_CODE_OHOS_VERSION,
                entry_relative_path: "lib/node_modules/@anthropic-ai/claude-code/cli.js",
            })
        );
        assert_eq!(
            claude_npm.ohos_adapter.map(|adapter| adapter.cli_path_env),
            Some("CLAUDE_CODE_EXECUTABLE")
        );

        let codex = builtin_acp_client_preset("codex").expect("Codex preset");
        assert_eq!(
            codex.ohos.formula().map(|formula| formula.formula),
            Some("codex")
        );
        assert_eq!(
            codex.ohos_adapter.map(|adapter| adapter.cli_path_env),
            Some("CODEX_PATH")
        );
    }

    #[test]
    fn migrates_only_exact_legacy_builtin_commands() {
        let mut config_file = AcpClientConfigFile {
            acp_clients: HashMap::from([
                (
                    "claude-code".to_string(),
                    AcpClientConfig {
                        name: Some("Claude Code".to_string()),
                        command: "npx".to_string(),
                        args: LEGACY_CLAUDE_ACP_ARGS
                            .iter()
                            .map(|value| (*value).to_string())
                            .collect(),
                        env: HashMap::new(),
                        enabled: true,
                        readonly: false,
                        permission_mode: AcpClientPermissionMode::Ask,
                        local_override: None,
                    },
                ),
                (
                    "codex".to_string(),
                    AcpClientConfig {
                        name: Some("Codex".to_string()),
                        command: "npx".to_string(),
                        args: LEGACY_CODEX_ACP_ARGS
                            .iter()
                            .map(|value| (*value).to_string())
                            .collect(),
                        env: HashMap::new(),
                        enabled: true,
                        readonly: false,
                        permission_mode: AcpClientPermissionMode::Ask,
                        local_override: None,
                    },
                ),
                (
                    "custom-codex".to_string(),
                    AcpClientConfig {
                        name: Some("Pinned Codex".to_string()),
                        command: "npx".to_string(),
                        args: vec![
                            "--yes".to_string(),
                            "@zed-industries/codex-acp@0.16.0".to_string(),
                        ],
                        env: HashMap::new(),
                        enabled: true,
                        readonly: false,
                        permission_mode: AcpClientPermissionMode::Ask,
                        local_override: None,
                    },
                ),
            ]),
        };

        migrate_legacy_builtin_client_configs(&mut config_file);

        assert_eq!(
            config_file.acp_clients["claude-code"].args,
            vec!["--yes", "@agentclientprotocol/claude-agent-acp@latest"]
        );
        assert_eq!(
            config_file.acp_clients["codex"].args,
            vec!["--yes", "@agentclientprotocol/codex-acp@latest"]
        );
        assert_eq!(
            config_file.acp_clients["custom-codex"].args,
            vec!["--yes", "@zed-industries/codex-acp@0.16.0"]
        );
    }
}
