use crate::models::*;
use crate::storage;
use chrono::Utc;

const AGENT_PROXY_URL: &str = "http://127.0.0.1:9099";

// ===== 项目命令 =====

#[tauri::command]
pub fn list_projects() -> Vec<Project> {
    storage::read_projects()
}

#[tauri::command]
pub fn create_project(name: String, desc: String) -> Project {
    let now = Utc::now().to_rfc3339();
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description: desc,
        created_at: now.clone(),
        updated_at: now,
    };
    storage::save_project(&project);
    project
}

#[tauri::command]
pub fn delete_project(id: String) -> Result<(), String> {
    storage::remove_project(&id);
    Ok(())
}

#[tauri::command]
pub fn get_project_stats(id: String) -> Result<ProjectStats, String> {
    let tasks = storage::read_tasks_by_project(&id);
    let agents = storage::read_agents_by_project(&id);

    let task_stats = TaskStats {
        total: tasks.len() as i32,
        todo: tasks.iter().filter(|t| t.status == "todo").count() as i32,
        doing: tasks.iter().filter(|t| t.status == "doing").count() as i32,
        waiting: tasks.iter().filter(|t| t.status == "waiting").count() as i32,
        review: tasks.iter().filter(|t| t.status == "review").count() as i32,
        done: tasks.iter().filter(|t| t.status == "done").count() as i32,
    };

    let agent_stats = AgentStats {
        total: agents.len() as i32,
        working: agents.iter().filter(|a| a.status == "working").count() as i32,
        idle: agents.iter().filter(|a| a.status == "idle").count() as i32,
        offline: agents.iter().filter(|a| a.status == "offline").count() as i32,
    };

    Ok(ProjectStats {
        tasks: task_stats,
        agents: agent_stats,
    })
}

// ===== Agent命令 =====

#[tauri::command]
pub fn list_agents(project_id: String) -> Vec<Agent> {
    storage::read_agents_by_project(&project_id)
}

/// 探测本机可用的 CLI agent(claude-code / hermes / opencode)。
/// 转发到本地 agent-proxy 的 GET /v1/cli-agents,带 1.5s 超时。
/// agent-proxy 没起时不报错,返回空列表。
#[tauri::command]
pub fn discover_local_agents() -> Vec<LocalAgentInfo> {
    let url = format!("{}/v1/cli-agents", AGENT_PROXY_URL);
    let agent = ureq::AgentBuilder::new()
        .timeout_read(std::time::Duration::from_millis(1500))
        .timeout_connect(std::time::Duration::from_millis(500))
        .build();
    match agent.get(&url).call() {
        Ok(resp) => {
            let reader = resp.into_reader();
            match serde_json::from_reader::<_, serde_json::Value>(reader) {
                Ok(v) => {
                    let arr = v.get("cli_agents").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                    arr.into_iter()
                        .filter_map(|item| serde_json::from_value::<LocalAgentInfo>(item).ok())
                        .collect()
                }
                Err(e) => {
                    eprintln!("[discover_local_agents] parse error: {}", e);
                    Vec::new()
                }
            }
        }
        Err(e) => {
            // agent-proxy 未启动 / 网络不通 — 不阻塞 UI
            eprintln!("[discover_local_agents] proxy unreachable: {}", e);
            Vec::new()
        }
    }
}

/// 高级模式:手填 Agent(不走本地 CLI)。
#[tauri::command]
pub fn create_agent(project_id: String, name: String, prompt: String, model: String) -> Agent {
    let now = Utc::now().to_rfc3339();
    let agent = Agent {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        name,
        system_prompt: if prompt.is_empty() { "你是一个有用的AI助手。".to_string() } else { prompt },
        model: if model.is_empty() { "default".to_string() } else { model },
        status: "idle".to_string(),
        current_task_id: None,
        source: "manual".to_string(),
        cli_type: None,
        local_agent_id: None,
        cli_version: None,
        cli_path: None,
        created_at: now.clone(),
        last_used_at: now,
    };
    storage::save_agent(&agent);
    agent
}

/// 主入口:从本地 CLI 引入 Agent 到项目。
/// 同一个项目下,同一个 cli_type 只允许挂一个(避免重复占位)。
/// 已存在则返回 Err,不静默覆盖。
#[tauri::command]
pub fn import_local_agent(
    project_id: String,
    cli_type: String,
    command: String,
    cli_path: Option<String>,
    cli_version: Option<String>,
    local_agent_id: Option<String>,
) -> Result<Agent, String> {
    // 查重:同 project + 同 cli_type 已存在则拒绝
    let existing: Vec<Agent> = storage::read_agents_by_project(&project_id)
        .into_iter()
        .filter(|a| a.cli_type.as_deref() == Some(&cli_type))
        .collect();
    if !existing.is_empty() {
        return Err(format!("本项目已挂载 {} 类型的 Agent", cli_type));
    }

    let display_name = match cli_type.as_str() {
        "claude-code" => "Claude Code",
        "hermes" => "Hermes",
        "opencode" => "OpenCode",
        other => other,
    };
    let now = Utc::now().to_rfc3339();
    let agent = Agent {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        name: display_name.to_string(),
        system_prompt: format!("通过本地 {} CLI 引入的 Agent。", display_name),
        model: "default".to_string(),
        status: "idle".to_string(),
        current_task_id: None,
        source: "local".to_string(),
        cli_type: Some(cli_type),
        local_agent_id,
        cli_version,
        cli_path: cli_path.or(Some(command)),
        created_at: now.clone(),
        last_used_at: now,
    };
    storage::save_agent(&agent);
    Ok(agent)
}

#[tauri::command]
pub fn delete_agent(id: String) -> Result<(), String> {
    storage::remove_agent(&id);
    Ok(())
}

#[tauri::command]
pub fn clone_agent(project_id: String, source_id: String, name: String) -> Result<Agent, String> {
    let source = storage::find_agent(&source_id).ok_or("源Agent不存在")?;
    let now = Utc::now().to_rfc3339();
    let agent = Agent {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        name: if name.is_empty() { format!("{} (副本)", source.name) } else { name },
        system_prompt: source.system_prompt,
        model: source.model,
        status: "idle".to_string(),
        current_task_id: None,
        source: source.source.clone(),
        cli_type: source.cli_type.clone(),
        local_agent_id: source.local_agent_id.clone(),
        cli_version: source.cli_version.clone(),
        cli_path: source.cli_path.clone(),
        created_at: now.clone(),
        last_used_at: now,
    };
    storage::save_agent(&agent);
    Ok(agent)
}

// ===== 任务命令 =====

#[tauri::command]
pub fn list_tasks(project_id: String) -> Vec<Task> {
    storage::read_tasks_by_project(&project_id)
}

#[tauri::command]
pub fn create_task(project_id: String, title: String, desc: String, parent_id: Option<String>) -> Task {
    let now = Utc::now().to_rfc3339();
    let task = Task {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        parent_id,
        title,
        description: desc,
        status: "todo".to_string(),
        priority: 0,
        assigned_agent_id: None,
        assigned_agent_name: None,
        children: Vec::new(),
        output: None,
        agent_output: None,
        waiting_for_input: None,
        receipts: None,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
    };
    storage::save_task(&task);

    // 如果有父任务，更新父任务的children
    if let Some(pid) = &task.parent_id {
        if let Some(mut parent) = storage::find_task(pid) {
            parent.children.push(task.id.clone());
            storage::save_task(&parent);
        }
    }

    task
}

#[tauri::command]
pub fn delete_task(id: String) -> Result<(), String> {
    // 先从父任务中移除
    if let Some(task) = storage::find_task(&id) {
        if let Some(pid) = &task.parent_id {
            if let Some(mut parent) = storage::find_task(pid) {
                parent.children.retain(|c| c != &id);
                storage::save_task(&parent);
            }
        }
    }
    storage::remove_task(&id);
    Ok(())
}

#[tauri::command]
pub fn assign_task(task_id: String, agent_id: String) -> Result<Task, String> {
    let mut task = storage::find_task(&task_id).ok_or("任务不存在")?;
    let agent = storage::find_agent(&agent_id).ok_or("Agent不存在")?;

    task.assigned_agent_id = Some(agent_id.clone());
    task.assigned_agent_name = Some(agent.name.clone());
    task.status = "doing".to_string();
    task.updated_at = Utc::now().to_rfc3339();

    // 更新Agent状态
    let mut agent = agent;
    agent.status = "working".to_string();
    agent.current_task_id = Some(task_id.clone());
    agent.last_used_at = Utc::now().to_rfc3339();
    storage::save_agent(&agent);

    storage::save_task(&task);
    Ok(task)
}

/// 任意状态流转。合法的状态: todo | doing | waiting | review | done
/// 切到 done 时同时设置 completed_at;doing 时如果原来有 assigned_agent,会保留分配。
#[tauri::command]
pub fn update_task_status(task_id: String, status: String) -> Result<Task, String> {
    let valid = ["todo", "doing", "waiting", "review", "done"];
    if !valid.contains(&status.as_str()) {
        return Err(format!("非法状态: {}", status));
    }
    let mut task = storage::find_task(&task_id).ok_or("任务不存在")?;
    let now = Utc::now().to_rfc3339();
    task.status = status.clone();
    task.updated_at = now.clone();
    if status == "done" {
        task.completed_at = Some(now);
        // 释放 Agent
        if let Some(agent_id) = &task.assigned_agent_id {
            if let Some(mut agent) = storage::find_agent(agent_id) {
                agent.status = "idle".to_string();
                agent.current_task_id = None;
                storage::save_agent(&agent);
            }
        }
    }
    storage::save_task(&task);
    Ok(task)
}

#[tauri::command]
pub fn review_task(task_id: String, approved: bool) -> Result<Task, String> {
    let mut task = storage::find_task(&task_id).ok_or("任务不存在")?;
    let now = Utc::now().to_rfc3339();

    if approved {
        task.status = "done".to_string();
        task.completed_at = Some(now.clone());
    } else {
        task.status = "todo".to_string();
    }
    task.updated_at = now;

    // Agent回归空闲
    if let Some(agent_id) = &task.assigned_agent_id {
        if let Some(mut agent) = storage::find_agent(agent_id) {
            agent.status = "idle".to_string();
            agent.current_task_id = None;
            storage::save_agent(&agent);
        }
    }

    storage::save_task(&task);
    Ok(task)
}

// ===== Agent状态 =====

#[tauri::command]
pub fn get_agent_status(agent_id: String) -> Result<AgentStatus, String> {
    let agent = storage::find_agent(&agent_id).ok_or("Agent不存在")?;
    Ok(AgentStatus {
        agent_id: agent.id.clone(),
        status: agent.status.clone(),
        running: agent.status == "working",
        current_task_id: agent.current_task_id.clone(),
        output: None, // TODO: 实际执行时填充
    })
}

// ===== 消息 =====

#[tauri::command]
pub fn send_task_message(task_id: String, message: String) -> Result<TaskMessage, String> {
    let now = Utc::now().to_rfc3339();
    let msg = TaskMessage {
        id: uuid::Uuid::new_v4().to_string(),
        task_id,
        role: "user".to_string(),
        content: message,
        created_at: now,
    };
    storage::save_task_message(&msg);
    // TODO: 实际调用AI API的逻辑后续实现
    Ok(msg)
}

#[tauri::command]
pub fn get_task_messages(task_id: String) -> Vec<TaskMessage> {
    storage::read_task_messages(&task_id)
}

// ===== 配置 =====

#[tauri::command]
pub fn get_config() -> AppConfig {
    storage::read_config()
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    storage::write_config(&config);
    Ok(())
}
