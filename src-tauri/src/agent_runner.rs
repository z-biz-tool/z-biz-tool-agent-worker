// Wraps the local agent-proxy HTTP service. agent-proxy is started by
// `agent_proxy::spawn()` in `lib.rs` `setup`, and exposes:
//
//   POST /v1/session/open     — open a session bound to a CLI type
//   POST /v1/chat/completions — OpenAI-compatible chat (sync or SSE)
//
// `run_agent` opens a session, fires one chat round-trip, and returns the
// assistant content. It is intentionally blocking — callers (assign_task,
// retry_task) wrap it in a background thread so the UI doesn't block.

use serde_json::json;

const AGENT_PROXY_URL: &str = "http://127.0.0.1:9099";
/// 180s is generous; most local CLI calls finish in 5-30s.
const CHAT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// Run a single chat round-trip against the given local CLI type
/// (claude-code / hermes / opencode) and return the assistant message.
pub fn run_agent(cli_type: &str, prompt: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_read(CHAT_TIMEOUT)
        .timeout_connect(std::time::Duration::from_millis(500))
        .build();

    // 1. Open a session bound to the requested CLI type.
    let session_id = {
        let resp = agent
            .post(&format!("{}/v1/session/open", AGENT_PROXY_URL))
            .set("Content-Type", "application/json")
            .send_string(&json!({ "cliType": cli_type }).to_string())
            .map_err(|e| format!("open session 失败: {}", e))?;
        let body: serde_json::Value = serde_json::from_reader(resp.into_reader())
            .map_err(|e| format!("parse session 响应失败: {}", e))?;
        body.get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "session 响应里没有 sessionId".to_string())?
            .to_string()
    };

    // 2. Send the chat.
    let resp = agent
        .post(&format!("{}/v1/chat/completions", AGENT_PROXY_URL))
        .set("Content-Type", "application/json")
        .set("X-Session-Id", &session_id)
        .send_string(
            &json!({
                "model": cli_type,
                "messages": [{ "role": "user", "content": prompt }],
                "stream": false
            })
            .to_string(),
        )
        .map_err(|e| format!("chat 失败: {}", e))?;
    let body: serde_json::Value = serde_json::from_reader(resp.into_reader())
        .map_err(|e| format!("parse chat 响应失败: {}", e))?;
    body.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "chat 响应里没有 content".to_string())
}
