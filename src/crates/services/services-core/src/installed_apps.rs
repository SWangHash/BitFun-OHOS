//! Read-only Windows per-user package registrations; no elevation or directory ownership changes.
use std::path::PathBuf;
use windows::{
    core::{w, PCWSTR, PWSTR},
    Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS},
        System::Registry::{
            RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER,
            KEY_READ, RRF_RT_REG_SZ,
        },
    },
};

struct RegistryKey(HKEY);
impl Drop for RegistryKey {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

pub fn windows_package_roots(package_name: &str) -> Result<Vec<(String, PathBuf)>, String> {
    let mut key = HKEY::default();
    let status = unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER,
        w!("Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages"),
        None, KEY_READ, &mut key)
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(Vec::new());
    }
    status.ok().map_err(|e| e.to_string())?;
    let key = RegistryKey(key);
    let mut paths = Vec::new();
    for index in 0..4096 {
        let mut name = [0u16; 512];
        let mut count = name.len() as u32;
        let status = unsafe {
            RegEnumKeyExW(
                key.0,
                index,
                Some(PWSTR(name.as_mut_ptr())),
                &mut count,
                None,
                None,
                None,
                None,
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            return Ok(paths);
        }
        status.ok().map_err(|e| e.to_string())?;
        let full_name = String::from_utf16(&name[..count as usize]).map_err(|e| e.to_string())?;
        if !full_name.starts_with(&format!("{package_name}_")) {
            continue;
        }
        let mut path = [0u16; 32768];
        let mut bytes = (path.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                key.0,
                PCWSTR(name.as_ptr()),
                w!("PackageRootFolder"),
                RRF_RT_REG_SZ,
                None,
                Some(path.as_mut_ptr().cast()),
                Some(&mut bytes),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!(
                "Cannot read package root for {full_name}: {}",
                status.0
            ));
        }
        let count = (bytes as usize / 2).min(path.len());
        let end = path[..count].iter().position(|v| *v == 0).unwrap_or(count);
        let root = PathBuf::from(String::from_utf16(&path[..end]).map_err(|e| e.to_string())?);
        if !root.is_absolute() {
            return Err("Registered package path is not absolute".into());
        }
        paths.push((full_name, root));
    }
    Err("Installed package enumeration limit reached".into())
}
