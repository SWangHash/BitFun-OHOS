use super::*;
use std::fs;
use tempfile::TempDir;

struct Fixture {
    _temp: TempDir,
    home: PathBuf,
    workspace: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home/.dsh");
        let workspace = temp.path().join("project");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        Self {
            _temp: temp,
            home,
            workspace,
        }
    }
    fn input(&self) -> ExternalMcpDiscoveryInput {
        ExternalMcpDiscoveryInput {
            context: ExternalSourceContext {
                workspace_root: Some(self.workspace.clone()),
                execution_domain_id: ExecutionDomainId::new("local-user").unwrap(),
            },
            suppressed_sources: BTreeSet::new(),
            revision_key: ExternalMcpRevisionKey::new([7; 32]),
        }
    }
    fn provider(&self) -> DshMcpProvider {
        DshMcpProvider::new(DshMcpProviderOptions {
            dsh_home: self.home.clone(),
        })
    }
    fn write(&self, relative: &str, body: &str) {
        let path = self.home.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }
}

#[test]
fn discovers_home_profile_and_workspace_and_preserves_launch_context_on_import() {
    let fixture = Fixture::new();
    fixture.write("cordis.patch.yml", "- insert:\n  - id: local\n    name: '@deepseek-ai/dsh-mcp-client'\n    config: {serverName: docs, transport: stdio, command: docs-server, args: [--stdio], cwd: tools, toolCallTimeoutMs: 1250}\n");
    fixture.write("profiles/dev/cordis.yml", "- id: remote\n  name: '@deepseek-ai/dsh-mcp-client'\n  config: {serverName: web, transport: streamable-http, url: 'https://example.test/mcp'}\n");
    fs::write(fixture.workspace.join("cordis.yml"), "- id: project\n  name: '@deepseek-ai/dsh-mcp-client'\n  config: {serverName: project, transport: stdio, command: project-server}\n").unwrap();
    let provider = fixture.provider();
    let input = fixture.input();
    let snapshot = provider.discover(&input).unwrap();
    assert_eq!(snapshot.sources.len(), 3);
    assert_eq!(snapshot.servers.len(), 3);
    for server in &snapshot.servers {
        assert_eq!(server.static_status, ExternalMcpStaticStatus::Ready);
        let prepared = provider
            .prepare_import(&input, &server.id, &server.behavior_version)
            .unwrap();
        prepared.validate().unwrap();
        match server.name.as_str() {
            "docs" => {
                assert_eq!(
                    prepared.working_directory,
                    Some(fixture.workspace.join("tools"))
                );
                assert_eq!(prepared.timeouts.execution_ms, Some(1250));
                assert_eq!(
                    prepared.transport,
                    PreparedExternalMcpImportTransport::Local {
                        command: "docs-server".into(),
                        args: vec!["--stdio".into()]
                    }
                );
            }
            "web" => {
                assert_eq!(prepared.oauth_enabled, Some(false));
                assert_eq!(prepared.timeouts.execution_ms, Some(60_000));
            }
            "project" => assert_eq!(prepared.working_directory, Some(fixture.workspace.clone())),
            name => panic!("Unexpected server: {name}"),
        }
    }
}

#[test]
fn secrets_stay_private_and_configuration_changes_invalidate_preparation() {
    let fixture = Fixture::new();
    let body = "- id: remote\n  name: '@deepseek-ai/dsh-mcp-client'\n  config: {serverName: docs, transport: streamable-http, url: 'https://example.test/private-token?key=query-secret', headers: {Authorization: 'Bearer header-secret'}}\n";
    fixture.write("cordis.yml", body);
    let provider = fixture.provider();
    let input = fixture.input();
    let snapshot = provider.discover(&input).unwrap();
    let serialized = serde_json::to_string(&snapshot).unwrap();
    for secret in ["private-token", "query-secret", "header-secret"] {
        assert!(!serialized.contains(secret));
    }
    let server = &snapshot.servers[0];
    assert_eq!(server.static_status, ExternalMcpStaticStatus::Ready);
    assert!(provider
        .prepare_server(&input, &server.id, &server.behavior_version)
        .is_ok());
    assert_eq!(
        provider
            .prepare_import(&input, &server.id, &server.behavior_version)
            .unwrap_err()
            .code,
        "external_mcp.import_setup_required"
    );
    fixture.write(
        "cordis.yml",
        &body.replace("header-secret", "changed-secret"),
    );
    let changed = provider.discover(&input).unwrap();
    assert_ne!(changed.servers[0].behavior_version, server.behavior_version);
    assert_eq!(
        provider
            .prepare_server(&input, &server.id, &server.behavior_version)
            .unwrap_err()
            .code,
        "dsh.mcp.stale_revision"
    );
}

#[test]
fn disabled_and_lifecycle_declarations_import_but_do_not_activate() {
    let fixture = Fixture::new();
    fixture.write("cordis.yml", "- id: group\n  group: true\n  disabled: true\n  config:\n  - id: disabled\n    name: '@deepseek-ai/dsh-mcp-client'\n    config: {serverName: disabled, transport: stdio, command: docs}\n- id: dynamic\n  name: '@deepseek-ai/dsh-mcp-client'\n  config: {serverName: dynamic, transport: stdio, command: !js 'process.exit(1)'}\n- id: reconnect\n  name: '@deepseek-ai/dsh-mcp-client'\n  config: {serverName: reconnect, transport: stdio, command: docs, reconnect: {enabled: false}}\n");
    let provider = fixture.provider();
    let mut input = fixture.input();
    let snapshot = provider.discover(&input).unwrap();
    assert_eq!(snapshot.servers.len(), 3);
    for server in &snapshot.servers {
        assert_ne!(server.static_status, ExternalMcpStaticStatus::Ready);
        assert!(provider
            .prepare_server(&input, &server.id, &server.behavior_version)
            .is_err());
        assert_eq!(
            provider
                .prepare_import(&input, &server.id, &server.behavior_version)
                .is_ok(),
            server.name != "dynamic"
        );
    }
    input
        .suppressed_sources
        .insert(snapshot.sources[0].key.clone());
    let suppressed = provider.discover(&input).unwrap();
    assert_eq!(suppressed.sources.len(), 1);
    assert!(suppressed.servers.is_empty());
    for server in &snapshot.servers {
        assert!(provider
            .prepare_import(&input, &server.id, &server.behavior_version)
            .is_err());
    }
}

#[test]
fn partial_patches_duplicate_names_and_unresolved_cwd_fail_closed() {
    let fixture = Fixture::new();
    let declaration = "- id: docs\n  name: '@deepseek-ai/dsh-mcp-client'\n  config: {serverName: docs, transport: stdio, command: docs-server, cwd: tools}\n";
    let provider = fixture.provider();
    let mut input = fixture.input();
    for body in [
        format!("{declaration}- id: docs\n  config: {{command: replaced}}\n"),
        format!(
            "{declaration}{}",
            declaration.replace("id: docs", "id: other")
        ),
    ] {
        fixture.write("cordis.yml", &body);
        let snapshot = provider.discover(&input).unwrap();
        assert_eq!(snapshot.sources[0].health, ExternalSourceHealth::Degraded);
        assert!(snapshot
            .servers
            .iter()
            .all(|s| matches!(s.static_status, ExternalMcpStaticStatus::Unsupported { .. })));
    }
    fixture.write("cordis.yml", declaration);
    input.context.workspace_root = None;
    assert!(matches!(
        provider.discover(&input).unwrap().servers[0].static_status,
        ExternalMcpStaticStatus::Unsupported { .. }
    ));
}

#[test]
fn malformed_and_oversized_files_produce_explicit_errors() {
    let fixture = Fixture::new();
    let provider = fixture.provider();
    for body in ["[invalid: yaml".to_string(), "x".repeat(MAX_BYTES + 1)] {
        fixture.write("cordis.yml", &body);
        assert!(provider.discover(&fixture.input()).is_err());
    }
}

#[test]
fn import_validates_lifecycle_literals_and_fences_source_changes() {
    let fixture = Fixture::new();
    let provider = fixture.provider();
    let input = fixture.input();
    let body = "- id: docs\n  name: '@deepseek-ai/dsh-mcp-client'\n  disabled: true\n  config: {serverName: docs, transport: stdio, command: docs, failOnStartupError: true, reconnect: {enabled: true, initialDelayMs: 1500, maxAttempts: 3}}\n";
    fixture.write("cordis.yml", body);
    let snapshot = provider.discover(&input).unwrap();
    let server = &snapshot.servers[0];
    assert!(provider
        .prepare_import(&input, &server.id, &server.behavior_version)
        .is_ok());
    fixture.write(
        "cordis.yml",
        &body.replace("maxAttempts: 3", "maxAttempts: 0"),
    );
    assert!(provider
        .prepare_import(&input, &server.id, &server.behavior_version)
        .is_err());
    let invalid = provider.discover(&input).unwrap();
    let server = &invalid.servers[0];
    assert!(provider
        .prepare_import(&input, &server.id, &server.behavior_version)
        .is_err());
}
