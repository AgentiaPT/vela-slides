// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! File handler — open/save .vela files with atomic writes and recent file tracking.

use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum FileError {
    #[error("File not found: {0}")]
    NotFound(String),
    #[error("Invalid JSON: {0}")]
    InvalidJson(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub title: String,
    pub opened_at: String,
}

/// Get the Vela data directory (~/.vela/).
pub fn vela_data_dir() -> PathBuf {
    let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(".vela")
}

/// Ensure the data directory exists.
pub fn ensure_data_dir() -> Result<PathBuf, FileError> {
    let dir = vela_data_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// Read a .vela deck file and validate it's proper JSON.
pub fn open_deck(path: &str) -> Result<serde_json::Value, FileError> {
    let path = Path::new(path);

    if !path.exists() {
        return Err(FileError::NotFound(path.display().to_string()));
    }

    let content = fs::read_to_string(path)?;

    let deck: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| FileError::InvalidJson(format!("{}: {}", path.display(), e)))?;

    info!("Opened deck: {}", path.display());
    Ok(deck)
}

/// Save a deck to a .vela file atomically (write to .tmp then rename).
pub fn save_deck(path: &str, json: &serde_json::Value) -> Result<(), FileError> {
    let path = Path::new(path);
    let tmp_name = format!(".vela-{}.tmp", Uuid::new_v4());
    let tmp_path = path
        .parent()
        .unwrap_or(Path::new("."))
        .join(&tmp_name);

    let content = serde_json::to_string_pretty(json)
        .map_err(|e| FileError::InvalidJson(format!("Serialization error: {}", e)))?;

    // Write to temp file first
    fs::write(&tmp_path, &content)?;

    // Atomic rename
    fs::rename(&tmp_path, path).map_err(|e| {
        // Clean up temp file on failure
        let _ = fs::remove_file(&tmp_path);
        FileError::Io(e)
    })?;

    info!("Saved deck: {}", path.display());
    Ok(())
}

/// Get the path to the recent files list.
fn recent_files_path() -> PathBuf {
    vela_data_dir().join("recent.json")
}

/// Load the list of recently opened files.
pub fn load_recent_files() -> Vec<RecentFile> {
    let path = recent_files_path();
    if !path.exists() {
        return Vec::new();
    }

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(e) => {
            warn!("Failed to read recent files: {}", e);
            Vec::new()
        }
    }
}

/// Add a file to the recent files list.
pub fn add_recent_file(file_path: &str, title: &str) {
    let mut recents = load_recent_files();

    // Remove existing entry for same path
    recents.retain(|r| r.path != file_path);

    // Add to front
    recents.insert(
        0,
        RecentFile {
            path: file_path.to_string(),
            title: title.to_string(),
            opened_at: chrono_now(),
        },
    );

    // Keep only last 20
    recents.truncate(20);

    // Save
    if let Ok(dir) = ensure_data_dir() {
        let path = dir.join("recent.json");
        if let Ok(json) = serde_json::to_string_pretty(&recents) {
            let _ = fs::write(path, json);
        }
    }
}

/// Simple ISO 8601 timestamp without external chrono dependency.
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Good enough ISO 8601 approximation
    format!("{}", secs)
}

/// Extract the deck title from a deck JSON value.
pub fn extract_deck_title(deck: &serde_json::Value) -> String {
    deck.get("deckTitle")
        .or_else(|| deck.get("t"))
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_open_deck_valid() {
        let dir = std::env::temp_dir().join("vela_test_open");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("test.vela");
        fs::write(
            &path,
            r#"{"deckTitle":"Test","lanes":[]}"#,
        )
        .unwrap();

        let deck = open_deck(path.to_str().unwrap()).unwrap();
        assert_eq!(deck["deckTitle"], "Test");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_open_deck_not_found() {
        let result = open_deck("/tmp/nonexistent_vela_test.vela");
        assert!(result.is_err());
    }

    #[test]
    fn test_open_deck_invalid_json() {
        let dir = std::env::temp_dir().join("vela_test_invalid");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("bad.vela");
        fs::write(&path, "not json at all").unwrap();

        let result = open_deck(path.to_str().unwrap());
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_save_deck_roundtrip() {
        let dir = std::env::temp_dir().join("vela_test_save");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("roundtrip.vela");

        let deck = serde_json::json!({"deckTitle":"Roundtrip","lanes":[{"title":"S1","items":[]}]});
        save_deck(path.to_str().unwrap(), &deck).unwrap();

        let loaded = open_deck(path.to_str().unwrap()).unwrap();
        assert_eq!(loaded["deckTitle"], "Roundtrip");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_extract_deck_title() {
        let deck = serde_json::json!({"deckTitle":"My Deck"});
        assert_eq!(extract_deck_title(&deck), "My Deck");
    }

    #[test]
    fn test_extract_deck_title_compact() {
        let deck = serde_json::json!({"t":"Compact Title"});
        assert_eq!(extract_deck_title(&deck), "Compact Title");
    }

    #[test]
    fn test_extract_deck_title_missing() {
        let deck = serde_json::json!({});
        assert_eq!(extract_deck_title(&deck), "Untitled");
    }
}
