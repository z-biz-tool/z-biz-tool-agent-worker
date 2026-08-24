use serde::{Deserialize, Serialize};

// ===== 项目 =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

// ===== Agent =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub system_prompt: String,
    pub model: String,
    pub status: String, // idle | working | offline
    pub current_task_id: Option<String>,
    /// 来源: "local" = 本地 CLI(claude-code / hermes / opencode), "manual" = 手填
    pub source: String,
    /// 本地 CLI 类型, source=local 时必填
    pub cli_type: Option<String>,
    /// agent-proxy 注册的 id, source=local 时必填
    pub local_agent_id: Option<String>,
    /// 本地 CLI 版本(展示用)
    pub cli_version: Option<String>,
    /// 本地 CLI 可执行文件绝对路径(展示用)
    pub cli_path: Option<String>,
    pub created_at: String,
    pub last_used_at: String,
}

// ===== 任务 =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub description: String,
    pub status: String, // todo | doing | waiting | review | done
    pub priority: i32,
    pub assigned_agent_id: Option<String>,
    pub assigned_agent_name: Option<String>,
    pub children: Vec<String>,
    pub output: Option<String>,
    pub agent_output: Option<String>,
    pub waiting_for_input: Option<bool>,
    pub receipts: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

// ===== 项目统计 =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStats {
    pub total: i32,
    pub todo: i32,
    pub doing: i32,
    pub waiting: i32,
    pub review: i32,
    pub done: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStats {
    pub total: i32,
    pub working: i32,
    pub idle: i32,
    pub offline: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectStats {
    pub tasks: TaskStats,
    pub agents: AgentStats,
}

// ===== Agent状态 =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatus {
    pub agent_id: String,
    pub status: String,
    pub running: bool,
    pub current_task_id: Option<String>,
    pub output: Option<String>,
}

// ===== 配置 =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub theme: String,
    pub api_endpoint: String,
    pub default_model: String,
}

// ===== 本地 CLI 探测结果(来自 agent-proxy /v1/cli-agents) =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAgentInfo {
    /// claude-code / hermes / opencode
    #[serde(rename = "type")]
    pub cli_type: String,
    pub command: String,
    pub path: Option<String>,
    pub available: bool,
    pub version: Option<String>,
    pub registered: bool,
    pub agent_id: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            api_endpoint: "http://localhost:11434".to_string(),
            default_model: "default".to_string(),
        }
    }
}

// ===== 消息 =====
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMessage {
    pub id: String,
    pub task_id: String,
    pub role: String, // user | agent
    pub content: String,
    pub created_at: String,
}
