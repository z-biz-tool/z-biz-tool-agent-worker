use crate::models::*;
use crate::storage;
use chrono::Utc;

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
        created_at: now.clone(),
        last_used_at: now,
    };
    storage::save_agent(&agent);
    agent
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
