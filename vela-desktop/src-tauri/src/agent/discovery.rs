// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! Agent discovery — auto-detect available AI agents on startup and periodically.

use super::{AgentInfo, AgentType};
use log::{debug, info, warn};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

/// Check if a command exists in PATH.
fn command_exists(cmd: &str) -> bool {
    std::process::Command::new("which")
        .arg(cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Check if a TCP port is listening (with timeout).
async fn port_is_open(port: u16) -> bool {
    tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false)
}

/// Run a single discovery pass.
pub async fn discover() -> Vec<AgentInfo> {
    let mut agents = Vec::new();

    // Check for Claude Code CLI
    if command_exists("claude") {
        agents.push(AgentInfo {
            name: "Claude Code".to_string(),
            agent_type: AgentType::ClaudeCli,
            available: true,
            status_message: "'claude' CLI found in PATH".to_string(),
        });
    }

    // Check for Aider
    if command_exists("aider") {
        agents.push(AgentInfo {
            name: "Aider".to_string(),
            agent_type: AgentType::AiderCli,
            available: true,
            status_message: "'aider' CLI found in PATH".to_string(),
        });
    }

    // Check for Ollama (port 11434)
    if port_is_open(11434).await {
        agents.push(AgentInfo {
            name: "Ollama".to_string(),
            agent_type: AgentType::Ollama,
            available: true,
            status_message: "Ollama running on port 11434".to_string(),
        });
    }

    // Check for MCP channel (port 8787)
    if port_is_open(8787).await {
        agents.push(AgentInfo {
            name: "MCP Channel".to_string(),
            agent_type: AgentType::McpChannel,
            available: true,
            status_message: "Channel server on port 8787".to_string(),
        });
    }

    debug!("Discovery found {} agents", agents.len());
    agents
}

/// Run discovery loop: immediate check then every 30 seconds.
/// Emits `agents-changed` Tauri event when the set of discovered agents changes.
pub async fn run_discovery_loop(app: AppHandle) {
    let mut previous: Vec<String> = Vec::new();
    let mut ticker = interval(Duration::from_secs(30));

    loop {
        ticker.tick().await;

        let agents = discover().await;
        let current: Vec<String> = agents.iter().map(|a| a.name.clone()).collect();

        if current != previous {
            info!(
                "Agent discovery changed: {:?} → {:?}",
                previous, current
            );
            if let Err(e) = app.emit("agents-changed", &agents) {
                warn!("Failed to emit agents-changed event: {}", e);
            }
            previous = current;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_exists_echo() {
        assert!(command_exists("echo"));
    }

    #[test]
    fn test_command_exists_nonexistent() {
        assert!(!command_exists("nonexistent_agent_xyz_99999"));
    }

    #[tokio::test]
    async fn test_port_not_open() {
        // Port 59999 should not be open
        assert!(!port_is_open(59999).await);
    }

    #[tokio::test]
    async fn test_discover_returns_vec() {
        let agents = discover().await;
        // Should return a vec (may be empty in CI)
        assert!(agents.len() >= 0);
    }
}
