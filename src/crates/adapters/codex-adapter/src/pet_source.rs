//! Static discovery of bundled pets. Bundle JavaScript is inspected as data, never evaluated.
use openbitfun_services_core::asar::AsarArchive;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub struct BuiltinPetSource {
    pub id: String,
    pub archive_path: PathBuf,
    pub resource_path: String,
    pub manifest: Vec<u8>,
    pub image: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct BuiltinPetCatalog {
    pub pets: Vec<BuiltinPetSource>,
    pub diagnostics: Vec<String>,
}

/// Resolve the current installation each time, so an app update cannot pin stale resources.
pub fn builtin_pet_sources(only_id: Option<&str>) -> BuiltinPetCatalog {
    let mut result = BuiltinPetCatalog::default();
    let paths = installation_archives(&mut result.diagnostics);
    let Some(path) = paths.into_iter().find(|path| path.is_file()) else {
        result
            .diagnostics
            .push("Codex built-in pets: no readable application bundle was found".into());
        return result;
    };
    match read_bundle(&path, only_id) {
        Ok(pets) => result.pets = pets,
        Err(error) => result
            .diagnostics
            .push(format!("Codex built-in pets ({}): {error}", path.display())),
    }
    result
}

fn installation_archives(diagnostics: &mut Vec<String>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(target_os = "windows")]
    {
        match openbitfun_services_core::installed_apps::windows_package_roots("OpenAI.Codex") {
            Ok(packages) => paths.extend(sort_windows_packages(packages)),
            Err(error) => diagnostics.push(format!(
                "Could not inspect Codex app registrations: {error}"
            )),
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            for suffix in [
                "Programs/Codex/resources/app.asar",
                "Programs/ChatGPT/resources/app.asar",
                "OpenAI/Codex/resources/app.asar",
                "Codex/resources/app.asar",
            ] {
                paths.push(local.join(suffix));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for root in [
            Some(PathBuf::from("/Applications")),
            dirs::home_dir().map(|v| v.join("Applications")),
        ]
        .into_iter()
        .flatten()
        {
            for app in ["Codex.app", "ChatGPT.app"] {
                paths.push(root.join(app).join("Contents/Resources/app.asar"));
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        for root in ["/opt/Codex", "/opt/codex", "/opt/ChatGPT", "/usr/lib/codex"] {
            paths.push(PathBuf::from(root).join("resources/app.asar"));
        }
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".local/share/codex/resources/app.asar"));
        }
    }
    let _ = diagnostics;
    paths
}

#[cfg(any(target_os = "windows", test))]
fn sort_windows_packages(entries: Vec<(String, PathBuf)>) -> Vec<PathBuf> {
    let mut packages = Vec::new();
    for (name, root) in entries {
        let Some(suffix) = name.strip_prefix("OpenAI.Codex_") else {
            continue;
        };
        let Some(version) = suffix.split('_').next().and_then(|v| {
            v.split('.')
                .map(str::parse::<u32>)
                .collect::<Result<Vec<_>, _>>()
                .ok()
        }) else {
            continue;
        };
        if version.len() != 4 {
            continue;
        }
        packages.push((version, root.join("app/resources/app.asar")));
    }
    packages.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    packages.into_iter().map(|(_, path)| path).collect()
}

fn literal_field<'a>(object: &'a str, key: &str) -> Option<&'a str> {
    let (_, rest) = object.split_once(&format!("{key}:"))?;
    let rest = rest.trim_start();
    let quote = rest.chars().next()?;
    if !['`', '\'', '"'].contains(&quote) {
        return None;
    }
    let value = rest[1..].split(quote).next()?;
    if value.contains('\\') || value.contains("${") {
        return None;
    }
    Some(value)
}

fn definitions(script: &str) -> Result<BTreeMap<String, (String, Value)>, String> {
    let mut pets = BTreeMap::new();
    for object in script.split('{').filter_map(|s| s.split('}').next()) {
        if !object.contains("assetRef:") || !object.contains("spriteVersionNumber:") {
            continue;
        }
        let (Some(asset), Some(id), Some(name)) = (
            literal_field(object, "assetRef"),
            literal_field(object, "id"),
            literal_field(object, "displayName"),
        ) else {
            continue;
        };
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            continue;
        }
        let version = object
            .split_once("spriteVersionNumber:")
            .and_then(|(_, s)| s.trim_start().split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or("Unknown bundled pet sprite version")?;
        if version != 1 && version != 2 {
            return Err("Unsupported bundled pet sprite version".into());
        }
        let manifest = json!({"id":id,"displayName":name,"description":literal_field(object,"description"),"spriteVersionNumber":version,"spritesheetPath":"spritesheet.webp"});
        if let Some(previous) = pets.insert(id.into(), (asset.into(), manifest.clone())) {
            if previous != (asset.into(), manifest) {
                return Err("Conflicting bundled pet definitions".into());
            }
        }
    }
    Ok(pets)
}

fn read_bundle(path: &Path, only_id: Option<&str>) -> Result<Vec<BuiltinPetSource>, String> {
    let mut archive = AsarArchive::open(path)?;
    let names = archive.file_names("webview/assets")?;
    let maps: Vec<_> = names
        .iter()
        .filter(|n| n.starts_with("codex-pet-assets-") && n.ends_with(".js"))
        .collect();
    if maps.len() != 1 {
        return Err("Unsupported built-in pet asset map".into());
    }
    let map = String::from_utf8(archive.read(&format!("webview/assets/{}", maps[0]), 1024 * 1024)?)
        .map_err(|e| e.to_string())?;
    let scripts: Vec<_> = names
        .iter()
        .filter(|n| n.starts_with("app-initial-") && n.ends_with(".js"))
        .collect();
    if scripts.len() != 1 {
        return Err("Unsupported built-in pet metadata bundle".into());
    }
    let script = String::from_utf8(
        archive.read(&format!("webview/assets/{}", scripts[0]), 32 * 1024 * 1024)?,
    )
    .map_err(|e| e.to_string())?;
    let definitions = definitions(&script)?;
    if definitions.is_empty() || definitions.len() > 128 {
        return Err("Built-in pet definitions are missing or exceed the limit".into());
    }
    let mut pets = Vec::new();
    let mut total_bytes = 0;
    for (id, (asset, manifest)) in definitions {
        if only_id.is_some_and(|requested| requested != id) {
            continue;
        }
        let matches: Vec<_> = names
            .iter()
            .filter(|n| {
                n.starts_with(&format!("{asset}-spritesheet-"))
                    && n.ends_with(".webp")
                    && ['`', '\'', '"']
                        .iter()
                        .any(|q| map.contains(&format!("{q}{n}{q}")))
            })
            .collect();
        if matches.len() != 1 {
            return Err(format!("Missing or ambiguous built-in pet image: {id}"));
        }
        let resource_path = format!("webview/assets/{}", matches[0]);
        let image = archive.read(&resource_path, 32 * 1024 * 1024)?;
        total_bytes += image.len();
        if total_bytes > 64 * 1024 * 1024 {
            return Err("Bundled pet resource total exceeds its limit".into());
        }
        pets.push(BuiltinPetSource {
            id,
            archive_path: path.into(),
            image,
            resource_path,
            manifest: serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
        });
    }
    if only_id.is_some() && pets.is_empty() {
        return Err("Requested built-in pet is no longer available".into());
    }
    Ok(pets)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn static_definitions_preserve_names_and_versions_without_evaluation() {
        let script = "[{assetRef:`owl`,description:`Calm owl`,displayName:`Owl`,id:`owl`,spriteVersionNumber:2},{assetRef:run(),displayName:`Dynamic`,id:`dynamic`,spriteVersionNumber:2}]";
        let pets = definitions(script).unwrap();
        assert_eq!(pets.len(), 1);
        assert_eq!(pets["owl"].1["displayName"], "Owl");
        assert_eq!(pets["owl"].1["spriteVersionNumber"], 2);
        assert!(
            definitions(&script.replace("spriteVersionNumber:2", "spriteVersionNumber:3")).is_err()
        );
    }
    #[test]
    fn windows_installations_sort_numeric_versions_and_ignore_other_apps() {
        let entries = [
            "OpenAI.Codex_26.9.1.0_x64__publisher",
            "OpenAI.Codex_26.10.1.0_x64__publisher",
            "Other_99.0.0.0",
            "OpenAI.Codex_invalid",
        ]
        .map(|name| (name.into(), PathBuf::from(name)))
        .to_vec();
        let paths = sort_windows_packages(entries);
        assert_eq!(paths.len(), 2);
        assert!(paths[0].to_string_lossy().contains("26.10.1.0"));
    }

    fn write_bundle(path: &Path, metadata: &str, sprite_name: &str, extra_sprite: bool) {
        let map = format!("new URL(`{sprite_name}`,import.meta.url)");
        let mut entries = vec![
            ("codex-pet-assets-hash.js", map.as_bytes()),
            ("app-initial-hash.js", metadata.as_bytes()),
            (sprite_name, b"fixture-image".as_slice()),
        ];
        if extra_sprite {
            entries.push(("owl-spritesheet-extra.webp", b"other"));
        }
        let mut files = serde_json::Map::new();
        let mut content: Vec<u8> = Vec::new();
        for (name, bytes) in entries {
            files.insert(
                name.into(),
                json!({"size":bytes.len(),"offset":content.len().to_string()}),
            );
            content.extend(bytes);
        }
        let header =
            serde_json::to_vec(&json!({"files":{"webview":{"files":{"assets":{"files":files}}}}}))
                .unwrap();
        let payload = (header.len() + 7) & !3;
        let mut bytes = Vec::new();
        for number in [4, (payload + 4) as u32, payload as u32, header.len() as u32] {
            bytes.extend(number.to_le_bytes());
        }
        bytes.extend(header);
        bytes.resize(payload + 12, 0);
        bytes.extend(content);
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn bundle_discovery_follows_current_asset_map_and_rejects_missing_or_changed_definitions() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("app.asar");
        let metadata = "[{assetRef:`owl`,displayName:`Owl`,id:`owl`,spriteVersionNumber:2}]";
        for name in ["owl-spritesheet-v5-old.webp", "owl-spritesheet-v6-new.webp"] {
            write_bundle(&archive, metadata, name, true);
            let pets = read_bundle(&archive, Some("owl")).unwrap();
            assert_eq!(pets.len(), 1);
            assert!(pets[0].resource_path.ends_with(name));
            assert_eq!(pets[0].image, b"fixture-image");
            assert_eq!(
                serde_json::from_slice::<Value>(&pets[0].manifest).unwrap()["spriteVersionNumber"],
                2
            );
        }
        assert!(read_bundle(&archive, Some("removed")).is_err());
        write_bundle(
            &archive,
            &metadata.replace("spriteVersionNumber:2", "spriteVersionNumber:3"),
            "owl-spritesheet.webp",
            false,
        );
        assert!(read_bundle(&archive, None).is_err());
        write_bundle(&archive, metadata, "other-spritesheet.webp", false);
        assert!(read_bundle(&archive, None).is_err());
    }
    #[test]
    #[ignore = "Read-only smoke test against an installed Codex desktop app"]
    fn installed_builtin_pet_catalog() {
        let catalog = builtin_pet_sources(None);
        assert!(catalog.diagnostics.is_empty(), "{:?}", catalog.diagnostics);
        assert!(!catalog.pets.is_empty());
        for pet in &catalog.pets {
            println!(
                "{}: {} ({} bytes)",
                pet.id,
                pet.resource_path,
                pet.image.len()
            );
        }
    }
}
