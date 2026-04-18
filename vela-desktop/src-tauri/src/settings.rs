// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! Settings persistence — app configuration stored in ~/.vela/config.json.

use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fs;

use crate::file::handler::vela_data_dir;

/// App settings schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub agent: AgentSettings,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub window_state: WindowState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    /// Agent type: "auto", "claude-cli", "ollama", "openai-compat", "mcp-channel", "custom".
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
    /// Custom command path (for custom agent type).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Custom port (for HTTP-based agents).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// Model name (for HTTP-based agents).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// API key (stored locally — never committed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowState {
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub maximized: bool,
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_agent_type() -> String {
    "auto".to_string()
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            agent_type: default_agent_type(),
            path: None,
            port: None,
            model: None,
            api_key: None,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            agent: AgentSettings::default(),
            theme: default_theme(),
            recent_files: Vec::new(),
            window_state: WindowState::default(),
        }
    }
}

/// Get the settings file path.
fn settings_path() -> std::path::PathBuf {
    vela_data_dir().join("config.json")
}

/// Load settings from disk, returning defaults if file missing or corrupt.
pub fn load() -> Settings {
    let path = settings_path();

    if !path.exists() {
        info!("No settings file found, using defaults");
        return Settings::default();
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<Settings>(&content) {
            Ok(settings) => {
                info!("Loaded settings from {}", path.display());
                settings
            }
            Err(e) => {
                warn!(
                    "Settings file corrupt ({}), using defaults: {}",
                    path.display(),
                    e
                );
                Settings::default()
            }
        },
        Err(e) => {
            warn!("Failed to read settings: {}", e);
            Settings::default()
        }
    }
}

/// Save settings to disk.
pub fn save(settings: &Settings) -> Result<(), String> {
    let dir = vela_data_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Create dir error: {}", e))?;
    }

    let path = settings_path();
    let json =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Serialize error: {}", e))?;

    fs::write(&path, &json).map_err(|e| format!("Write error: {}", e))?;

    info!("Saved settings to {}", path.display());
    Ok(())
}

/// Update specific fields in settings. Merges with existing settings.
pub fn update(partial: serde_json::Value) -> Result<Settings, String> {
    let mut current = load();

    // Merge partial into current
    if let Some(theme) = partial.get("theme").and_then(|v| v.as_str()) {
        current.theme = theme.to_string();
    }
    if let Some(agent) = partial.get("agent") {
        if let Some(agent_type) = agent.get("agent_type").and_then(|v| v.as_str()) {
            current.agent.agent_type = agent_type.to_string();
        }
        if let Some(path) = agent.get("path").and_then(|v| v.as_str()) {
            current.agent.path = Some(path.to_string());
        }
        if let Some(port) = agent.get("port").and_then(|v| v.as_u64()) {
            current.agent.port = Some(port as u16);
        }
        if let Some(model) = agent.get("model").and_then(|v| v.as_str()) {
            current.agent.model = Some(model.to_string());
        }
    }
    if let Some(ws) = partial.get("window_state") {
        if let Ok(window_state) = serde_json::from_value::<WindowState>(ws.clone()) {
            current.window_state = window_state;
        }
    }

    save(&current)?;
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = Settings::default();
        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.agent.agent_type, "auto");
        assert!(settings.recent_files.is_empty());
    }

    #[test]
    fn test_settings_serialization() {
        let settings = Settings::default();
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.theme, settings.theme);
    }

    #[test]
    fn test_settings_missing_fields_use_defaults() {
        let json = r#"{"theme":"light"}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.theme, "light");
        assert_eq!(settings.agent.agent_type, "auto"); // default
    }
}
