// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! Tauri command handlers — IPC bridge between frontend and Rust backend.

use crate::agent::{self, AgentAdapter, AgentInfo, CompletionOpts, CompletionResponse, Message};
use crate::file::handler;
use crate::settings::{self, Settings};
use crate::storage;
use log::debug;

// ── Helpers ────────────────────────────────────────────────────────

fn ok_response(reply: String) -> CompletionResponse {
    CompletionResponse {
        ok: true,
        reply: Some(reply),
        error: None,
    }
}

fn err_response(error: String) -> CompletionResponse {
    CompletionResponse {
        ok: false,
        reply: None,
        error: Some(error),
    }
}

async fn run_complete(
    adapter: &dyn AgentAdapter,
    system: &str,
    messages: Vec<Message>,
    opts: CompletionOpts,
) -> CompletionResponse {
    match adapter.complete(system, messages, opts).await {
        Ok(reply) => ok_response(reply),
        Err(e) => err_response(e.to_string()),
    }
}

async fn run_health(adapter: &dyn AgentAdapter) -> CompletionResponse {
    match adapter.health_check().await {
        Ok(msg) => ok_response(msg),
        Err(e) => err_response(e.to_string()),
    }
}

// ── Storage commands ───────────────────────────────────────────────

#[tauri::command]
pub fn storage_get(key: String) -> Result<Option<String>, String> {
    storage::get(&key)
}

#[tauri::command]
pub fn storage_set(key: String, value: String) -> Result<(), String> {
    storage::set(&key, &value)
}

#[tauri::command]
pub fn storage_delete(key: String) -> Result<(), String> {
    storage::delete(&key)
}

// ── File commands ──────────────────────────────────────────────────

#[tauri::command]
pub fn open_deck(path: String) -> Result<serde_json::Value, String> {
    handler::open_deck(&path).map_err(|e| e.to_string()).map(|deck| {
        let title = handler::extract_deck_title(&deck);
        handler::add_recent_file(&path, &title);
        deck
    })
}

#[tauri::command]
pub fn save_deck(path: String, deck: serde_json::Value) -> Result<(), String> {
    handler::save_deck(&path, &deck).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recent_files() -> Vec<handler::RecentFile> {
    handler::load_recent_files()
}

#[tauri::command]
pub async fn open_file_dialog() -> Result<Option<String>, String> {
    // Tauri v2 dialog API via tauri-plugin-dialog — placeholder for now.
    Ok(None)
}

#[tauri::command]
pub async fn save_file_dialog() -> Result<Option<String>, String> {
    // Tauri v2 dialog API via tauri-plugin-dialog — placeholder for now.
    Ok(None)
}

// ── Settings commands ──────────────────────────────────────────────

#[tauri::command]
pub fn get_settings() -> Settings {
    settings::load()
}

#[tauri::command]
pub fn update_settings(partial: serde_json::Value) -> Result<Settings, String> {
    settings::update(partial)
}

// ── Agent commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn get_agents() -> Vec<AgentInfo> {
    agent::discovery::discover().await
}

#[tauri::command]
pub fn set_active_agent(agent_type: String) -> Result<(), String> {
    debug!("Setting active agent: {}", agent_type);
    let partial = serde_json::json!({ "agent": { "agent_type": agent_type } });
    settings::update(partial)?;
    Ok(())
}

/// Handle a completion request — proxy to active agent adapter.
#[tauri::command]
pub async fn agent_complete(
    system: String,
    messages: Vec<Message>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
) -> CompletionResponse {
    let settings = settings::load();
    let opts = CompletionOpts {
        temperature: temperature.unwrap_or(0.0),
        max_tokens: max_tokens.unwrap_or(16384),
        ..Default::default()
    };

    match settings.agent.agent_type.as_str() {
        "claude-cli" => {
            let config = agent::cli_adapter::CliAdapterConfig::claude();
            let adapter = agent::cli_adapter::CliAdapter::new(config);
            run_complete(&adapter, &system, messages, opts).await
        }
        "ollama" => {
            let model = settings.agent.model.unwrap_or_else(|| "llama3".to_string());
            let config = agent::http_adapter::HttpAdapterConfig::ollama(&model);
            let adapter = agent::http_adapter::HttpAdapter::new(config);
            run_complete(&adapter, &system, messages, opts).await
        }
        "mcp-channel" => {
            let port = settings.agent.port.unwrap_or(8787);
            let config = agent::mcp_adapter::McpAdapterConfig { port };
            let adapter = agent::mcp_adapter::McpAdapter::new(config);
            run_complete(&adapter, &system, messages, opts).await
        }
        _ => {
            // "auto" — try first discovered agent
            let agents = agent::discovery::discover().await;
            if agents.is_empty() {
                return err_response("No AI agents available. Install Claude Code, Ollama, or another supported agent.".to_string());
            }
            let first = &agents[0];
            match &first.agent_type {
                agent::AgentType::ClaudeCli => {
                    let config = agent::cli_adapter::CliAdapterConfig::claude();
                    let adapter = agent::cli_adapter::CliAdapter::new(config);
                    run_complete(&adapter, &system, messages, opts).await
                }
                agent::AgentType::Ollama => {
                    let config = agent::http_adapter::HttpAdapterConfig::ollama("llama3");
                    let adapter = agent::http_adapter::HttpAdapter::new(config);
                    run_complete(&adapter, &system, messages, opts).await
                }
                agent::AgentType::McpChannel => {
                    let config = agent::mcp_adapter::McpAdapterConfig::default();
                    let adapter = agent::mcp_adapter::McpAdapter::new(config);
                    run_complete(&adapter, &system, messages, opts).await
                }
                _ => err_response(format!("Agent type {:?} not yet supported", first.agent_type)),
            }
        }
    }
}

/// Check health of the configured agent.
#[tauri::command]
pub async fn agent_health() -> CompletionResponse {
    let settings = settings::load();

    match settings.agent.agent_type.as_str() {
        "claude-cli" => {
            let config = agent::cli_adapter::CliAdapterConfig::claude();
            let adapter = agent::cli_adapter::CliAdapter::new(config);
            run_health(&adapter).await
        }
        "ollama" => {
            let model = settings.agent.model.unwrap_or_else(|| "llama3".to_string());
            let config = agent::http_adapter::HttpAdapterConfig::ollama(&model);
            let adapter = agent::http_adapter::HttpAdapter::new(config);
            run_health(&adapter).await
        }
        _ => {
            let agents = agent::discovery::discover().await;
            CompletionResponse {
                ok: !agents.is_empty(),
                reply: Some(format!("{} agents available", agents.len())),
                error: None,
            }
        }
    }
}

/// Test connection to a specific agent configuration.
#[tauri::command]
pub async fn test_agent_connection(
    agent_type: String,
    port: Option<u16>,
    model: Option<String>,
) -> CompletionResponse {
    match agent_type.as_str() {
        "claude-cli" => {
            let config = agent::cli_adapter::CliAdapterConfig::claude();
            let adapter = agent::cli_adapter::CliAdapter::new(config);
            run_health(&adapter).await
        }
        "ollama" => {
            let model = model.unwrap_or_else(|| "llama3".to_string());
            let config = agent::http_adapter::HttpAdapterConfig::ollama(&model);
            let adapter = agent::http_adapter::HttpAdapter::new(config);
            run_health(&adapter).await
        }
        "mcp-channel" => {
            let port = port.unwrap_or(8787);
            let config = agent::mcp_adapter::McpAdapterConfig { port };
            let adapter = agent::mcp_adapter::McpAdapter::new(config);
            run_health(&adapter).await
        }
        _ => err_response(format!("Unknown agent type: {}", agent_type)),
    }
}
