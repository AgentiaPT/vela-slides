// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! HTTP API adapter — works with Ollama, OpenAI-compatible APIs, and similar.

use super::{AgentAdapter, AgentError, CompletionOpts, Message};
use log::debug;
use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};

/// Configuration for an HTTP API adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpAdapterConfig {
    /// Display name (e.g., "Ollama", "OpenAI-compat").
    pub name: String,
    /// Base URL (e.g., "http://localhost:11434").
    pub base_url: String,
    /// Model name (e.g., "llama3", "gpt-4").
    pub model: String,
    /// API format: "ollama" or "openai".
    #[serde(default = "default_api_format")]
    pub api_format: String,
    /// Optional API key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

fn default_api_format() -> String {
    "ollama".to_string()
}

impl HttpAdapterConfig {
    /// Pre-configured profile for Ollama.
    pub fn ollama(model: &str) -> Self {
        Self {
            name: format!("Ollama ({})", model),
            base_url: "http://localhost:11434".to_string(),
            model: model.to_string(),
            api_format: "ollama".to_string(),
            api_key: None,
        }
    }

    /// Pre-configured profile for OpenAI-compatible API.
    pub fn openai_compat(base_url: &str, model: &str) -> Self {
        Self {
            name: format!("OpenAI-compat ({})", model),
            base_url: base_url.to_string(),
            model: model.to_string(),
            api_format: "openai".to_string(),
            api_key: None,
        }
    }
}

/// Ollama chat request body.
#[derive(Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Serialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_predict: u32,
}

/// Ollama chat response.
#[derive(Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaResponseMessage>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct OllamaResponseMessage {
    content: String,
}

/// OpenAI chat request body.
#[derive(Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    temperature: f32,
    max_tokens: u32,
    stream: bool,
}

#[derive(Serialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

/// OpenAI chat response.
#[derive(Deserialize)]
struct OpenAiChatResponse {
    choices: Option<Vec<OpenAiChoice>>,
    error: Option<OpenAiError>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Deserialize)]
struct OpenAiResponseMessage {
    content: String,
}

#[derive(Deserialize)]
struct OpenAiError {
    message: String,
}

pub struct HttpAdapter {
    config: HttpAdapterConfig,
    client: reqwest::Client,
}

impl HttpAdapter {
    pub fn new(config: HttpAdapterConfig) -> Self {
        let client = reqwest::Client::new();
        Self { config, client }
    }

    /// Build and send an Ollama-format request.
    async fn complete_ollama(
        &self,
        system: &str,
        messages: Vec<Message>,
        opts: &CompletionOpts,
    ) -> Result<String, AgentError> {
        let mut ollama_msgs: Vec<OllamaMessage> = Vec::new();

        if !system.is_empty() {
            ollama_msgs.push(OllamaMessage {
                role: "system".to_string(),
                content: system.to_string(),
            });
        }

        for msg in &messages {
            ollama_msgs.push(OllamaMessage {
                role: msg.role.clone(),
                content: msg.content.clone(),
            });
        }

        let body = OllamaChatRequest {
            model: self.config.model.clone(),
            messages: ollama_msgs,
            stream: false,
            options: OllamaOptions {
                temperature: opts.temperature,
                num_predict: opts.max_tokens,
            },
        };

        let url = format!("{}/api/chat", self.config.base_url);
        debug!("HTTP adapter (Ollama) POST {}", url);

        let resp = self.client.post(&url).json(&body).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AgentError::RequestFailed(format!(
                "HTTP {}: {}",
                status, text
            )));
        }

        let parsed: OllamaChatResponse = resp.json().await?;

        if let Some(error) = parsed.error {
            return Err(AgentError::RequestFailed(error));
        }

        parsed
            .message
            .map(|m| m.content)
            .ok_or_else(|| AgentError::InvalidResponse("No message in response".to_string()))
    }

    /// Build and send an OpenAI-format request.
    async fn complete_openai(
        &self,
        system: &str,
        messages: Vec<Message>,
        opts: &CompletionOpts,
    ) -> Result<String, AgentError> {
        let mut openai_msgs: Vec<OpenAiMessage> = Vec::new();

        if !system.is_empty() {
            openai_msgs.push(OpenAiMessage {
                role: "system".to_string(),
                content: system.to_string(),
            });
        }

        for msg in &messages {
            openai_msgs.push(OpenAiMessage {
                role: msg.role.clone(),
                content: msg.content.clone(),
            });
        }

        let body = OpenAiChatRequest {
            model: self.config.model.clone(),
            messages: openai_msgs,
            temperature: opts.temperature,
            max_tokens: opts.max_tokens,
            stream: false,
        };

        let url = format!("{}/v1/chat/completions", self.config.base_url);
        debug!("HTTP adapter (OpenAI) POST {}", url);

        let mut req = self.client.post(&url).json(&body);
        if let Some(ref key) = self.config.api_key {
            req = req.bearer_auth(key);
        }

        let resp = req.send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AgentError::RequestFailed(format!(
                "HTTP {}: {}",
                status, text
            )));
        }

        let parsed: OpenAiChatResponse = resp.json().await?;

        if let Some(error) = parsed.error {
            return Err(AgentError::RequestFailed(error.message));
        }

        parsed
            .choices
            .and_then(|c| c.into_iter().next())
            .map(|c| c.message.content)
            .ok_or_else(|| AgentError::InvalidResponse("No choices in response".to_string()))
    }
}

#[async_trait::async_trait]
impl AgentAdapter for HttpAdapter {
    fn name(&self) -> &str {
        &self.config.name
    }

    fn is_available(&self) -> bool {
        // Availability is checked via health_check since it requires network
        true
    }

    async fn health_check(&self) -> Result<String, AgentError> {
        let url = if self.config.api_format == "ollama" {
            format!("{}/api/tags", self.config.base_url)
        } else {
            format!("{}/v1/models", self.config.base_url)
        };

        let resp = timeout(Duration::from_secs(5), self.client.get(&url).send())
            .await
            .map_err(|_| AgentError::Timeout(5000))?
            .map_err(|e| AgentError::RequestFailed(format!("Connection failed: {}", e)))?;

        if resp.status().is_success() {
            Ok(format!("Connected to {}", self.config.base_url))
        } else {
            Err(AgentError::RequestFailed(format!(
                "HTTP {}",
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
        let timeout_duration = Duration::from_millis(opts.timeout_ms);

        let result = if self.config.api_format == "ollama" {
            timeout(
                timeout_duration,
                self.complete_ollama(system, messages, &opts),
            )
            .await
        } else {
            timeout(
                timeout_duration,
                self.complete_openai(system, messages, &opts),
            )
            .await
        };

        match result {
            Ok(inner) => inner,
            Err(_) => Err(AgentError::Timeout(opts.timeout_ms)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ollama_config() {
        let config = HttpAdapterConfig::ollama("llama3");
        assert_eq!(config.base_url, "http://localhost:11434");
        assert_eq!(config.model, "llama3");
        assert_eq!(config.api_format, "ollama");
    }

    #[test]
    fn test_openai_config() {
        let config = HttpAdapterConfig::openai_compat("http://localhost:8080", "gpt-4");
        assert_eq!(config.api_format, "openai");
        assert_eq!(config.model, "gpt-4");
    }
}
