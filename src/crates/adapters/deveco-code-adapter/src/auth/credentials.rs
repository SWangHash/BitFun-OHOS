//! Saved-credential metadata from the same storage used by the installed CLI.

use super::{DevEcoAccountOptions, INVALID_RESPONSE, UNAVAILABLE};
use serde::de::{IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fmt;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};

pub(super) struct SavedCredentialMetadata {
    pub credential_present: bool,
    pub read_only: bool,
}

pub(super) async fn read(
    options: &DevEcoAccountOptions,
) -> Result<SavedCredentialMetadata, String> {
    let environment = options.environment.clone();
    let working_directory = options.working_directory.clone();
    tokio::task::spawn_blocking(move || read_inner(&environment, working_directory.as_deref()))
        .await
        .map_err(|_| UNAVAILABLE.to_string())?
}

fn read_inner(
    environment: &HashMap<String, String>,
    working_directory: Option<&Path>,
) -> Result<SavedCredentialMetadata, String> {
    let injected =
        environment_value(environment, "DEVECO_AUTH_CONTENT").filter(|value| !value.is_empty());
    let read_only = injected.is_some();
    if let Some(injected) = injected.and_then(|value| value.into_string().ok()) {
        // DevEco ignores invalid/non-object injected JSON and reads the file.
        // Arrays satisfy its JavaScript object check but have no provider key.
        if let Ok(document) = serde_json::from_str::<CredentialDocument>(&injected) {
            if document.object || document.array {
                return Ok(SavedCredentialMetadata {
                    credential_present: document.credential_present,
                    read_only,
                });
            }
        }
    }

    let file = auth_path(environment, working_directory)?;
    let input = match File::open(file) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SavedCredentialMetadata {
                credential_present: false,
                read_only,
            });
        }
        Err(_) => return Err(UNAVAILABLE.to_string()),
    };
    let document: CredentialDocument =
        serde_json::from_reader(BufReader::new(input)).map_err(|error| {
            if error.is_io() {
                UNAVAILABLE.to_string()
            } else {
                INVALID_RESPONSE.to_string()
            }
        })?;
    if !document.object {
        return Err(INVALID_RESPONSE.to_string());
    }
    Ok(SavedCredentialMetadata {
        credential_present: document.credential_present,
        read_only,
    })
}

fn environment_value(environment: &HashMap<String, String>, key: &str) -> Option<OsString> {
    environment
        .iter()
        .find(|(candidate, _)| {
            if cfg!(windows) {
                candidate.eq_ignore_ascii_case(key)
            } else {
                candidate.as_str() == key
            }
        })
        .map(|(_, value)| OsString::from(value))
        .or_else(|| std::env::var_os(key))
}

fn nonempty_environment(environment: &HashMap<String, String>, key: &str) -> Option<OsString> {
    environment_value(environment, key).filter(|value| !value.is_empty())
}

fn auth_path(
    environment: &HashMap<String, String>,
    working_directory: Option<&Path>,
) -> Result<PathBuf, String> {
    let mode = environment_value(environment, "DEVECO_RUNTIME_MODE")
        .and_then(|value| value.into_string().ok())
        .unwrap_or_default();
    let root = match mode.trim() {
        "" | "default" => {
            let data = nonempty_environment(environment, "XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| {
                    // Node's os.homedir() uses USERPROFILE on Windows and HOME
                    // on Unix. DEVECO_TEST_HOME does not change xdg-basedir.
                    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
                    nonempty_environment(environment, key)
                        .map(PathBuf::from)
                        .or_else(dirs::home_dir)
                        .map(|home| home.join(".local").join("share"))
                })
                .ok_or_else(|| UNAVAILABLE.to_string())?;
            data.join("deveco")
        }
        "deveco-studio" => {
            let root = environment_value(environment, "DEVECO_STORAGE_ROOT")
                .and_then(|value| value.into_string().ok())
                .map(|value| PathBuf::from(value.trim()))
                .filter(|root| root.is_absolute())
                .ok_or_else(|| INVALID_RESPONSE.to_string())?;
            root.join("data")
        }
        _ => return Err(INVALID_RESPONSE.to_string()),
    };
    let file = root.join("auth.json");
    if file.is_absolute() {
        Ok(file)
    } else {
        Ok(working_directory
            .map(Path::to_path_buf)
            .or_else(|| std::env::current_dir().ok())
            .ok_or_else(|| UNAVAILABLE.to_string())?
            .join(file))
    }
}

#[derive(Default)]
struct CredentialDocument {
    object: bool,
    array: bool,
    credential_present: bool,
}

impl<'de> Deserialize<'de> for CredentialDocument {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct DocumentVisitor;
        impl<'de> Visitor<'de> for DocumentVisitor {
            type Value = CredentialDocument;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a saved credential object")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut credential_present = false;
                while let Some(key) = map.next_key::<String>()? {
                    if key == "deveco" {
                        credential_present = map.next_value::<CredentialShape>()?.credential;
                    } else {
                        map.next_value::<IgnoredAny>()?;
                    }
                }
                Ok(CredentialDocument {
                    object: true,
                    credential_present,
                    ..CredentialDocument::default()
                })
            }

            fn visit_seq<S: SeqAccess<'de>>(
                self,
                mut sequence: S,
            ) -> Result<Self::Value, S::Error> {
                while sequence.next_element::<IgnoredAny>()?.is_some() {}
                Ok(CredentialDocument {
                    array: true,
                    ..CredentialDocument::default()
                })
            }
        }
        deserializer.deserialize_any(DocumentVisitor)
    }
}

#[derive(Default)]
struct CredentialShape {
    text: bool,
    nonempty_text: bool,
    number: bool,
    oauth: bool,
    encryption_algorithm: bool,
    encrypted: bool,
    credential: bool,
}

impl<'de> Deserialize<'de> for CredentialShape {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ShapeVisitor;
        impl<'de> Visitor<'de> for ShapeVisitor {
            type Value = CredentialShape;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("saved access credential metadata")
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
                // Keep only shape/literal markers, never an access token or
                // encrypted ciphertext string, including in parse errors.
                Ok(CredentialShape {
                    text: true,
                    nonempty_text: !value.is_empty(),
                    oauth: value == "oauth",
                    encryption_algorithm: value == "aes-256-gcm",
                    ..CredentialShape::default()
                })
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut oauth = false;
                let mut access = false;
                let mut algorithm = false;
                let mut version = false;
                let mut ciphertext = false;
                let mut iv = false;
                let mut auth_tag = false;
                let mut timestamp = false;
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => oauth = map.next_value::<CredentialShape>()?.oauth,
                        "access" => {
                            let shape = map.next_value::<CredentialShape>()?;
                            access = shape.nonempty_text || shape.encrypted;
                        }
                        "algorithm" => {
                            algorithm = map.next_value::<CredentialShape>()?.encryption_algorithm
                        }
                        "version" => version = map.next_value::<CredentialShape>()?.number,
                        "ciphertext" => {
                            ciphertext = map.next_value::<CredentialShape>()?.nonempty_text
                        }
                        "iv" => iv = map.next_value::<CredentialShape>()?.text,
                        "authTag" => auth_tag = map.next_value::<CredentialShape>()?.text,
                        "timeStamp" => timestamp = map.next_value::<CredentialShape>()?.number,
                        _ => {
                            map.next_value::<IgnoredAny>()?;
                        }
                    }
                }
                Ok(CredentialShape {
                    credential: oauth && access,
                    encrypted: algorithm && version && ciphertext && iv && auth_tag && timestamp,
                    ..CredentialShape::default()
                })
            }

            fn visit_seq<S: SeqAccess<'de>>(
                self,
                mut sequence: S,
            ) -> Result<Self::Value, S::Error> {
                while sequence.next_element::<IgnoredAny>()?.is_some() {}
                Ok(CredentialShape::default())
            }

            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(CredentialShape::default())
            }

            fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(CredentialShape::default())
            }

            fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(CredentialShape {
                    number: true,
                    ..CredentialShape::default()
                })
            }

            fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(CredentialShape {
                    number: true,
                    ..CredentialShape::default()
                })
            }

            fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(CredentialShape {
                    number: true,
                    ..CredentialShape::default()
                })
            }
        }
        deserializer.deserialize_any(ShapeVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(root: &Path) -> HashMap<String, String> {
        HashMap::from([
            ("XDG_DATA_HOME".to_string(), root.display().to_string()),
            ("DEVECO_RUNTIME_MODE".to_string(), "default".to_string()),
            ("DEVECO_AUTH_CONTENT".to_string(), String::new()),
        ])
    }

    fn write_auth(root: &Path, contents: &str) {
        std::fs::create_dir_all(root.join("deveco")).unwrap();
        std::fs::write(root.join("deveco/auth.json"), contents).unwrap();
    }

    #[test]
    fn reads_the_shared_file_again_and_never_requires_encryption_keys() {
        let directory = tempfile::tempdir().unwrap();
        let mut environment = environment(directory.path());
        let unused_config = directory.path().join("unused-config");
        std::fs::write(&unused_config, "not a directory").unwrap();
        environment.insert(
            "XDG_CONFIG_HOME".into(),
            unused_config.display().to_string(),
        );
        assert!(!read_inner(&environment, None).unwrap().credential_present);
        write_auth(
            directory.path(),
            r#"{"deveco":{"type":"oauth","access":"fixture-only"}}"#,
        );
        assert!(read_inner(&environment, None).unwrap().credential_present);
        write_auth(
            directory.path(),
            r#"{"deveco":{"type":"oauth","access":{"version":1,"algorithm":"aes-256-gcm","ciphertext":"fixture-only","iv":"fixture-only","authTag":"fixture-only","timeStamp":1}}}"#,
        );
        assert!(read_inner(&environment, None).unwrap().credential_present);
        write_auth(directory.path(), "{}");
        assert!(!read_inner(&environment, None).unwrap().credential_present);
        assert!(!directory.path().join("keys").exists());
        assert!(!directory.path().join("token.enc").exists());
    }

    #[test]
    fn honors_injected_credentials_without_requiring_the_disk_file() {
        let directory = tempfile::tempdir().unwrap();
        let mut environment = environment(directory.path());
        environment.insert(
            "DEVECO_AUTH_CONTENT".into(),
            r#"{"deveco":{"type":"oauth","access":"fixture-only"}}"#.into(),
        );
        let saved = read_inner(&environment, None).unwrap();
        assert!(saved.credential_present && saved.read_only);
        environment.insert("DEVECO_AUTH_CONTENT".into(), "{}".into());
        assert!(!read_inner(&environment, None).unwrap().credential_present);
        write_auth(
            directory.path(),
            r#"{"deveco":{"type":"oauth","access":"fixture-only"}}"#,
        );
        for value in ["invalid", "null", "1", "true", r#""text""#] {
            environment.insert("DEVECO_AUTH_CONTENT".into(), value.into());
            let saved = read_inner(&environment, None).unwrap();
            assert!(saved.credential_present && saved.read_only);
        }
        environment.insert("DEVECO_AUTH_CONTENT".into(), "[]".into());
        assert!(!read_inner(&environment, None).unwrap().credential_present);
    }

    #[test]
    fn resolves_storage_roots_and_relative_xdg_from_the_cli_environment() {
        let directory = tempfile::tempdir().unwrap();
        let mut environment = environment(directory.path());
        environment.insert("XDG_DATA_HOME".into(), "relative-data".into());
        assert_eq!(
            auth_path(&environment, Some(directory.path())).unwrap(),
            directory.path().join("relative-data/deveco/auth.json")
        );
        environment.insert("DEVECO_RUNTIME_MODE".into(), " deveco-studio ".into());
        environment.insert(
            "DEVECO_STORAGE_ROOT".into(),
            directory.path().display().to_string(),
        );
        assert_eq!(
            auth_path(&environment, None).unwrap(),
            directory.path().join("data/auth.json")
        );
        environment.insert("DEVECO_STORAGE_ROOT".into(), "relative-root".into());
        assert_eq!(auth_path(&environment, None).unwrap_err(), INVALID_RESPONSE);

        environment.insert("DEVECO_RUNTIME_MODE".into(), "default".into());
        environment.insert("XDG_DATA_HOME".into(), String::new());
        environment.insert(
            if cfg!(windows) { "USERPROFILE" } else { "HOME" }.into(),
            directory.path().display().to_string(),
        );
        environment.insert("DEVECO_TEST_HOME".into(), "does-not-own-xdg".into());
        assert_eq!(
            auth_path(&environment, None).unwrap(),
            directory.path().join(".local/share/deveco/auth.json")
        );
    }

    #[test]
    fn distinguishes_missing_credentials_from_read_and_format_failures() {
        let directory = tempfile::tempdir().unwrap();
        let environment = environment(directory.path());
        for contents in ["{", "[]"] {
            write_auth(directory.path(), contents);
            assert!(
                matches!(read_inner(&environment, None), Err(error) if error == INVALID_RESPONSE)
            );
        }
        for contents in [
            r#"{"deveco":{"type":"oauth","access":42}}"#,
            r#"{"deveco":{"type":"oauth"}}"#,
            r#"{"deveco":["oauth","fixture-only"]}"#,
        ] {
            write_auth(directory.path(), contents);
            assert!(!read_inner(&environment, None).unwrap().credential_present);
        }
        std::fs::remove_file(directory.path().join("deveco/auth.json")).unwrap();
        std::fs::create_dir(directory.path().join("deveco/auth.json")).unwrap();
        assert!(matches!(read_inner(&environment, None), Err(error) if error == UNAVAILABLE));
    }
}
