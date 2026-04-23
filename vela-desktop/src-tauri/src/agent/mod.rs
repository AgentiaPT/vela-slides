// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! Agent adapter system — trait, router, and shared types.

pub mod cli_adapter;
pub mod discovery;
pub mod http_adapter;
pub mod mcp_adapter;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;

// ── Error types ────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum AgentError {
    #[error("Agent not available: {0}")]
    NotAvailable(String),
    #[error("Agent request failed: {0}")]
    RequestFailed(String),
    #[error("Agent timeout after {0}ms")]
    Timeout(u64),
    #[error("Invalid response: {0}")]
    InvalidResponse(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
}

// ── Message types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionOpts {
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub call_type: String,
}

fn default_temperature() -> f32 {
    0.0
}
fn default_max_tokens() -> u32 {
    16384
}
fn default_timeout_ms() -> u64 {
    120_000
}

impl Default for CompletionOpts {
    fn default() -> Self {
        Self {
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            timeout_ms: default_timeout_ms(),
            call_type: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub action: String,
    pub system: String,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Agent info ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    pub agent_type: AgentType,
    pub available: bool,
    pub status_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCli,
    CopilotCli,
    AiderCli,
    Ollama,
    OpenAiCompat,
    McpChannel,
    DirectApi,
    Custom,
}

// ── Agent adapter trait ────────────────────────────────────────────

#[async_trait::async_trait]
pub trait AgentAdapter: Send + Sync {
    /// Human-readable name of this adapter.
    fn name(&self) -> &str;

    /// Check if the adapter is currently available.
    fn is_available(&self) -> bool;

    /// Detailed health check.
    async fn health_check(&self) -> Result<String, AgentError>;

    /// Send a completion request and return the response text.
    async fn complete(
        &self,
        system: &str,
        messages: Vec<Message>,
        opts: CompletionOpts,
    ) -> Result<String, AgentError>;
}

// ── Agent router ───────────────────────────────────────────────────

pub struct AgentRouter {
    active: Arc<RwLock<Option<Box<dyn AgentAdapter>>>>,
    discovered: Arc<RwLock<Vec<AgentInfo>>>,
}

impl AgentRouter {
    pub fn new() -> Self {
        Self {
            active: Arc::new(RwLock::new(None)),
            discovered: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn set_active(&self, adapter: Box<dyn AgentAdapter>) {
        let mut active = self.active.write().await;
        *active = Some(adapter);
    }

    pub async fn clear_active(&self) {
        let mut active = self.active.write().await;
        *active = None;
    }

    pub async fn complete(
        &self,
        system: &str,
        messages: Vec<Message>,
        opts: CompletionOpts,
    ) -> Result<CompletionResponse, AgentError> {
        let active = self.active.read().await;
        match active.as_ref() {
            Some(adapter) => {
                let reply = adapter.complete(system, messages, opts).await?;
                Ok(CompletionResponse {
                    ok: true,
                    reply: Some(reply),
                    error: None,
                })
            }
            None => Ok(CompletionResponse {
                ok: false,
                reply: None,
                error: Some("No active agent configured".to_string()),
            }),
        }
    }

    pub async fn health(&self) -> CompletionResponse {
        let active = self.active.read().await;
        match active.as_ref() {
            Some(adapter) => match adapter.health_check().await {
                Ok(msg) => CompletionResponse {
                    ok: true,
                    reply: Some(format!("{}: {}", adapter.name(), msg)),
                    error: None,
                },
                Err(e) => CompletionResponse {
                    ok: false,
                    reply: None,
                    error: Some(format!("{}: {}", adapter.name(), e)),
                },
            },
            None => CompletionResponse {
                ok: false,
                reply: None,
                error: Some("No active agent".to_string()),
            },
        }
    }

    pub async fn get_discovered(&self) -> Vec<AgentInfo> {
        self.discovered.read().await.clone()
    }

    pub async fn set_discovered(&self, agents: Vec<AgentInfo>) {
        let mut discovered = self.discovered.write().await;
        *discovered = agents;
    }

    pub async fn active_name(&self) -> Option<String> {
        let active = self.active.read().await;
        active.as_ref().map(|a| a.name().to_string())
    }
}

impl Default for AgentRouter {
    fn default() -> Self {
        Self::new()
    }
}

// We need async_trait as a dependency — add to Cargo.toml
// For now, we use the crate-level attribute approach
