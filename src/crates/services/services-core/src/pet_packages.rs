//! Bounded local Petdex package IO. Hosts provide source and destination roots.
use base64::Engine;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
};

const MANIFEST_LIMIT: u64 = 64 * 1024;
const IMAGE_LIMIT: u64 = 32 * 1024 * 1024;
const ARCHIVE_LIMIT: u64 = 64 * 1024 * 1024;
const RECEIPT: &str = ".openbitfun-import.json";
const MAX_PACKAGES: usize = 128;
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPackage {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub source: String,
    pub package_path: String,
    pub spritesheet_path: String,
    pub spritesheet_mime_type: String,
    #[serde(default = "legacy_version")]
    pub sprite_version_number: u32,
}
fn legacy_version() -> u32 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    schema_version: u32,
    source_key: String,
    fingerprint: String,
    installed_fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCandidate {
    pub source_key: String,
    pub fingerprint: String,
    pub pet: PetPackage,
    pub preview_data_url: String,
    pub imported: Option<PetPackage>,
    pub copy_modified: bool,
    pub source_changed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builtin_id: Option<String>,
}
#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCatalog {
    pub candidates: Vec<PetCandidate>,
    pub diagnostics: Vec<String>,
}

struct Loaded {
    manifest: serde_json::Value,
    image: Vec<u8>,
    name: String,
    mime: String,
    fingerprint: String,
    preview: String,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn source_key(path: &Path) -> Result<String> {
    let canonical = dunce::canonicalize(path).map_err(|e| e.to_string())?;
    let identity = canonical.to_string_lossy().into_owned();
    #[cfg(windows)]
    let identity = identity.to_lowercase();
    Ok(hash(identity.as_bytes()))
}
fn read_bounded(reader: impl Read, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Pet package resource exceeds its size limit".into());
    }
    Ok(bytes)
}
fn read_file(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("Pet resource must be a regular file".into());
    }
    read_bounded(fs::File::open(path).map_err(|e| e.to_string())?, limit)
}
fn relative_resource(value: &str) -> Result<PathBuf> {
    // Interpret the portable manifest path consistently on every platform.
    if value.contains(':') || value.contains('\\') {
        return Err("Invalid pet resource path".into());
    }
    let path = PathBuf::from(value);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Pet resource must stay inside its package".into());
    }
    Ok(path)
}
fn manifest(bytes: &[u8]) -> Result<(serde_json::Value, PathBuf, u32)> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let version = match value.get("spriteVersionNumber") {
        None => 1,
        Some(v) => v
            .as_u64()
            .filter(|n| *n == 1 || *n == 2)
            .ok_or("Unsupported pet sprite version")? as u32,
    };
    let path = relative_resource(
        value
            .get("spritesheetPath")
            .and_then(|v| v.as_str())
            .ok_or("Missing spritesheetPath")?,
    )?;
    Ok((value, path, version))
}
fn load(path: &Path, preview: bool) -> Result<Loaded> {
    let (manifest_bytes, image_bytes) = if path.is_dir() {
        let root = dunce::canonicalize(path).map_err(|e| e.to_string())?;
        let bytes = read_file(&root.join("pet.json"), MANIFEST_LIMIT)?;
        let (_, relative, _) = manifest(&bytes)?;
        let sprite = root.join(relative);
        let resolved = dunce::canonicalize(&sprite).map_err(|e| e.to_string())?;
        if !resolved.starts_with(&root) {
            return Err("Pet resource escapes its package".into());
        }
        (bytes, read_file(&sprite, IMAGE_LIMIT)?)
    } else {
        let bytes = read_file(path, ARCHIVE_LIMIT)?;
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        if archive.len() > 256 {
            return Err("Pet archive has too many entries".into());
        }
        let mut manifests = Vec::new();
        for i in 0..archive.len() {
            let entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = relative_resource(entry.name().trim_end_matches('/'))?;
            if name.file_name().is_some_and(|n| n == "pet.json") {
                manifests.push(entry.name().to_string());
            }
        }
        if manifests.len() != 1 {
            return Err("Pet archive must contain exactly one pet.json".into());
        }
        let name = &manifests[0];
        let bytes = read_bounded(
            archive.by_name(name).map_err(|e| e.to_string())?,
            MANIFEST_LIMIT,
        )?;
        let (_, relative, _) = manifest(&bytes)?;
        let sprite = Path::new(name)
            .parent()
            .unwrap_or(Path::new(""))
            .join(relative)
            .to_string_lossy()
            .replace('\\', "/");
        let image = read_bounded(
            archive.by_name(&sprite).map_err(|e| e.to_string())?,
            IMAGE_LIMIT,
        )?;
        (bytes, image)
    };
    decode(&manifest_bytes, image_bytes, preview)
}

fn decode(manifest_bytes: &[u8], image_bytes: Vec<u8>, preview: bool) -> Result<Loaded> {
    if manifest_bytes.len() as u64 > MANIFEST_LIMIT || image_bytes.len() as u64 > IMAGE_LIMIT {
        return Err("Pet package resource exceeds its size limit".into());
    }
    let (value, resource, version) = manifest(manifest_bytes)?;
    let extension = resource
        .extension()
        .and_then(|v| v.to_str())
        .ok_or("Missing pet image extension")?;
    if !["png", "webp", "jpg", "jpeg", "gif"].contains(&extension.to_ascii_lowercase().as_str()) {
        return Err("Unsupported pet image extension".into());
    }
    let format = image::guess_format(&image_bytes).map_err(|e| e.to_string())?;
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Gif => "image/gif",
        _ => return Err("Unsupported pet image format".into()),
    };
    let reader = image::ImageReader::with_format(Cursor::new(&image_bytes), format);
    let (width, height) = reader.into_dimensions().map_err(|e| e.to_string())?;
    let rows = if version == 2 { 11 } else { 9 };
    if width == 0
        || height == 0
        || width % 8 != 0
        || height % rows != 0
        || u64::from(width) * u64::from(height) > 16_000_000
    {
        return Err("Pet image dimensions do not match its sprite version".into());
    }
    // Decode before accepting a package, including callers that do not request a preview.
    let decoded =
        image::load_from_memory_with_format(&image_bytes, format).map_err(|e| e.to_string())?;
    let preview = if preview {
        let thumb = decoded
            .crop_imm(0, 0, width / 8, height / rows)
            .thumbnail(96, 104);
        let mut png = Cursor::new(Vec::new());
        thumb
            .write_to(&mut png, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png.into_inner())
        )
    } else {
        String::new()
    };
    let mut digest = Sha256::new();
    digest.update((manifest_bytes.len() as u64).to_le_bytes());
    digest.update(&manifest_bytes);
    digest.update(&image_bytes);
    Ok(Loaded {
        manifest: value,
        image: image_bytes,
        name: resource.file_name().unwrap().to_string_lossy().into_owned(),
        mime: mime.into(),
        fingerprint: format!("{:x}", digest.finalize()),
        preview,
    })
}
fn metadata(dir: &Path, loaded: &Loaded, source: &str) -> PetPackage {
    let raw = loaded
        .manifest
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("custom-pet");
    let id: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed_id = id.trim_matches('-');
    PetPackage {
        id: if trimmed_id.is_empty() {
            "custom-pet".into()
        } else {
            trimmed_id.into()
        },
        display_name: loaded
            .manifest
            .get("displayName")
            .and_then(|v| v.as_str())
            .filter(|v| !v.trim().is_empty())
            .unwrap_or(raw)
            .trim()
            .to_string(),
        description: loaded
            .manifest
            .get("description")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        source: source.into(),
        package_path: dir.to_string_lossy().into_owned(),
        spritesheet_path: dir
            .join(
                loaded.manifest["spritesheetPath"]
                    .as_str()
                    .unwrap_or(&loaded.name),
            )
            .to_string_lossy()
            .into_owned(),
        spritesheet_mime_type: loaded.mime.clone(),
        sprite_version_number: loaded
            .manifest
            .get("spriteVersionNumber")
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32,
    }
}
fn directories(root: &Path) -> Result<Vec<PathBuf>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| e.to_string())?;
    for (index, entry) in entries.enumerate() {
        if index >= 4096 {
            return Err("Pet directory entry limit reached".into());
        }
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            paths.push(entry.path());
        }
    }
    if paths.len() > MAX_PACKAGES {
        return Err("Pet package limit reached".into());
    }
    paths.sort();
    Ok(paths)
}

/// Validate a reviewed source again, then publish an independent copy under a root lock.
/// Older callers may omit the fingerprint; ecosystem callers must supply the catalog value.
pub fn import(root: &Path, source: &Path, expected: Option<&str>) -> Result<PetPackage> {
    publish(root, load(source, false)?, source_key(source)?, expected)
}

/// Import a resource supplied by a static source adapter, with the same receipt and review rules.
pub fn import_bytes(
    root: &Path,
    identity: &str,
    manifest: &[u8],
    image: Vec<u8>,
    expected: &str,
) -> Result<PetPackage> {
    publish(
        root,
        decode(manifest, image, false)?,
        hash(identity.as_bytes()),
        Some(expected),
    )
}

fn publish(
    root: &Path,
    mut loaded: Loaded,
    key: String,
    expected: Option<&str>,
) -> Result<PetPackage> {
    if expected.is_some_and(|value| value != loaded.fingerprint) {
        return Err("Pet source changed; refresh and review again".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let root = dunce::canonicalize(root).map_err(|e| e.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".import.lock"))
        .map_err(|e| e.to_string())?;
    FileExt::lock_exclusive(&lock).map_err(|e| e.to_string())?;
    let installed = directories(&root)?;
    for dir in &installed {
        if dir.join(RECEIPT).exists() {
            let bytes = read_file(&dir.join(RECEIPT), MANIFEST_LIMIT)?;
            let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if receipt.schema_version != 1 {
                return Err("Unsupported pet import receipt".into());
            }
            if receipt.source_key == key {
                // Never replace an edited copy or create duplicates for the same source.
                return load(dir, false).map(|current| metadata(dir, &current, "user"));
            }
        }
    }
    if installed.len() >= MAX_PACKAGES {
        return Err("Pet package limit reached".into());
    }
    let fingerprint = loaded.fingerprint.clone();
    loaded.manifest["spritesheetPath"] = serde_json::Value::String(loaded.name.clone());
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4().simple()));
    let destination = root.join(format!("pet-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let publish = (|| {
        fs::write(
            staging.join("pet.json"),
            serde_json::to_vec_pretty(&loaded.manifest).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::write(staging.join(&loaded.name), &loaded.image).map_err(|e| e.to_string())?;
        let installed = load(&staging, false)?;
        let receipt = Receipt {
            schema_version: 1,
            source_key: key,
            fingerprint,
            installed_fingerprint: installed.fingerprint.clone(),
        };
        fs::write(
            staging.join(RECEIPT),
            serde_json::to_vec(&receipt).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(&staging, &destination).map_err(|e| e.to_string())?;
        Ok(metadata(&destination, &installed, "user"))
    })();
    if publish.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    publish
}

pub fn catalog(source_root: &Path, installed_root: &Path) -> PetCatalog {
    let mut report = PetCatalog::default();
    let installed = match directories(installed_root) {
        Ok(v) => v,
        Err(e) => {
            report
                .diagnostics
                .push(format!("Could not inspect installed pets: {e}"));
            return report;
        }
    };
    let sources = match directories(source_root) {
        Ok(v) => v,
        Err(e) => {
            report
                .diagnostics
                .push(format!("Could not inspect pet sources: {e}"));
            return report;
        }
    };
    for dir in sources {
        let result: Result<PetCandidate> = (|| {
            let loaded = load(&dir, true)?;
            let key = source_key(&dir)?;
            candidate(&installed, &dir, key, loaded)
        })();
        match result {
            Ok(candidate) => report.candidates.push(candidate),
            Err(e) => report.diagnostics.push(format!("{}: {e}", dir.display())),
        }
    }
    report
}

/// Build a preview and reconcile an adapter-provided resource without writing a package.
pub fn candidate_from_bytes(
    installed_root: &Path,
    identity: &str,
    origin: &Path,
    manifest: &[u8],
    image: Vec<u8>,
) -> Result<PetCandidate> {
    candidate(
        &directories(installed_root)?,
        origin,
        hash(identity.as_bytes()),
        decode(manifest, image, true)?,
    )
}

fn candidate(
    installed: &[PathBuf],
    dir: &Path,
    key: String,
    loaded: Loaded,
) -> Result<PetCandidate> {
    let mut candidate = PetCandidate {
        source_key: key.clone(),
        fingerprint: loaded.fingerprint.clone(),
        pet: metadata(&dir, &loaded, "codex"),
        preview_data_url: loaded.preview.clone(),
        imported: None,
        copy_modified: false,
        source_changed: false,
        builtin_id: None,
    };
    for native in installed {
        if !native.join(RECEIPT).exists() {
            continue;
        }
        let receipt: Receipt =
            serde_json::from_slice(&read_file(&native.join(RECEIPT), MANIFEST_LIMIT)?)
                .map_err(|e| e.to_string())?;
        if receipt.schema_version != 1 {
            return Err("Unsupported pet import receipt".into());
        }
        if receipt.source_key == key {
            let current = load(native, false)?;
            candidate.copy_modified = current.fingerprint != receipt.installed_fingerprint;
            candidate.source_changed = loaded.fingerprint != receipt.fingerprint;
            candidate.imported = Some(metadata(native, &current, "user"));
            break;
        }
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(root: &Path, name: &str, version: Option<u32>) -> PathBuf {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        let mut value =
            serde_json::json!({"id":name,"displayName":name,"spritesheetPath":"sprite.png"});
        if let Some(version) = version {
            value["spriteVersionNumber"] = version.into();
        }
        fs::write(dir.join("pet.json"), serde_json::to_vec(&value).unwrap()).unwrap();
        let rows = if version == Some(2) { 11 } else { 9 };
        image::RgbaImage::new(16, rows * 2)
            .save(dir.join("sprite.png"))
            .unwrap();
        dir
    }

    #[test]
    fn bundled_identity_survives_app_updates_and_reconciles_native_deletion() {
        let temp = tempfile::tempdir().unwrap();
        let fixture = fixture(temp.path(), "owl", Some(2));
        let manifest = fs::read(fixture.join("pet.json")).unwrap();
        let image = fs::read(fixture.join("sprite.png")).unwrap();
        let native = temp.path().join("native");
        let identity = "codex:builtin:owl";
        let reviewed = candidate_from_bytes(
            &native,
            identity,
            Path::new("old/app.asar"),
            &manifest,
            image.clone(),
        )
        .unwrap();
        assert!(!native.exists());
        let pet = import_bytes(
            &native,
            identity,
            &manifest,
            image.clone(),
            &reviewed.fingerprint,
        )
        .unwrap();
        let moved = candidate_from_bytes(
            &native,
            identity,
            Path::new("new/app.asar"),
            &manifest,
            image.clone(),
        )
        .unwrap();
        assert_eq!(moved.source_key, reviewed.source_key);
        assert_eq!(moved.imported.unwrap().package_path, pet.package_path);
        assert_eq!(
            import_bytes(
                &native,
                identity,
                &manifest,
                image.clone(),
                &reviewed.fingerprint
            )
            .unwrap()
            .package_path,
            pet.package_path
        );
        let mut changed: serde_json::Value = serde_json::from_slice(&manifest).unwrap();
        changed["displayName"] = "Updated owl".into();
        let changed = serde_json::to_vec(&changed).unwrap();
        assert!(import_bytes(
            &native,
            identity,
            &changed,
            image.clone(),
            &reviewed.fingerprint
        )
        .is_err());
        let changed_source = candidate_from_bytes(
            &native,
            identity,
            Path::new("new/app.asar"),
            &changed,
            image.clone(),
        )
        .unwrap();
        assert!(changed_source.source_changed);
        fs::remove_dir_all(&pet.package_path).unwrap();
        assert!(candidate_from_bytes(
            &native,
            identity,
            Path::new("new/app.asar"),
            &manifest,
            image
        )
        .unwrap()
        .imported
        .is_none());
    }
    #[test]
    fn imports_both_versions_and_legacy_payload_and_rejects_stale_review() {
        let temp = tempfile::tempdir().unwrap();
        for version in [None, Some(1), Some(2)] {
            let src = fixture(
                &temp.path().join("source"),
                &format!("pet{version:?}"),
                version,
            );
            let reviewed = load(&src, true).unwrap();
            assert!(reviewed.preview.starts_with("data:image/png;base64,"));
            assert!(import(&temp.path().join("native"), &src, Some("stale")).is_err());
            let pet = import(
                &temp.path().join("native"),
                &src,
                Some(&reviewed.fingerprint),
            )
            .unwrap();
            assert_eq!(pet.sprite_version_number, version.unwrap_or(1));
            let mut old = serde_json::to_value(&pet).unwrap();
            old.as_object_mut().unwrap().remove("spriteVersionNumber");
            let restored: PetPackage = serde_json::from_value(old).unwrap();
            assert_eq!(restored.sprite_version_number, 1);
            let round_trip: PetPackage =
                serde_json::from_value(serde_json::to_value(restored).unwrap()).unwrap();
            assert_eq!(round_trip.package_path, pet.package_path);
        }
    }
    #[test]
    fn concurrent_imports_publish_one_copy_and_keep_unknown_receipts() {
        let temp = tempfile::tempdir().unwrap();
        let source = fixture(&temp.path().join("sources"), "cat", Some(2));
        let native = temp.path().join("native");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = (0..2)
            .map(|_| {
                let (source, native, barrier) = (source.clone(), native.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    import(&native, &source, None).unwrap()
                })
            })
            .collect();
        let pets: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(pets[0].package_path, pets[1].package_path);
        assert_eq!(directories(&native).unwrap().len(), 1);
        let receipt = Path::new(&pets[0].package_path).join(RECEIPT);
        fs::write(&receipt, b"unknown receipt").unwrap();
        assert!(import(&native, &source, None).is_err());
        assert_eq!(fs::read(&receipt).unwrap(), b"unknown receipt");
        assert_eq!(directories(&native).unwrap().len(), 1);
        assert!(!catalog(&temp.path().join("sources"), &native)
            .diagnostics
            .is_empty());
    }

    #[test]
    fn repeated_import_is_idempotent_and_delete_restores_candidate() {
        let temp = tempfile::tempdir().unwrap();
        let sources = temp.path().join("sources");
        let native = temp.path().join("native");
        let src = fixture(&sources, "cat", Some(2));
        let first = import(&native, &src, None).unwrap();
        let second = import(&native, &src, None).unwrap();
        assert_eq!(first.package_path, second.package_path);
        assert!(catalog(&sources, &native).candidates[0].imported.is_some());
        fs::remove_dir_all(&first.package_path).unwrap();
        assert!(catalog(&sources, &native).candidates[0].imported.is_none());
        let next = import(&native, &src, None).unwrap();
        assert_ne!(first.package_path, next.package_path);
    }
    #[test]
    fn keeps_edited_copies_and_reports_source_changes() {
        let temp = tempfile::tempdir().unwrap();
        let sources = temp.path().join("sources");
        let native = temp.path().join("native");
        let src = fixture(&sources, "cat", None);
        let pet = import(&native, &src, None).unwrap();
        for dir in [&src, &PathBuf::from(&pet.package_path)] {
            let manifest_path = dir.join("pet.json");
            let mut value: serde_json::Value =
                serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
            value["displayName"] = "edited".into();
            fs::write(manifest_path, serde_json::to_vec(&value).unwrap()).unwrap();
        }
        let report = catalog(&sources, &native);
        assert!(report.candidates[0].copy_modified);
        assert!(report.candidates[0].source_changed);
        assert_eq!(
            import(&native, &src, None).unwrap().package_path,
            pet.package_path
        );
    }
    #[test]
    fn rejects_escaping_paths_bad_images_and_unknown_versions() {
        let temp = tempfile::tempdir().unwrap();
        let src = fixture(temp.path(), "pet", None);
        for path in [
            "../sprite.png",
            "/sprite.png",
            "C:/sprite.png",
            "folder\\sprite.png",
            ".openbitfun-import.json",
        ] {
            fs::write(
                src.join("pet.json"),
                serde_json::to_vec(&serde_json::json!({"spritesheetPath":path})).unwrap(),
            )
            .unwrap();
            assert!(load(&src, false).is_err(), "{path}");
        }
        fixture(temp.path(), "pet", Some(3));
        assert!(load(&src, false).is_err());
        fixture(temp.path(), "pet", None);
        image::RgbaImage::new(17, 18)
            .save(src.join("sprite.png"))
            .unwrap();
        assert!(load(&src, false).is_err());
        fs::write(src.join("sprite.png"), b"not an image").unwrap();
        assert!(load(&src, false).is_err());
    }
    #[test]
    fn rejects_oversize_manifests_and_reports_invalid_sources() {
        let temp = tempfile::tempdir().unwrap();
        let src = fixture(temp.path(), "pet", None);
        fs::write(
            src.join("pet.json"),
            vec![b' '; MANIFEST_LIMIT as usize + 1],
        )
        .unwrap();
        assert!(load(&src, false).is_err());
        let report = catalog(temp.path(), &temp.path().join("missing"));
        assert!(report.candidates.is_empty());
        assert!(!report.diagnostics.is_empty());
    }
    #[test]
    fn accepts_nested_zip_packages_and_normalizes_resource_location() {
        use std::io::Write;
        let temp = tempfile::tempdir().unwrap();
        let src = fixture(temp.path(), "source", Some(2));
        let archive = temp.path().join("pet.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("package/pet.json", options).unwrap();
        zip.write_all(
            br#"{"id":"zip","spritesheetPath":"assets/sprite.png","spriteVersionNumber":2}"#,
        )
        .unwrap();
        zip.start_file("package/assets/sprite.png", options)
            .unwrap();
        zip.write_all(&fs::read(src.join("sprite.png")).unwrap())
            .unwrap();
        zip.finish().unwrap();
        let pet = import(&temp.path().join("native"), &archive, None).unwrap();
        assert!(Path::new(&pet.spritesheet_path).is_file());
        assert_eq!(pet.sprite_version_number, 2);
    }
}
