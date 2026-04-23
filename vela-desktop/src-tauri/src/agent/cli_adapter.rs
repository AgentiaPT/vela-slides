// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! CLI subprocess adapter — works with any agent CLI supporting `-p` / `--print` mode.

use super::{AgentAdapter, AgentError, CompletionOpts, Message};
use log::{debug, error, warn};
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

/// Configuration for a CLI-based agent adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliAdapterConfig {
    /// Display name (e.g., "Claude Code", "Aider").
    pub name: String,
    /// The CLI command to execute (e.g., "claude", "aider").
    pub command: String,
    /// Arguments template. `{prompt}` is replaced with the actual prompt.
    /// `{max_tokens}` and `{temperature}` are also replaced if present.
    pub args: Vec<String>,
    /// Response format: "claude" (JSON with result field), "raw" (plain text).
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "raw".to_string()
}

impl CliAdapterConfig {
    /// Pre-configured profile for Claude Code CLI.
    pub fn claude() -> Self {
        Self {
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            args: vec![
                "-p".to_string(),
                "--output-format".to_string(),
                "json".to_string(),
                "--max-tokens".to_string(),
                "{max_tokens}".to_string(),
                "{prompt}".to_string(),
            ],
            format: "claude".to_string(),
        }
    }

    /// Pre-configured profile for Aider.
    pub fn aider() -> Self {
        Self {
            name: "Aider".to_string(),
            command: "aider".to_string(),
            args: vec![
                "--message".to_string(),
                "{prompt}".to_string(),
                "--no-auto-commit".to_string(),
                "--no-git".to_string(),
            ],
            format: "raw".to_string(),
        }
    }
}

/// Build a single prompt string from system prompt and messages.
fn build_prompt(system: &str, messages: &[Message]) -> String {
    let mut parts = Vec::new();
    if !system.is_empty() {
        parts.push(format!("[System]\n{}", system));
    }
    for msg in messages {
        let label = match msg.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            other => other,
        };
        parts.push(format!("[{}]\n{}", label, msg.content));
    }
    parts.join("\n\n")
}

/// Replace template variables in args.
fn build_args(
    args: &[String],
    prompt: &str,
    opts: &CompletionOpts,
) -> Vec<String> {
    args.iter()
        .map(|a| {
            a.replace("{prompt}", prompt)
                .replace("{max_tokens}", &opts.max_tokens.to_string())
                .replace("{temperature}", &opts.temperature.to_string())
        })
        .collect()
}

pub struct CliAdapter {
    config: CliAdapterConfig,
    available: bool,
}

impl CliAdapter {
    pub fn new(config: CliAdapterConfig) -> Self {
        let available = which_command(&config.command);
        Self { config, available }
    }

    /// Refresh availability check.
    pub fn refresh_availability(&mut self) {
        self.available = which_command(&self.config.command);
    }
}

/// Check if a command is available in PATH.
fn which_command(cmd: &str) -> bool {
    std::process::Command::new("which")
        .arg(cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Parse Claude JSON output to extract the response text.
fn parse_claude_json(output: &str) -> Result<String, AgentError> {
    // Claude --output-format json returns: {"type":"result","result":"..."}
    match serde_json::from_str::<serde_json::Value>(output) {
        Ok(v) => {
            if let Some(result) = v.get("result").and_then(|r| r.as_str()) {
                Ok(result.to_string())
            } else if let Some(error) = v.get("error").and_then(|e| e.as_str()) {
                Err(AgentError::RequestFailed(error.to_string()))
            } else {
                // Fall back to raw text
                Ok(output.to_string())
            }
        }
        Err(_) => {
            // Not valid JSON, return raw
            Ok(output.to_string())
        }
    }
}

#[async_trait::async_trait]
impl AgentAdapter for CliAdapter {
    fn name(&self) -> &str {
        &self.config.name
    }

    fn is_available(&self) -> bool {
        self.available
    }

    async fn health_check(&self) -> Result<String, AgentError> {
        if !self.available {
            return Err(AgentError::NotAvailable(format!(
                "'{}' not found in PATH",
                self.config.command
            )));
        }
        Ok(format!("'{}' found in PATH", self.config.command))
    }

    async fn complete(
        &self,
        system: &str,
        messages: Vec<Message>,
        opts: CompletionOpts,
    ) -> Result<String, AgentError> {
        if !self.available {
            return Err(AgentError::NotAvailable(format!(
                "'{}' not found",
                self.config.command
            )));
        }

        let prompt = build_prompt(system, &messages);
        let args = build_args(&self.config.args, &prompt, &opts);

        debug!(
            "CLI adapter '{}': {} {:?}",
            self.config.name, self.config.command, args
        );

        let timeout_duration = Duration::from_millis(opts.timeout_ms);

        let result = timeout(timeout_duration, async {
            let mut child = Command::new(&self.config.command)
                .args(&args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .stdin(Stdio::null())
                .spawn()
                .map_err(|e| AgentError::Io(e))?;

            let mut stdout_buf = Vec::new();
            let mut stderr_buf = Vec::new();

            if let Some(ref mut stdout) = child.stdout {
                stdout.read_to_end(&mut stdout_buf).await.map_err(AgentError::Io)?;
            }
            if let Some(ref mut stderr) = child.stderr {
                stderr.read_to_end(&mut stderr_buf).await.map_err(AgentError::Io)?;
            }

            let status = child.wait().await.map_err(AgentError::Io)?;
            let stdout_str = String::from_utf8_lossy(&stdout_buf).to_string();
            let stderr_str = String::from_utf8_lossy(&stderr_buf).to_string();

            if !status.success() {
                let code = status.code().unwrap_or(-1);
                error!(
                    "CLI adapter '{}' exited with code {}: {}",
                    self.config.name, code, stderr_str
                );
                return Err(AgentError::RequestFailed(format!(
                    "Process exited with code {}: {}",
                    code,
                    stderr_str.lines().take(3).collect::<Vec<_>>().join(" ")
                )));
            }

            if !stderr_str.is_empty() {
                warn!("CLI adapter '{}' stderr: {}", self.config.name, stderr_str);
            }

            Ok(stdout_str)
        })
        .await;

        match result {
            Ok(Ok(output)) => {
                // Parse based on format
                if self.config.format == "claude" {
                    parse_claude_json(&output)
                } else {
                    Ok(output.trim().to_string())
                }
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err(AgentError::Timeout(opts.timeout_ms)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_prompt() {
        let msgs = vec![
            Message {
                role: "user".to_string(),
                content: "Hello".to_string(),
            },
            Message {
                role: "assistant".to_string(),
                content: "Hi there".to_string(),
            },
        ];
        let prompt = build_prompt("You are helpful.", &msgs);
        assert!(prompt.contains("[System]\nYou are helpful."));
        assert!(prompt.contains("[User]\nHello"));
        assert!(prompt.contains("[Assistant]\nHi there"));
    }

    #[test]
    fn test_build_args() {
        let args = vec![
            "-p".to_string(),
            "--max-tokens".to_string(),
            "{max_tokens}".to_string(),
            "{prompt}".to_string(),
        ];
        let opts = CompletionOpts {
            max_tokens: 1024,
            ..Default::default()
        };
        let result = build_args(&args, "test prompt", &opts);
        assert_eq!(result[2], "1024");
        assert_eq!(result[3], "test prompt");
    }

    #[test]
    fn test_parse_claude_json() {
        let json = r#"{"type":"result","result":"Hello world"}"#;
        let result = parse_claude_json(json).unwrap();
        assert_eq!(result, "Hello world");
    }

    #[test]
    fn test_parse_claude_json_error() {
        let json = r#"{"error":"Something went wrong"}"#;
        let result = parse_claude_json(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_raw_fallback() {
        let raw = "Just plain text output";
        let result = parse_claude_json(raw).unwrap();
        assert_eq!(result, raw);
    }

    #[test]
    fn test_which_command_echo() {
        assert!(which_command("echo"));
    }

    #[test]
    fn test_which_command_nonexistent() {
        assert!(!which_command("nonexistent_cmd_xyz_12345"));
    }
}
