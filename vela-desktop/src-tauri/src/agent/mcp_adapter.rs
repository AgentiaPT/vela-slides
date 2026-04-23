// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! MCP channel adapter — wraps the existing vela-channel.ts bridge.

use super::{AgentAdapter, AgentError, CompletionOpts, Message};
use log::debug;
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};

/// Configuration for the MCP channel adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpAdapterConfig {
    /// Port the channel server listens on.
    #[serde(default = "default_port")]
    pub port: u16,
}

fn default_port() -> u16 {
    8787
}

impl Default for McpAdapterConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
        }
    }
}

/// Request body for the channel /action endpoint.
#[derive(Serialize)]
struct ChannelRequest {
    action: String,
    system: String,
    messages: Vec<ChannelMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Serialize)]
struct ChannelMessage {
    role: String,
    content: String,
}

/// Response from the channel /action endpoint.
#[derive(Deserialize)]
struct ChannelResponse {
    ok: bool,
    reply: Option<String>,
    error: Option<String>,
}

pub struct McpAdapter {
    config: McpAdapterConfig,
    client: reqwest::Client,
}

impl McpAdapter {
    pub fn new(config: McpAdapterConfig) -> Self {
        let client = reqwest::Client::new();
        Self { config, client }
    }

    fn base_url(&self) -> String {
        format!("http://localhost:{}", self.config.port)
    }
}

#[async_trait::async_trait]
impl AgentAdapter for McpAdapter {
    fn name(&self) -> &str {
        "MCP Channel"
    }

    fn is_available(&self) -> bool {
        true // checked via health_check
    }

    async fn health_check(&self) -> Result<String, AgentError> {
        let url = format!("{}/health", self.base_url());

        let resp = timeout(Duration::from_secs(3), self.client.get(&url).send())
            .await
            .map_err(|_| AgentError::Timeout(3000))?
            .map_err(|e| {
                AgentError::NotAvailable(format!("Channel not reachable on port {}: {}", self.config.port, e))
            })?;

        if resp.status().is_success() {
            Ok(format!("Channel running on port {}", self.config.port))
        } else {
            Err(AgentError::RequestFailed(format!(
                "Channel HTTP {}",
                resp.status()
            )))
        }
    }

    async fn complete(
        &self,
        system: &str,
        messages: Vec<Message>,
        opts: CompletionOpts,
    ) -> Result<String, AgentError> {
        let channel_msgs: Vec<ChannelMessage> = messages
            .iter()
            .map(|m| ChannelMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();

        let body = ChannelRequest {
            action: "complete".to_string(),
            system: system.to_string(),
            messages: channel_msgs,
            temperature: opts.temperature,
            max_tokens: opts.max_tokens,
        };

        let url = format!("{}/action", self.base_url());
        debug!("MCP adapter POST {}", url);

        let timeout_duration = Duration::from_millis(opts.timeout_ms);

        let result = timeout(timeout_duration, async {
            let resp = self.client.post(&url).json(&body).send().await?;
            let parsed: ChannelResponse = resp.json().await?;
            Ok::<_, reqwest::Error>(parsed)
        })
        .await;

        match result {
            Ok(Ok(parsed)) => {
                if parsed.ok {
                    parsed
                        .reply
                        .ok_or_else(|| AgentError::InvalidResponse("No reply in response".to_string()))
                } else {
                    Err(AgentError::RequestFailed(
                        parsed.error.unwrap_or_else(|| "Unknown error".to_string()),
                    ))
                }
            }
            Ok(Err(e)) => Err(AgentError::Http(e)),
            Err(_) => Err(AgentError::Timeout(opts.timeout_ms)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = McpAdapterConfig::default();
        assert_eq!(config.port, 8787);
    }

    #[test]
    fn test_base_url() {
        let adapter = McpAdapter::new(McpAdapterConfig { port: 9999 });
        assert_eq!(adapter.base_url(), "http://localhost:9999");
    }
}
