//! Bounded, read-only access to packed Electron ASAR resources. Never executes bundle code.
use serde_json::Value;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

type Result<T> = std::result::Result<T, String>;

pub struct AsarArchive {
    file: File,
    header: Value,
    data_start: u64,
    file_size: u64,
}

impl AsarArchive {
    pub fn open(path: &Path) -> Result<Self> {
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("ASAR archive must be a regular file".into());
        }
        let file_size = metadata.len();
        let mut prefix = [0; 16];
        file.read_exact(&mut prefix).map_err(|e| e.to_string())?;
        let number = |i| u32::from_le_bytes(prefix[i..i + 4].try_into().unwrap()) as u64;
        let (header_size, payload_size, json_size) = (number(4), number(8), number(12));
        if number(0) != 4
            || header_size < 8
            || header_size > 16 * 1024 * 1024
            || payload_size + 4 != header_size
            || json_size + 8 > header_size
            || header_size + 8 > file_size
        {
            return Err("Invalid or oversized ASAR header".into());
        }
        let mut bytes = vec![0; json_size as usize];
        file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        let header: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if !header.get("files").is_some_and(Value::is_object) {
            return Err("Missing ASAR file index".into());
        }
        Ok(Self {
            file,
            header,
            data_start: header_size + 8,
            file_size,
        })
    }

    fn entry(&self, path: &str) -> Result<&Value> {
        let mut entry = &self.header;
        for part in path.split('/') {
            if part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':']) {
                return Err("Invalid ASAR resource path".into());
            }
            entry = entry
                .get("files")
                .and_then(|v| v.get(part))
                .ok_or("ASAR resource is missing")?;
            if entry.get("link").is_some()
                || entry.get("unpacked").and_then(Value::as_bool) == Some(true)
            {
                return Err("Linked or unpacked ASAR resources are unsupported".into());
            }
        }
        Ok(entry)
    }

    pub fn file_names(&self, directory: &str) -> Result<Vec<String>> {
        let entries = self
            .entry(directory)?
            .get("files")
            .and_then(Value::as_object)
            .ok_or("ASAR resource is not a directory")?;
        if entries.len() > 20_000 {
            return Err("ASAR directory entry limit reached".into());
        }
        Ok(entries
            .iter()
            .filter(|(_, v)| v.get("files").is_none())
            .map(|(k, _)| k.clone())
            .collect())
    }

    pub fn read(&mut self, path: &str, limit: u64) -> Result<Vec<u8>> {
        let entry = self.entry(path)?;
        let size = entry
            .get("size")
            .and_then(Value::as_u64)
            .ok_or("Invalid ASAR resource size")?;
        let offset = entry
            .get("offset")
            .and_then(Value::as_str)
            .and_then(|v| v.parse::<u64>().ok())
            .ok_or("Invalid ASAR resource offset")?;
        let start = self
            .data_start
            .checked_add(offset)
            .ok_or("ASAR offset overflow")?;
        let end = start.checked_add(size).ok_or("ASAR size overflow")?;
        if size > limit || end > self.file_size {
            return Err("ASAR resource exceeds its bounds".into());
        }
        self.file
            .seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        let mut bytes = vec![0; usize::try_from(size).map_err(|e| e.to_string())?];
        self.file
            .read_exact(&mut bytes)
            .map_err(|e| e.to_string())?;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(path: &Path, entry: Value) {
        let json =
            serde_json::to_vec(&serde_json::json!({"files":{"assets":{"files":{"pet":entry}}}}))
                .unwrap();
        let payload = (json.len() + 4 + 3) & !3;
        let mut bytes = Vec::new();
        for value in [4, (payload + 4) as u32, payload as u32, json.len() as u32] {
            bytes.extend(value.to_le_bytes());
        }
        bytes.extend(json);
        bytes.resize(payload + 12, 0);
        bytes.extend(b"pet-image");
        std::fs::write(path, bytes).unwrap();
    }
    #[test]
    fn reads_only_bounded_packed_entries() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("app.asar");
        fixture(&path, serde_json::json!({"size":9,"offset":"0"}));
        let mut archive = AsarArchive::open(&path).unwrap();
        assert_eq!(archive.file_names("assets").unwrap(), vec!["pet"]);
        assert_eq!(archive.read("assets/pet", 9).unwrap(), b"pet-image");
        assert!(archive.read("assets/pet", 8).is_err());
        assert!(archive.read("assets/../pet", 9).is_err());
        for entry in [
            serde_json::json!({"size":10,"offset":"0"}),
            serde_json::json!({"size":9,"offset":"18446744073709551615"}),
            serde_json::json!({"size":9,"offset":"0","unpacked":true}),
            serde_json::json!({"link":"../../private"}),
        ] {
            fixture(&path, entry);
            assert!(AsarArchive::open(&path)
                .unwrap()
                .read("assets/pet", 32)
                .is_err());
        }
        std::fs::write(&path, [255; 16]).unwrap();
        assert!(AsarArchive::open(&path).is_err());
    }
}
