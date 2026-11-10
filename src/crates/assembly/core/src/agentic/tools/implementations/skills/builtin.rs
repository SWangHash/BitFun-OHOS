//! Built-in skills shipped with BitFun.
//!
//! These skills are embedded into the `bitfun-core` binary and installed into a
//! managed `.system` directory under the user skills root on demand.

use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::BitFunResult;
use fs2::FileExt;
use include_dir::{include_dir, Dir};
use log::{debug, error, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;
use tokio::task;

static BUILTIN_SKILLS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/builtin_skills");
static BUILTIN_SKILL_DIR_NAMES: OnceLock<HashSet<String>> = OnceLock::new();
include!(concat!(env!("OUT_DIR"), "/embedded_builtin_skills.rs"));

const BUILTIN_SKILLS_MANIFEST_FILE_NAME: &str = ".manifest.json";
const BUILTIN_SKILLS_INSTALL_LOCK_FILE_NAME: &str = ".system.install.lock";

/// Prefix of the installer staging directories created under the user skills
/// root. A staging directory is renamed over `.system` on success; a surviving
/// one is an orphan from an interrupted install and must never surface as a
/// discoverable skill root (see [`sweep_stale_staging_roots`] and the matching
/// scanner guard in `registry::discovery`).
pub(super) const BUILTIN_SKILLS_STAGING_PREFIX: &str = ".system.tmp";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BuiltinSkillsManifest {
    bundle_hash: String,
}

struct BuiltinSkillsInstallLock {
    file: std::fs::File,
}

impl Drop for BuiltinSkillsInstallLock {
    fn drop(&mut self) {
        if let Err(error) = self.file.unlock() {
            warn!("Failed to unlock built-in skills install lock: {}", error);
        }
    }
}

fn collect_builtin_skill_dir_names() -> HashSet<String> {
    BUILTIN_SKILLS_DIR
        .dirs()
        .filter_map(|dir| {
            let rel = dir.path();
            if rel.components().count() != 1 {
                return None;
            }

            rel.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string())
        })
        .collect()
}

pub fn builtin_skill_dir_names() -> &'static HashSet<String> {
    BUILTIN_SKILL_DIR_NAMES.get_or_init(collect_builtin_skill_dir_names)
}

pub fn builtin_skills_bundle_hash() -> &'static str {
    BUILTIN_SKILLS_BUNDLE_HASH
}

pub fn is_builtin_skill_dir_name(dir_name: &str) -> bool {
    builtin_skill_dir_names().contains(dir_name)
}

fn builtin_skills_manifest_path(root: &Path) -> PathBuf {
    root.join(BUILTIN_SKILLS_MANIFEST_FILE_NAME)
}

fn builtin_skills_install_lock_path(root: &Path) -> PathBuf {
    root.join(BUILTIN_SKILLS_INSTALL_LOCK_FILE_NAME)
}

fn builtin_skills_staging_root(parent: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    parent.join(format!(
        "{}.{}.{}",
        BUILTIN_SKILLS_STAGING_PREFIX,
        std::process::id(),
        timestamp
    ))
}

/// Remove staging directories left under the user skills root by an
/// interrupted install. Callers hold the built-in skills install lock, so no
/// other install can be in flight and every staging directory found here is an
/// orphan. A leftover staging directory would otherwise shadow `.system`
/// during skill discovery, because the nested skill directories look like
/// explicitly installed user skills. Removal failures are logged and skipped:
/// the scanner keeps orphans out of discovery independently, so a failed sweep
/// must not fail the install itself.
async fn sweep_stale_staging_roots(user_skills_root: &Path) {
    let mut entries = match fs::read_dir(user_skills_root).await {
        Ok(entries) => entries,
        Err(error) => {
            warn!(
                "Failed to read user skills directory while sweeping stale built-in skills staging directories: path={}, error={}",
                user_skills_root.display(),
                error
            );
            return;
        }
    };
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(error) => {
                warn!(
                    "Failed to list user skills directory while sweeping stale built-in skills staging directories: path={}, error={}",
                    user_skills_root.display(),
                    error
                );
                break;
            }
        };
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with(BUILTIN_SKILLS_STAGING_PREFIX)
        {
            continue;
        }
        let path = entry.path();
        match fs::remove_dir_all(&path).await {
            Ok(()) => warn!(
                "Removed a stale built-in skills staging directory left by an interrupted install: path={}",
                path.display()
            ),
            Err(error) => warn!(
                "Failed to remove a stale built-in skills staging directory: path={}, error={}",
                path.display(),
                error
            ),
        }
    }
}

async fn read_installed_manifest(root: &Path) -> BitFunResult<Option<BuiltinSkillsManifest>> {
    let path = builtin_skills_manifest_path(root);
    match fs::read_to_string(&path).await {
        Ok(content) => match serde_json::from_str::<BuiltinSkillsManifest>(&content) {
            Ok(manifest) => Ok(Some(manifest)),
            Err(error) => {
                warn!(
                    "Invalid built-in skills manifest at {}: {}",
                    path.display(),
                    error
                );
                Ok(None)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

async fn write_installed_manifest(root: &Path) -> BitFunResult<()> {
    let path = builtin_skills_manifest_path(root);
    let manifest = BuiltinSkillsManifest {
        bundle_hash: builtin_skills_bundle_hash().to_string(),
    };
    let content = serde_json::to_vec_pretty(&manifest)?;
    fs::write(path, content).await?;
    Ok(())
}

async fn acquire_install_lock(user_skills_root: &Path) -> BitFunResult<BuiltinSkillsInstallLock> {
    let lock_path = builtin_skills_install_lock_path(user_skills_root);

    // Use an OS-backed advisory file lock so parallel test processes and app
    // instances serialize built-in skill installation across the shared
    // `.system` directory.
    let file = task::spawn_blocking(move || -> BitFunResult<std::fs::File> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&lock_path)?;
        file.lock_exclusive()?;
        Ok(file)
    })
    .await
    .map_err(|error| {
        crate::util::errors::BitFunError::io(format!(
            "Failed to join built-in skills install lock task: {}",
            error
        ))
    })??;

    Ok(BuiltinSkillsInstallLock { file })
}

async fn install_builtin_skills_to_staging(staging_root: &Path) -> BitFunResult<(usize, usize)> {
    let mut installed = 0usize;
    let mut updated = 0usize;

    for skill_dir in BUILTIN_SKILLS_DIR.dirs() {
        let rel = skill_dir.path();
        if rel.components().count() != 1 {
            continue;
        }

        let stats = sync_dir(skill_dir, staging_root).await?;
        installed += stats.installed;
        updated += stats.updated;
    }

    write_installed_manifest(staging_root).await?;
    Ok((installed, updated))
}

pub async fn ensure_builtin_skills_installed() -> BitFunResult<()> {
    let pm = get_path_manager_arc();
    ensure_builtin_skills_installed_at(&pm.user_skills_dir()).await
}

async fn ensure_builtin_skills_installed_at(user_skills_root: &Path) -> BitFunResult<()> {
    let dest_root = user_skills_root.join(".system");

    // Create the parent user skills directory before taking the shared install
    // lock so every contender points at the same stable path.
    if let Err(e) = fs::create_dir_all(&user_skills_root).await {
        error!(
            "Failed to create user skills directory: path={}, error={}",
            user_skills_root.display(),
            e
        );
        return Err(e.into());
    }

    let _install_lock = acquire_install_lock(&user_skills_root).await?;

    // Sweep before the manifest check: an up-to-date bundle must still sweep,
    // and holding the lock means every staging directory left here is an
    // orphan from an interrupted install.
    sweep_stale_staging_roots(&user_skills_root).await;

    if let Some(manifest) = read_installed_manifest(&dest_root).await? {
        if manifest.bundle_hash == builtin_skills_bundle_hash() {
            return Ok(());
        }
    }

    let staging_root = builtin_skills_staging_root(user_skills_root);
    fs::create_dir(&staging_root).await?;
    // A packaged Windows parent can virtualize a newly created AppData child
    // onto another volume even when the logical parent already exists on C:.
    // Publish both paths through the created directory's physical parent.
    let staging_root = fs::canonicalize(&staging_root).await?;
    let publish_parent = staging_root.parent().ok_or_else(|| {
        crate::util::errors::BitFunError::io("Built-in skills staging parent is unavailable")
    })?;
    let dest_root = publish_parent.join(".system");

    let publish_result = async {
        let (installed, updated) = install_builtin_skills_to_staging(&staging_root).await?;

        publish_staged_skills(&staging_root, &dest_root).await?;

        if installed > 0 || updated > 0 {
            debug!(
                "Built-in skills synchronized: installed={}, updated={}, dest_root={}",
                installed,
                updated,
                dest_root.display()
            );
        }

        Ok(())
    }
    .await;

    if let Err(error) = fs::remove_dir_all(&staging_root).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            warn!(
                "Failed to remove built-in skills staging directory {}: {}",
                staging_root.display(),
                error
            );
        }
    }

    publish_result
}

async fn publish_staged_skills(staging_root: &Path, dest_root: &Path) -> BitFunResult<()> {
    // Only replace the managed bundle, with a rollback copy on the same volume.
    let parent = staging_root.parent().ok_or_else(|| {
        crate::util::errors::BitFunError::io("Built-in skills staging parent is unavailable")
    })?;
    if !staging_root.is_absolute() || dest_root != parent.join(".system") {
        return Err(crate::util::errors::BitFunError::validation(
            "Built-in skills publication paths do not share the managed parent".to_string(),
        ));
    }
    if let Ok(metadata) = fs::symlink_metadata(dest_root).await {
        if metadata.file_type().is_symlink() {
            return Err(crate::util::errors::BitFunError::validation(
                "The managed built-in skills directory must not be a symbolic link".to_string(),
            ));
        }
    }
    let name = staging_root.file_name().ok_or_else(|| {
        crate::util::errors::BitFunError::io("Built-in skills staging name is unavailable")
    })?;
    let backup = parent.join(format!("{}.previous", name.to_string_lossy()));
    let previous = match fs::rename(dest_root, &backup).await {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    if let Err(error) = fs::rename(staging_root, dest_root).await {
        if previous {
            if let Err(restore_error) = fs::rename(&backup, dest_root).await {
                error!(
                    "Failed to restore built-in skills bundle: backup={}, destination={}, error={}",
                    backup.display(),
                    dest_root.display(),
                    restore_error
                );
            }
        }
        return Err(error.into());
    }
    if previous {
        if let Err(error) = fs::remove_dir_all(&backup).await {
            warn!(
                "Failed to remove previous built-in skills bundle: path={}, error={}",
                backup.display(),
                error
            );
        }
    }
    Ok(())
}

#[derive(Default)]
struct SyncStats {
    installed: usize,
    updated: usize,
}

async fn sync_dir(dir: &Dir<'_>, dest_root: &Path) -> BitFunResult<SyncStats> {
    let mut files: Vec<&include_dir::File<'_>> = Vec::new();
    collect_files(dir, &mut files);

    let mut stats = SyncStats::default();
    for file in files.into_iter() {
        let dest_path = safe_join(dest_root, file.path())?;
        let desired = desired_file_content(file, &dest_path).await?;

        if let Ok(current) = fs::read(&dest_path).await {
            if current == desired {
                continue;
            }
        }

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        let existed = dest_path.exists();
        fs::write(&dest_path, desired).await?;
        if existed {
            stats.updated += 1;
        } else {
            stats.installed += 1;
        }
    }

    Ok(stats)
}

fn collect_files<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a include_dir::File<'a>>) {
    for file in dir.files() {
        out.push(file);
    }

    for sub in dir.dirs() {
        collect_files(sub, out);
    }
}

fn safe_join(root: &Path, relative: &Path) -> BitFunResult<PathBuf> {
    if relative.is_absolute() {
        return Err(crate::util::errors::BitFunError::validation(format!(
            "Unexpected absolute path in built-in skills: {}",
            relative.display()
        )));
    }

    // Prevent `..` traversal even though include_dir should only contain clean relative paths.
    for c in relative.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err(crate::util::errors::BitFunError::validation(format!(
                "Unexpected parent dir component in built-in skills path: {}",
                relative.display()
            )));
        }
    }

    Ok(root.join(relative))
}

async fn desired_file_content(
    file: &include_dir::File<'_>,
    _dest_path: &Path,
) -> BitFunResult<Vec<u8>> {
    Ok(file.contents().to_vec())
}

#[cfg(test)]
mod tests {
    use super::BUILTIN_SKILLS_DIR;
    use bitfun_agent_runtime::skills::{SkillData, SkillLocation};

    #[tokio::test]
    async fn installation_reuses_a_complete_manifest_without_rewriting_the_bundle() {
        let root = tempfile::tempdir().unwrap();
        super::ensure_builtin_skills_installed_at(root.path())
            .await
            .unwrap();
        let installed = root.path().join(".system");
        let marker = installed.join("cache-reuse-marker");
        tokio::fs::write(&marker, b"retained").await.unwrap();
        super::ensure_builtin_skills_installed_at(root.path())
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(marker).await.unwrap(), b"retained");
        assert!(installed.join("create-agent/SKILL.md").is_file());
        assert_eq!(
            super::read_installed_manifest(&installed)
                .await
                .unwrap()
                .unwrap()
                .bundle_hash,
            super::builtin_skills_bundle_hash()
        );
    }

    #[tokio::test]
    async fn publication_replaces_retired_files_and_preserves_the_old_bundle_on_failure() {
        let root = tempfile::tempdir().unwrap();
        let parent = tokio::fs::canonicalize(root.path()).await.unwrap();
        let dest = parent.join(".system");
        tokio::fs::create_dir(&dest).await.unwrap();
        tokio::fs::write(dest.join("old"), b"old bundle")
            .await
            .unwrap();
        let missing = parent.join(".system.tmp.missing");
        assert!(super::publish_staged_skills(&missing, &dest).await.is_err());
        assert_eq!(
            tokio::fs::read(dest.join("old")).await.unwrap(),
            b"old bundle"
        );
        let staging = parent.join(".system.tmp.new");
        tokio::fs::create_dir(&staging).await.unwrap();
        tokio::fs::write(staging.join("new"), b"new bundle")
            .await
            .unwrap();
        super::publish_staged_skills(&staging, &dest).await.unwrap();
        assert_eq!(
            tokio::fs::read(dest.join("new")).await.unwrap(),
            b"new bundle"
        );
        assert!(!dest.join("old").exists());
        assert!(!parent.join(".system.tmp.new.previous").exists());
    }

    fn embedded_skill_text(path: &str) -> &'static str {
        BUILTIN_SKILLS_DIR
            .get_file(path)
            .unwrap_or_else(|| panic!("Missing embedded built-in skill file: {path}"))
            .contents_utf8()
            .unwrap_or_else(|| panic!("Built-in skill file is not UTF-8: {path}"))
    }

    #[test]
    fn custom_agent_skill_embeds_parseable_templates() {
        use bitfun_agent_runtime::custom_agent::{
            custom_agent_read_markdown_str, default_custom_agent_tools,
            default_custom_agent_user_context_policy, CustomAgentKind, CustomAgentLevel,
            CUSTOM_AGENT_SCHEMA_VERSION,
        };

        let skill = SkillData::from_markdown(
            "/bitfun-system/create-agent".to_string(),
            embedded_skill_text("create-agent/SKILL.md"),
            SkillLocation::User,
            true,
        )
        .expect("agent authoring skill should parse");
        assert_eq!(skill.name, "create-agent");
        assert!(!embedded_skill_text("create-agent/references/tool-catalog.md").is_empty());

        for (path, kind, levels, readonly, model, default_tools) in [
            (
                "create-agent/assets/mode.md",
                CustomAgentKind::Mode,
                vec![CustomAgentLevel::User],
                false,
                "primary",
                true,
            ),
            (
                "create-agent/assets/subagent.md",
                CustomAgentKind::Subagent,
                vec![CustomAgentLevel::User, CustomAgentLevel::Project],
                true,
                "fast",
                false,
            ),
        ] {
            for level in levels {
                let parsed = custom_agent_read_markdown_str(embedded_skill_text(path), level)
                    .expect("embedded agent template should parse");
                let definition = parsed.definition;
                assert_eq!(
                    parsed.metadata.schema_version,
                    Some(CUSTOM_AGENT_SCHEMA_VERSION)
                );
                assert!(!parsed.metadata.generated_id_from_name);
                assert_eq!(parsed.metadata.used_default_tools, default_tools);
                assert_eq!(definition.kind, kind);
                assert_eq!(definition.level, level);
                assert_eq!(definition.readonly, readonly);
                assert!(!definition.review);
                assert_eq!(definition.model, model);
                assert!(!definition.model_is_explicit);
                assert!(!definition.should_save_model());
                assert_eq!(definition.tools, default_custom_agent_tools(kind));
                assert_eq!(
                    definition.user_context_policy,
                    default_custom_agent_user_context_policy(kind)
                );
                assert!(!definition.name.trim().is_empty());
                assert!(!definition.description.trim().is_empty());
                assert!(!definition.prompt.trim().is_empty());
            }
        }
    }

    #[test]
    fn plan_skill_embeds_a_valid_plan_artifact_workflow() {
        let text = embedded_skill_text("plan/SKILL.md");
        let skill = SkillData::from_markdown(
            "/bitfun-system/plan".to_string(),
            text,
            SkillLocation::User,
            true,
        )
        .expect("built-in plan skill should parse");

        assert_eq!(skill.name, "plan");
        assert!(skill
            .content
            .contains(".bitfun/plans/<short-kebab-name>.plan.md"));
        assert!(skill
            .content
            .contains("overview: One or two sentence overview"));
        assert!(!skill.content.contains("status: pending"));
        assert!(skill
            .content
            .contains("system prompt's `Language Preference`"));
    }

    #[test]
    fn debug_skill_embeds_the_canonical_name_and_log_receiver() {
        let text = embedded_skill_text("debug/SKILL.md");
        let skill = SkillData::from_markdown(
            "/bitfun-system/debug".to_string(),
            text,
            SkillLocation::User,
            true,
        )
        .expect("built-in debug skill should parse");

        assert_eq!(skill.name, "debug");
        assert!(BUILTIN_SKILLS_DIR
            .get_file("debug/scripts/debug-log-server.mjs")
            .is_some());
    }

    #[test]
    fn qt_migration_bundle_keeps_the_bitfun_acquisition_scripts() {
        // The Qt migration `__official__` guidance hands the model these absolute
        // paths, and the migration scan reads the shared root they install into. A
        // bundle refresh that drops them leaves only the vendored upstream copies,
        // which require an explicit --dest outside the scanned root.
        for path in [
            "ohos-qt-skills/scripts/bitfun-resource-root.sh",
            "ohos-qt-skills/scripts/bitfun-download-template.sh",
            "ohos-qt-skills/scripts/bitfun-download-qt-sdk.sh",
        ] {
            assert!(
                BUILTIN_SKILLS_DIR.get_file(path).is_some(),
                "the built-in Qt migration skill is missing {path}"
            );
        }
    }

    #[test]
    fn canvas_skills_keep_internal_artifact_references_out_of_chat() {
        for path in [
            "bitfun-canvas/SKILL.md",
            "pr-review-canvas/SKILL.md",
            "agent-eval-canvas/SKILL.md",
        ] {
            let text = embedded_skill_text(path);
            assert!(
                text.contains("automatically"),
                "{path} must tell the agent to leave Canvas URI presentation to the client"
            );
            assert!(
                !text.contains("give the returned `bitfun-canvas://...` artifact reference"),
                "{path} still instructs the agent to expose an internal Canvas URI"
            );
        }
    }

    #[test]
    fn agent_browser_uses_dynamic_cli_documentation_only() {
        let text = embedded_skill_text("agent-browser/SKILL.md");
        assert!(text.contains("agent-browser skills get core"));
        assert!(text.contains("agent-browser skills get core --full"));
        assert!(text.contains("agent-browser skills list"));
        assert!(text.contains("agent-browser skills get electron"));
        assert!(text.contains("agent-browser skills get dogfood"));
        assert!(text.contains("npm i -g agent-browser@0.32.3"));
        assert!(text.contains("Install only after user approval"));
        assert!(text.contains("do not silently switch tools"));
        assert!(text.contains("native Rust"));
        assert!(!text.contains("npx playwright install-deps"));

        let dir = BUILTIN_SKILLS_DIR
            .get_dir("agent-browser")
            .expect("agent-browser directory should be embedded");
        assert!(
            dir.dirs().next().is_none(),
            "dynamic agent-browser stub must not retain static reference/template directories"
        );
    }

    #[test]
    fn create_bitfun_skin_embeds_authoring_contract_and_example() {
        let skill = embedded_skill_text("create-bitfun-skin/SKILL.md");
        assert!(skill.contains("name: create-bitfun-skin"));

        let registry =
            embedded_skill_text("create-bitfun-skin/references/appearance-registry.json");
        assert!(registry.contains("schemaVersion"));

        let example = embedded_skill_text(
            "create-bitfun-skin/examples/cinematic-animated-wallpaper/SKILL.md",
        );
        assert!(example.contains("cinematic animated-wallpaper"));

        let metadata = embedded_skill_text("create-bitfun-skin/agents/openai.yaml");
        assert!(metadata.contains("display_name: \"BitFun Appearance Manual\""));

        let workflow = embedded_skill_text("create-bitfun-skin/references/authoring-workflow.md");
        assert!(workflow.contains("Bump it whenever the manifest"));
    }

    #[test]
    fn commit_push_pr_is_bundled_with_attribution_and_owns_lightweight_pr_requests() {
        let skill = embedded_skill_text("commit-push-pr/SKILL.md");
        assert!(skill.contains("name: commit-push-pr"));
        assert!(
            skill.contains("Co-authored-by: BitFun <318544290+bitfun-ai@users.noreply.github.com>")
        );
        assert!(skill.contains("Generated with [BitFun](https://github.com/bitfun-ai)"));
    }

    #[test]
    fn redistribution_restricted_skills_are_not_embedded() {
        for skill in ["docx", "pdf", "pptx", "xlsx"] {
            assert!(
                BUILTIN_SKILLS_DIR.get_dir(skill).is_none(),
                "redistribution-restricted skill {skill} must not be embedded"
            );
        }
    }

    #[tokio::test]
    async fn install_sweep_removes_only_stale_staging_directories() {
        let temp = tempfile::tempdir().unwrap();
        let stale = temp.path().join(".system.tmp.49832.1000");
        std::fs::create_dir_all(stale.join("ohos-qt-skills")).unwrap();
        std::fs::write(stale.join("ohos-qt-skills").join("SKILL.md"), "stale").unwrap();
        std::fs::create_dir_all(temp.path().join(".system")).unwrap();
        std::fs::write(temp.path().join(".system").join("SKILL.md"), "keep").unwrap();
        std::fs::create_dir_all(temp.path().join("my-skill")).unwrap();

        super::sweep_stale_staging_roots(temp.path()).await;

        assert!(!stale.exists(), "a stale staging directory must be swept");
        assert!(
            temp.path().join(".system").join("SKILL.md").exists(),
            "the managed .system directory is not staging and must be kept"
        );
        assert!(
            temp.path().join("my-skill").exists(),
            "explicitly installed user skills must be kept"
        );
    }
}
