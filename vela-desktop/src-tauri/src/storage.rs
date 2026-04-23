// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! Storage backend — key-value storage using ~/.vela/storage/ directory.
//! Provides the same contract as Claude.ai's window.storage API.

use log::{debug, warn};
use std::fs;
use std::path::PathBuf;

use crate::file::handler::vela_data_dir;

/// Get the storage directory path.
fn storage_dir() -> PathBuf {
    vela_data_dir().join("storage")
}

/// Ensure storage directory exists.
fn ensure_storage_dir() -> Result<PathBuf, String> {
    let dir = storage_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create storage dir: {}", e))?;
    }
    Ok(dir)
}

/// Sanitize a storage key to a safe filename.
fn key_to_filename(key: &str) -> String {
    // Replace unsafe chars with underscores, keep alphanumeric and hyphens
    key.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        + ".json"
}

/// Get a value by key.
pub fn get(key: &str) -> Result<Option<String>, String> {
    let dir = storage_dir();
    let file_path = dir.join(key_to_filename(key));

    if !file_path.exists() {
        return Ok(None);
    }

    match fs::read_to_string(&file_path) {
        Ok(content) => {
            debug!("storage.get({}) = {} bytes", key, content.len());
            Ok(Some(content))
        }
        Err(e) => {
            warn!("storage.get({}) failed: {}", key, e);
            Err(format!("Read error: {}", e))
        }
    }
}

/// Set a value by key.
pub fn set(key: &str, value: &str) -> Result<(), String> {
    let dir = ensure_storage_dir()?;
    let file_path = dir.join(key_to_filename(key));

    fs::write(&file_path, value).map_err(|e| format!("Write error: {}", e))?;

    debug!("storage.set({}) = {} bytes", key, value.len());
    Ok(())
}

/// Delete a value by key.
pub fn delete(key: &str) -> Result<(), String> {
    let dir = storage_dir();
    let file_path = dir.join(key_to_filename(key));

    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| format!("Delete error: {}", e))?;
        debug!("storage.delete({})", key);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_to_filename() {
        assert_eq!(key_to_filename("vela-deck"), "vela-deck.json");
        assert_eq!(key_to_filename("vela-m-abc123"), "vela-m-abc123.json");
        assert_eq!(key_to_filename("key with spaces"), "key_with_spaces.json");
        assert_eq!(key_to_filename("path/slash"), "path_slash.json");
    }

    #[test]
    fn test_get_missing_key() {
        let result = get("nonexistent_test_key_xyz_99999");
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_set_and_get() {
        let key = "vela_test_storage_set_get";
        let value = r#"{"test":true}"#;

        set(key, value).unwrap();
        let result = get(key).unwrap();
        assert_eq!(result, Some(value.to_string()));

        // Cleanup
        delete(key).unwrap();
    }

    #[test]
    fn test_delete() {
        let key = "vela_test_storage_delete";
        set(key, "temporary").unwrap();
        delete(key).unwrap();
        assert!(get(key).unwrap().is_none());
    }
}
