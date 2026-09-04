//! Native skill market downloader.
//!
//! Replaces the previous `npx -y skills add <package>` shell-out. The `skills`
//! npm CLI bundles a prebuilt bun binary that aborts (V8 `__errno_location`
//! assertion) on HarmonyOS PC, so BitFun downloads GitHub-hosted skills itself
//! with pure-Rust crates (`reqwest` + `flate2` + `tar`). This works identically
//! on Windows and HarmonyOS without Node/npx/bun.
//!
//! Flow:
//! 1. Parse `install_id` (`org/repo@subdir`) into GitHub `org/repo` + subdir.
//! 2. Download `https://api.github.com/repos/{org}/{repo}/tarball` (no auth;
//!    GitHub serves tarballs anonymously, ~60 req/hour per IP).
//! 3. Gzip-decode + walk the tar, stripping the top-level `<repo>-<ref>/`
//!    folder, and extract only entries under `<subdir>/` into a staging dir.
//! 4. Verify `<staging>/SKILL.md` exists.
//! 5. Atomic swap: remove existing target, `rename(staging, target)`.
//!
//! Cross-process safety uses a unique staging dir per install plus an atomic
//! rename; the `fs2` advisory lock from `skills/builtin.rs` is intentionally
//! omitted here to avoid adding a workspace dep and because `fs2`'s `flock`
//! behavior on HarmonyOS is unverified. Concurrent installs of different
//! skills cannot collide (uuid staging names); concurrent installs of the
//! same skill resolve to last-writer-wins via the atomic rename.

use std::io::Read;
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use log::{info, warn};
use reqwest::Client;
use tar::Archive;
use tokio::fs;

use bitfun_core::agentic::tools::implementations::skills::SkillLocation;
use bitfun_core::infrastructure::get_path_manager_arc;
use bitfun_core::service::config::types::ProxyConfig;

/// Hard cap on downloaded tarball size. Skill repos are tiny (< 1 MiB typically);
/// 50 MiB is a generous ceiling to reject runaway downloads.
const MAX_SKILL_TARBALL_BYTES: usize = 50 * 1024 * 1024;

/// Result of a successful skill market install.
pub struct InstallOutcome {
    pub skill_dir_name: String,
    pub target_dir: PathBuf,
}

/// Install a skill from the market by `install_id` (`org/repo@subdir`).
///
/// `workspace_path` is required for project-level installs and ignored for
/// user-level installs. `proxy`, when enabled, is applied to the HTTP client.
pub async fn install_skill_from_market(
    package: &str,
    level: SkillLocation,
    workspace_path: Option<&Path>,
    proxy: Option<&ProxyConfig>,
) -> Result<InstallOutcome, String> {
    let trimmed = package.trim();
    if trimmed.is_empty() {
        return Err("Skill package cannot be empty".to_string());
    }

    // 1. Parse install_id -> (org/repo, subdir)
    let (org_repo, subdir) = parse_install_id(trimmed)?;
    let skill_dir_name = subdir_dir_name(&subdir)?;

    // 2. Resolve target parent + staging dir (sibling of target -> same volume)
    let target_parent = resolve_target_parent(level, workspace_path)?;
    fs::create_dir_all(&target_parent)
        .await
        .map_err(|e| format!("Failed to create skills directory: {}", e))?;
    let target_dir = target_parent.join(&skill_dir_name);
    let staging_dir = target_parent.join(format!(".installing-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&staging_dir)
        .await
        .map_err(|e| format!("Failed to create staging directory: {}", e))?;

    // 3-6. Download + extract + verify, into staging
    let work = install_to_staging(trimmed, &org_repo, &subdir, &staging_dir, proxy).await;
    if let Err(err) = work {
        let _ = fs::remove_dir_all(&staging_dir).await;
        info!(
            "Skill market install failed: package={}, staging={}, error={}",
            trimmed,
            staging_dir.display(),
            err
        );
        return Err(err);
    }

    // 7. Atomic swap
    if target_dir.exists() {
        if let Err(e) = fs::remove_dir_all(&target_dir).await {
            let _ = fs::remove_dir_all(&staging_dir).await;
            return Err(format!("Failed to remove existing skill dir: {}", e));
        }
    }
    if let Err(e) = fs::rename(&staging_dir, &target_dir).await {
        // Keep staging for diagnostics; do not delete.
        return Err(format!(
            "Failed to finalize skill install (rename {} -> {}): {}",
            staging_dir.display(),
            target_dir.display(),
            e
        ));
    }

    info!(
        "Skill market install completed: package={}, target={}",
        trimmed,
        target_dir.display()
    );

    // Persist the market install id so the scanner can report precise
    // installed-status matching instead of relying on the display name.
    let _ = fs::write(target_dir.join(".market-source"), trimmed).await;

    Ok(InstallOutcome { skill_dir_name, target_dir })
}

/// Parse `org/repo@subdir` into `(org/repo, subdir)`.
///
/// Rejects anything without a `/` before the first `@` (non-GitHub sources like
/// `id@name` are not supported by the native installer).
pub(crate) fn parse_install_id(package: &str) -> Result<(String, String), String> {
    let at_index = package
        .find('@')
        .ok_or_else(|| unsupported_source_error(package))?;
    let left = package[..at_index].trim();
    let right = package[at_index + 1..].trim();
    if !left.contains('/') || right.is_empty() {
        return Err(unsupported_source_error(package));
    }
    Ok((left.to_string(), right.to_string()))
}

fn unsupported_source_error(package: &str) -> String {
    format!(
        "Unsupported skill source '{}': native installer only supports GitHub org/repo@subdir",
        package
    )
}

/// Derive the on-disk directory name from the subdir (last path segment).
pub(crate) fn subdir_dir_name(subdir: &str) -> Result<String, String> {
    subdir
        .rsplit('/')
        .next()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Invalid skill subdir '{}': empty directory name", subdir))
}

/// Resolve the parent directory under which the skill dir lands.
fn resolve_target_parent(
    level: SkillLocation,
    workspace_path: Option<&Path>,
) -> Result<PathBuf, String> {
    match level {
        SkillLocation::Project => {
            let workspace_root = workspace_path.ok_or_else(|| {
                "No workspace open, cannot add project-level Skill".to_string()
            })?;
            Ok(workspace_root.join(".bitfun").join("skills"))
        }
        SkillLocation::User => Ok(get_path_manager_arc().user_skills_dir()),
    }
}

async fn install_to_staging(
    package: &str,
    org_repo: &str,
    subdir: &str,
    staging: &Path,
    proxy: Option<&ProxyConfig>,
) -> Result<(), String> {
    // 5. HTTP download
    let tarball_url = format!("https://api.github.com/repos/{}/tarball", org_repo);
    let client = build_download_client(proxy)?;
    let bytes = download_tarball(&client, &tarball_url).await?;

    // 6. Extract subdir into staging (also verifies SKILL.md presence and
    //    reports sample archive paths on failure for diagnostics).
    extract_subdir_from_tarball(&bytes, subdir, staging)
        .map_err(|e| format!("Failed to extract skill '{}': {}", package, e))?;
    Ok(())
}

fn build_download_client(proxy: Option<&ProxyConfig>) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
        .user_agent(concat!("BitFun/", env!("CARGO_PKG_VERSION")));
    if let Some(proxy) = proxy {
        if proxy.enabled {
            let url = proxy.url.trim();
            if !url.is_empty() {
                let normalized = normalize_proxy_url(url);
                match reqwest::Proxy::all(&normalized) {
                    Ok(p) => builder = builder.proxy(p),
                    Err(e) => warn!("Failed to configure proxy for skill download: {}", e),
                }
            }
        }
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Prefix `http://` to bare `host:port` proxy URLs (mirrors the AI adapter).
fn normalize_proxy_url(url: &str) -> String {
    if url.contains("://") {
        url.to_string()
    } else {
        format!("http://{}", url)
    }
}

async fn download_tarball(client: &Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download skill tarball from {}: {}", url, e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download skill tarball: HTTP {} from {}",
            response.status(),
            url
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read skill tarball body: {}", e))?;
    if bytes.len() > MAX_SKILL_TARBALL_BYTES {
        return Err(format!(
            "Skill tarball too large: {} bytes (max {})",
            bytes.len(),
            MAX_SKILL_TARBALL_BYTES
        ));
    }
    Ok(bytes.to_vec())
}

/// Walk the gzip+tar archive, locate the requested skill's folder, and extract
/// only that folder's contents into `staging` (so `staging/SKILL.md` exists).
///
/// Locating the skill is necessary because the skills.sh slug (`subdir`) does
/// NOT always equal the repo folder name — e.g. `vercel-labs/agent-skills`
/// has folder `react-native-skills` but slug `vercel-react-native-skills`. The
/// SKILL.md frontmatter `name` field IS the slug, so match on that first;
/// fall back to a folder-name match, then a single SKILL.md if the repo has
/// only one skill. The archive is read twice (it is in-memory); pass 1 finds
/// the skill folder, pass 2 extracts only its contents (clean staging, no
/// sibling-skill junk).
fn extract_subdir_from_tarball(
    bytes: &[u8],
    subdir: &str,
    staging: &Path,
) -> std::io::Result<()> {
    let skill_folder = find_skill_folder_in_archive(bytes, subdir)?
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!(
                    "did not contain a skill matching '{}'. The slug did not match any \
                     SKILL.md frontmatter name, any skill folder name, and the archive had \
                     more than one SKILL.md.",
                    subdir
                ),
            )
        })?;

    extract_skill_folder_contents(bytes, &skill_folder, staging)?;

    if !staging.join("SKILL.md").exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!(
                "did not contain SKILL.md at resolved skill folder '{}'",
                skill_folder
            ),
        ));
    }
    Ok(())
}

/// Pass 1: scan the archive and return the skill folder path relative to the
/// top-level wrapper folder (e.g. `skills/react-native-skills`,
/// `frontend-design`, or `""` for a SKILL.md at the repo root).
fn find_skill_folder_in_archive(bytes: &[u8], subdir: &str) -> std::io::Result<Option<String>> {
    let gz = GzDecoder::new(bytes);
    let mut archive = Archive::new(gz);

    let mut folder_name_match: Option<String> = None;
    let mut frontmatter_match: Option<String> = None;
    let mut skill_md_folders: Vec<String> = Vec::new();

    for entry in archive.entries()? {
        let mut entry = entry?;
        let entry_path = entry.path()?.into_owned();
        let entry_path_str = entry_path.to_string_lossy().replace('\\', "/");
        let Some(rest) = strip_top_level_dir(&entry_path_str) else {
            continue;
        };
        if rest.is_empty() {
            continue;
        }

        let is_skill_md = rest == "SKILL.md" || rest.ends_with("/SKILL.md");
        if !is_skill_md {
            continue;
        }

        // Skill folder = parent path of the SKILL.md (or "" at repo root).
        let folder = match rest.rfind('/') {
            Some(idx) => rest[..idx].to_string(),
            None => String::new(),
        };
        skill_md_folders.push(folder.clone());

        // Cheap check first: folder's last path segment == slug?
        if folder_name_match.is_none() {
            let last_segment = folder.rsplit('/').next().unwrap_or("");
            if last_segment == subdir {
                folder_name_match = Some(folder.clone());
            }
        }

        // Most reliable: SKILL.md frontmatter `name` == slug. Only parse if we
        // haven't matched yet (avoids reading every SKILL.md in large repos).
        if frontmatter_match.is_none() {
            if let Some(name) = read_skill_md_frontmatter_name(&mut entry) {
                if name == subdir {
                    frontmatter_match = Some(folder);
                }
            }
        }
    }

    // Prefer frontmatter match (slug == frontmatter name), then folder-name
    // match, then a single SKILL.md (repo with one skill).
    if let Some(f) = frontmatter_match {
        return Ok(Some(f));
    }
    if let Some(f) = folder_name_match {
        return Ok(Some(f));
    }
    if skill_md_folders.len() == 1 {
        return Ok(skill_md_folders.into_iter().next());
    }
    Ok(None)
}

/// Read the `name:` field from a SKILL.md YAML frontmatter. Reads the whole
/// entry so the tar iterator cleanly advances to the next entry (SKILL.md
/// files are small).
fn read_skill_md_frontmatter_name<R: std::io::Read>(reader: &mut R) -> Option<String> {
    let mut buf = String::new();
    reader.read_to_string(&mut buf).ok()?;
    parse_frontmatter_name(&buf)
}

fn parse_frontmatter_name(content: &str) -> Option<String> {
    // Frontmatter sits between leading `---` lines.
    let after_open = if let Some(rest) = content.strip_prefix("---\n") {
        rest
    } else if let Some(rest) = content.strip_prefix("---\r\n") {
        rest
    } else {
        content
    };
    for line in after_open.lines() {
        let line = line.trim_end_matches('\r');
        if line == "---" {
            break;
        }
        if let Some(rest) = line.strip_prefix("name:") {
            let val = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            if !val.is_empty() {
                return Some(val);
            }
        }
    }
    None
}

/// Pass 2: extract entries under `{top-level}/{skill_folder}/` to `staging`
/// root (so SKILL.md lands at `staging/SKILL.md`).
fn extract_skill_folder_contents(
    bytes: &[u8],
    skill_folder: &str,
    staging: &Path,
) -> std::io::Result<()> {
    let gz = GzDecoder::new(bytes);
    let mut archive = Archive::new(gz);
    let folder_prefix = if skill_folder.is_empty() {
        String::new()
    } else {
        format!("{}/", skill_folder)
    };

    for entry in archive.entries()? {
        let mut entry = entry?;
        let entry_path = entry.path()?.into_owned();
        let entry_path_str = entry_path.to_string_lossy().replace('\\', "/");
        let Some(rest) = strip_top_level_dir(&entry_path_str) else {
            continue;
        };
        if rest.is_empty() {
            continue;
        }

        // Keep only entries under the resolved skill folder.
        let relative = if skill_folder.is_empty() {
            // SKILL.md at the repo root: the whole repo is the skill. Keep all
            // entries (rare; the common case has a non-empty folder).
            rest
        } else if rest == skill_folder {
            continue;
        } else if let Some(stripped) = rest.strip_prefix(&folder_prefix) {
            stripped.to_string()
        } else {
            continue;
        };

        let safe_relative = validate_relative_path(&relative)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let target = staging.join(&safe_relative);

        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            entry.unpack(&target)?;
        }
    }
    Ok(())
}

/// Strip the first path segment (the GitHub `<repo>-<ref>` folder). Returns the
/// remainder without a leading slash, or `None` if the entry is the top-level
/// folder itself or has no sub-path.
fn strip_top_level_dir(path: &str) -> Option<String> {
    // splitn(2, '/') yields [first_segment, rest_after_first_slash]; the
    // remainder retains any subsequent slashes, which is what we want when
    // locating `<subdir>/...` under the top-level `<repo>-<ref>/` folder.
    let mut parts = path.splitn(2, '/');
    let first = parts.next()?;
    if first.is_empty() {
        return None;
    }
    let rest = parts.next()?;
    if rest.is_empty() {
        return None;
    }
    Some(rest.to_string())
}

/// Reject path traversal and absolute paths inside the extracted subdir.
fn validate_relative_path(path: &str) -> Result<String, String> {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(format!("Refusing to extract absolute path: {}", normalized));
    }
    for segment in normalized.split('/') {
        if segment == ".." {
            return Err(format!("Refusing to extract path with '..': {}", normalized));
        }
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::Compression;
    use std::io::Write;

    fn build_tarball(entries: &[(&str, &str)]) -> Vec<u8> {
        // entries: (path, contents); path is the full path inside the tar,
        // already including the top-level `<repo>-<ref>/` folder.
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, Compression::none());
            let mut builder = tar::Builder::new(encoder);
            for (path, contents) in entries {
                let mut header = tar::Header::new_gnu();
                header.set_size(contents.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                builder.append_data(&mut header, path, std::io::Cursor::new(contents.as_bytes()))
                    .expect("append file");
            }
            builder.finish().expect("finish tar");
        }
        buf
    }

    #[test]
    fn parse_install_id_accepts_github_form() {
        let (org_repo, subdir) = parse_install_id("anthropics/skills@frontend-design").unwrap();
        assert_eq!(org_repo, "anthropics/skills");
        assert_eq!(subdir, "frontend-design");
    }

    #[test]
    fn parse_install_id_accepts_nested_subdir() {
        let (org_repo, subdir) = parse_install_id("org/repo@foo/bar/baz").unwrap();
        assert_eq!(org_repo, "org/repo");
        assert_eq!(subdir, "foo/bar/baz");
    }

    #[test]
    fn parse_install_id_rejects_no_at() {
        let err = parse_install_id("anthropics/skills").unwrap_err();
        assert!(err.contains("only supports GitHub org/repo@subdir"));
    }

    #[test]
    fn parse_install_id_rejects_no_slash_before_at() {
        let err = parse_install_id("anthropics@frontend-design").unwrap_err();
        assert!(err.contains("only supports GitHub org/repo@subdir"));
    }

    #[test]
    fn parse_install_id_rejects_empty_subdir() {
        let err = parse_install_id("anthropics/skills@").unwrap_err();
        assert!(err.contains("only supports GitHub org/repo@subdir"));
    }

    #[test]
    fn subdir_dir_name_takes_last_segment() {
        assert_eq!(subdir_dir_name("frontend-design").unwrap(), "frontend-design");
        assert_eq!(subdir_dir_name("foo/bar/baz").unwrap(), "baz");
    }

    #[test]
    fn subdir_dir_name_rejects_trailing_slash() {
        assert!(subdir_dir_name("foo/").is_err());
    }

    #[test]
    fn validate_relative_path_accepts_normal() {
        assert_eq!(validate_relative_path("SKILL.md").unwrap(), "SKILL.md");
        assert_eq!(validate_relative_path("examples/app.ts").unwrap(), "examples/app.ts");
    }

    #[test]
    fn validate_relative_path_rejects_parent_traversal() {
        let err = validate_relative_path("../escape.md").unwrap_err();
        assert!(err.contains("'..'"));
        let err = validate_relative_path("foo/../../escape.md").unwrap_err();
        assert!(err.contains("'..'"));
    }

    #[test]
    fn validate_relative_path_rejects_absolute() {
        let err = validate_relative_path("/etc/passwd").unwrap_err();
        assert!(err.contains("absolute"));
    }

    #[test]
    fn extract_subdir_from_tarball_extracts_only_subdir() {
        // Top-level folder emulates GitHub's `<repo>-<ref>/` wrapper.
        let tarball = build_tarball(&[
            ("repo-abc123/frontend-design/SKILL.md", "---\nname: x\n---\nbody"),
            ("repo-abc123/frontend-design/examples/app.ts", "// code"),
            ("repo-abc123/other-skill/SKILL.md", "should be skipped"),
            ("repo-abc123/README.md", "repo root, skipped"),
        ]);
        let tmp = tempfile::tempdir().expect("tempdir");
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();

        extract_subdir_from_tarball(&tarball, "frontend-design", &staging).unwrap();

        assert!(staging.join("SKILL.md").exists());
        assert!(staging.join("examples").join("app.ts").exists());
        // other-skill and repo root must NOT leak in.
        assert!(!staging.join("other-skill").exists());
        assert!(!staging.join("README.md").exists());
    }

    #[test]
    fn extract_subdir_from_tarball_rejects_traversal_entry() {
        // A malicious archive that places a `..` segment under the subdir.
        let tarball = build_tarball(&[
            ("repo-abc123/frontend-design/SKILL.md", "---\nname: x\n---\nbody"),
            ("repo-abc123/frontend-design/../escape.md", "pwn"),
        ]);
        let tmp = tempfile::tempdir().expect("tempdir");
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();

        let err = extract_subdir_from_tarball(&tarball, "frontend-design", &staging)
            .expect_err("traversal must be rejected");
        let msg = format!("{}", err);
        assert!(msg.contains("..") || msg.contains("traversal") || msg.contains("'..'"));
    }

    #[test]
    fn extract_subdir_matches_by_frontmatter_name_when_folder_differs() {
        // skills.sh slug (`vercel-react-native-skills`) != repo folder
        // (`react-native-skills`); the SKILL.md frontmatter `name` IS the slug.
        // Mirrors the real vercel-labs/agent-skills layout.
        let skill_md = "---\nname: vercel-react-native-skills\ndescription: rn\n---\n# RN";
        let other_md = "---\nname: some-other-skill\ndescription: x\n---\n";
        let tarball = build_tarball(&[
            ("repo-abc/skills/react-native-skills/SKILL.md", skill_md),
            ("repo-abc/skills/react-native-skills/rules/foo.md", "rule"),
            ("repo-abc/skills/other-skill/SKILL.md", other_md),
            ("repo-abc/README.md", "repo root"),
        ]);
        let tmp = tempfile::tempdir().expect("tempdir");
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();

        extract_subdir_from_tarball(&tarball, "vercel-react-native-skills", &staging)
            .expect("frontmatter match must resolve the skill");

        assert!(staging.join("SKILL.md").exists());
        assert!(staging.join("rules").join("foo.md").exists());
        // The other skill and repo root must NOT leak into staging.
        assert!(!staging.join("other-skill").exists());
        assert!(!staging.join("skills").exists());
        assert!(!staging.join("README.md").exists());
        let installed = std::fs::read_to_string(staging.join("SKILL.md")).unwrap();
        assert!(installed.contains("vercel-react-native-skills"));
    }
}
