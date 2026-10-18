use bitfun_deveco_code_adapter::{
    load_deveco_user_instructions, DevEcoCodeCommandProvider, DevEcoCodeCommandProviderOptions,
    DevEcoCodeInstructionSourceOptions, DevEcoCodeMcpProvider, DevEcoCodeMcpProviderOptions,
    DevEcoCodeSkillRootProvider, DevEcoCodeSkillRootProviderOptions, DevEcoCodeSubagentProvider,
    DevEcoCodeSubagentProviderOptions,
};
use bitfun_product_domains::external_sources::{
    ExecutionDomainId, ExternalMcpDiscoveryInput, ExternalMcpRevisionKey,
    ExternalMcpSourceProvider, ExternalSourceContext, ExternalSourceHealth,
    PreparedExternalMcpTransport, PromptCommandSourceProvider,
};
use bitfun_product_domains::external_subagents::{
    ExternalSubagentDiscoveryInput, ExternalSubagentSourceProvider,
};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

struct Fixture {
    _temp: tempfile::TempDir,
    home: PathBuf,
    user: PathBuf,
    project: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let user = home.join(".config/deveco");
        let project = temp.path().join("project");
        fs::create_dir_all(&user).unwrap();
        fs::create_dir_all(project.join(".git")).unwrap();
        Self {
            _temp: temp,
            home,
            user,
            project,
        }
    }

    fn options(&self) -> DevEcoCodeCommandProviderOptions {
        DevEcoCodeCommandProviderOptions {
            user_config_dir: self.user.clone(),
            legacy_user_config_dir: Some(self.home.join(".deveco")),
            explicit_config_file: None,
            explicit_config_dir: None,
            inline_config_content: None,
            project_config_enabled: true,
            ordinary_cli_sources_enabled: true,
        }
    }

    fn context(&self) -> ExternalSourceContext {
        ExternalSourceContext {
            workspace_root: Some(self.project.clone()),
            execution_domain_id: ExecutionDomainId::new("local-user").unwrap(),
        }
    }

    fn mcp_input(&self) -> ExternalMcpDiscoveryInput {
        ExternalMcpDiscoveryInput {
            context: self.context(),
            suppressed_sources: BTreeSet::new(),
            revision_key: ExternalMcpRevisionKey::new([7; 32]),
        }
    }
}

fn write(path: impl AsRef<Path>, content: &str) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

#[test]
fn commands_follow_deveco_layers_and_never_discover_another_ecosystem() {
    let fixture = Fixture::new();
    write(
        fixture.user.join("deveco.jsonc"),
        r#"{"command":{"review":{"template":"user $ARGUMENTS"}}}"#,
    );
    write(
        fixture.project.join(".deveco/commands/review.md"),
        "---\ndescription: Review code\n---\nproject $ARGUMENTS",
    );
    write(
        fixture.project.join(".opencode/commands/foreign.md"),
        "foreign",
    );
    let provider = DevEcoCodeCommandProvider::new(fixture.options());
    let snapshot = provider.discover(&fixture.context()).unwrap();
    assert_eq!(snapshot.provider.ecosystem_id.as_str(), "deveco-code");
    assert!(snapshot
        .sources
        .iter()
        .all(|source| source.key.provider_id.as_str() == "deveco-code.commands"));
    let commands = provider
        .resolve_commands(
            &snapshot,
            &snapshot
                .sources
                .iter()
                .map(|source| source.key.clone())
                .collect(),
        )
        .unwrap();
    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0].template, "project $ARGUMENTS");
}

#[test]
fn malformed_command_source_remains_an_unavailable_diagnostic() {
    let fixture = Fixture::new();
    write(fixture.user.join("deveco.json"), "{broken");
    let snapshot = DevEcoCodeCommandProvider::new(fixture.options())
        .discover(&fixture.context())
        .unwrap();
    assert!(!snapshot.diagnostics.is_empty());
    assert!(snapshot
        .sources
        .iter()
        .any(|source| source.health == ExternalSourceHealth::Unavailable));
}

#[test]
fn inline_config_identity_is_redacted_and_deveco_qualified() {
    let fixture = Fixture::new();
    let mut options = fixture.options();
    options.inline_config_content =
        Some(r#"{"command":{"review":{"template":"private-marker"}}}"#.into());
    let snapshot = DevEcoCodeCommandProvider::new(options)
        .discover(&fixture.context())
        .unwrap();
    assert!(snapshot
        .sources
        .iter()
        .any(|source| source.location == "DEVECO_CONFIG_CONTENT"));
    let encoded = serde_json::to_string(&snapshot.sources).unwrap();
    assert!(!encoded.contains("private-marker"));
    assert!(!encoded.contains("opencode"));
}

#[test]
fn subagents_preserve_native_model_and_source_suppression() {
    let fixture = Fixture::new();
    write(
        fixture.user.join("deveco.json"),
        r#"{"agent":{"worker":{"prompt":"Review code","mode":"subagent","model":"deveco/example"}}}"#,
    );
    let provider = DevEcoCodeSubagentProvider::new(DevEcoCodeSubagentProviderOptions {
        config: fixture.options(),
        project_root_override: None,
    });
    let mut input = ExternalSubagentDiscoveryInput {
        context: fixture.context(),
        suppressed_sources: BTreeSet::new(),
    };
    let snapshot = provider.discover(&input).unwrap();
    assert_eq!(snapshot.definitions.len(), 1);
    assert_eq!(snapshot.definitions[0].logical_id, "worker");
    assert_eq!(snapshot.provider.ecosystem_id.as_str(), "deveco-code");
    input
        .suppressed_sources
        .extend(snapshot.sources.into_iter().map(|source| source.key));
    assert!(provider.discover(&input).unwrap().definitions.is_empty());
}

#[test]
fn mcp_merges_v1_layers_redacts_secrets_and_rejects_stale_preparation() {
    let fixture = Fixture::new();
    write(
        fixture.user.join("deveco.json"),
        r#"{"mcp":{"tools":{"type":"remote","url":"https://example.invalid/private?token=hidden","headers":{"Authorization":"Bearer private-marker"}}}}"#,
    );
    write(
        fixture.project.join("deveco.json"),
        r#"{"mcp":{"tools":{"url":"https://example.invalid/mcp","headers":{"X-Project":"value"}}}}"#,
    );
    let provider = DevEcoCodeMcpProvider::new(DevEcoCodeMcpProviderOptions {
        config: fixture.options(),
        project_root_override: None,
    });
    let input = fixture.mcp_input();
    let snapshot = provider.discover(&input).unwrap();
    assert_eq!(snapshot.servers.len(), 1);
    let server = &snapshot.servers[0];
    assert_eq!(server.provenance.len(), 2);
    let encoded = serde_json::to_string(&snapshot).unwrap();
    assert!(!encoded.contains("private-marker"));
    assert!(!encoded.contains("token=hidden"));
    assert!(snapshot
        .sources
        .iter()
        .all(|source| source.content_version.starts_with("hmac-sha256:")));
    match provider
        .prepare_server(&input, &server.id, &server.behavior_version)
        .unwrap()
        .transport
    {
        PreparedExternalMcpTransport::Remote { headers, url, .. } => {
            assert_eq!(url, "https://example.invalid/mcp");
            assert_eq!(headers["Authorization"].expose(), "Bearer private-marker");
        }
        other => panic!("expected remote MCP transport, got {other:?}"),
    }
    write(
        fixture.project.join("deveco.json"),
        r#"{"mcp":{"tools":{"enabled":false}}}"#,
    );
    assert!(provider
        .prepare_server(&input, &server.id, &server.behavior_version)
        .is_err());
}

#[test]
fn skill_roots_include_native_singular_plural_and_explicit_paths_without_fetching_urls() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.project.join(".deveco/skill")).unwrap();
    fs::create_dir_all(fixture.user.join("skills")).unwrap();
    fs::create_dir_all(fixture.project.join("custom-skills")).unwrap();
    fs::create_dir_all(fixture.project.join("superseded-skills")).unwrap();
    write(
        fixture.user.join("deveco.json"),
        r#"{"skills":{"paths":["superseded-skills"]}}"#,
    );
    write(
        fixture.project.join("deveco.json"),
        r#"{"skills":{"paths":["custom-skills",".deveco/skill","custom-skills"]}}"#,
    );
    let mut config = fixture.options();
    config.inline_config_content =
        Some(r#"{"skills":{"urls":["https://example.invalid/skills"]}}"#.into());
    let report = DevEcoCodeSkillRootProvider::new(DevEcoCodeSkillRootProviderOptions {
        config: config.clone(),
        home_dir: Some(fixture.home.clone()),
    })
    .discover_with_diagnostics(Some(&fixture.project));
    assert_eq!(report.roots.len(), 3);
    assert!(report
        .roots
        .iter()
        .any(|root| root.path.ends_with("custom-skills")));
    assert!(report
        .roots
        .iter()
        .any(|root| root.path.ends_with(".deveco/skill")));
    assert!(report
        .roots
        .iter()
        .all(|root| !root.path.ends_with("superseded-skills")));
    assert!(report.roots.last().unwrap().path.ends_with("custom-skills"));
    assert!(report
        .roots
        .windows(2)
        .all(|roots| roots[0].precedence < roots[1].precedence));
    assert!(report
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.message.contains("URLs")));

    config.inline_config_content = Some(r#"{"skills":{"paths":[]}}"#.into());
    let cleared = DevEcoCodeSkillRootProvider::new(DevEcoCodeSkillRootProviderOptions {
        config,
        home_dir: Some(fixture.home.clone()),
    })
    .discover_with_diagnostics(Some(&fixture.project));
    assert_eq!(cleared.roots.len(), 2);
    assert!(cleared
        .roots
        .iter()
        .all(|root| !root.path.ends_with("custom-skills")));
}

#[test]
fn user_instructions_use_deveco_config_without_implicit_claude_fallback() {
    let fixture = Fixture::new();
    write(
        fixture.home.join(".claude/CLAUDE.md"),
        "foreign instructions",
    );
    let options = DevEcoCodeInstructionSourceOptions {
        config: fixture.options(),
        home_dir: Some(fixture.home.clone()),
        workspace_root: Some(fixture.project.clone()),
        display_root: "~/.config/deveco".into(),
    };
    assert!(load_deveco_user_instructions(&options).unwrap().is_empty());
    write(fixture.user.join("AGENTS.md"), "DevEco instructions");
    let files = load_deveco_user_instructions(&options).unwrap();
    assert_eq!(files.len(), 1);
    assert!(files[0].name.contains("deveco"));
}

#[test]
fn unsupported_runtime_mode_reports_diagnostics_without_reading_cli_sources() {
    let fixture = Fixture::new();
    write(fixture.user.join("deveco.json"), "{broken");
    let mut options = fixture.options();
    options.ordinary_cli_sources_enabled = false;
    let commands = DevEcoCodeCommandProvider::new(options.clone());
    let snapshot = commands.discover(&fixture.context()).unwrap();
    assert!(snapshot.sources.is_empty());
    assert!(snapshot.commands.is_empty());
    assert_eq!(snapshot.diagnostics[0].code, "deveco.runtime_unsupported");
    assert!(commands.watch_roots(&fixture.context()).is_empty());
    let mcp = DevEcoCodeMcpProvider::new(DevEcoCodeMcpProviderOptions {
        config: options.clone(),
        project_root_override: None,
    })
    .discover(&fixture.mcp_input())
    .unwrap();
    assert!(mcp.sources.is_empty());
    assert_eq!(mcp.diagnostics[0].code, "deveco.runtime_unsupported");
    let skills = DevEcoCodeSkillRootProvider::new(DevEcoCodeSkillRootProviderOptions {
        config: options,
        home_dir: Some(fixture.home.clone()),
    })
    .discover_with_diagnostics(Some(&fixture.project));
    assert!(skills.roots.is_empty());
    assert!(skills.diagnostics[0].message.contains("unsupported"));
}
