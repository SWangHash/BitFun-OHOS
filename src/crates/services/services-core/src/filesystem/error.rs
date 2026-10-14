//! Filesystem error boundary.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSystemError {
    message: String,
}

pub type FileSystemResult<T> = Result<T, FileSystemError>;

impl FileSystemError {
    /// Keep permission failures recognizable across legacy string RPC errors.
    /// Only the OS can grant access; an application/agent approval is unrelated.
    pub fn io(context: impl fmt::Display, error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            Self::service(format!(
                "FILESYSTEM_PERMISSION_DENIED: {context}: {error}. Grant file or folder access on the device hosting this path, then retry. A remote BitFun approval cannot grant operating-system access."
            ))
        } else {
            Self::service(format!("{context}: {error}"))
        }
    }

    pub fn service(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for FileSystemError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for FileSystemError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_error_display_preserves_message() {
        let error = FileSystemError::service("File does not exist: sample.txt");
        assert_eq!(error.to_string(), "File does not exist: sample.txt");
    }

    #[test]
    fn io_errors_distinguish_os_permission_denial_from_missing_paths() {
        use std::io::{Error, ErrorKind};
        let denied = FileSystemError::io(
            "Read directory '/protected'",
            Error::from(ErrorKind::PermissionDenied),
        );
        assert!(denied
            .to_string()
            .starts_with("FILESYSTEM_PERMISSION_DENIED:"));
        assert!(denied.to_string().contains("'/protected'"));
        assert!(denied.to_string().contains("device hosting this path"));
        let missing = FileSystemError::io(
            "Read directory '/missing'",
            Error::from(ErrorKind::NotFound),
        );
        assert!(!missing.to_string().contains("FILESYSTEM_PERMISSION_DENIED"));
    }
}
