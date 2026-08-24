use std::fs;
use std::path::PathBuf;
use serde_json;
use crate::models::*;

const DATA_DIR_NAME: &str = ".z-agent-worker";

fn data_dir() -> PathBuf {
    let home = dirs::home_dir().expect("无法获取用户主目录");
    home.join(DATA_DIR_NAME)
}

fn projects_file() -> PathBuf {
    data_dir().join("projects.json")
}

fn agents_file() -> PathBuf {
    data_dir().join("agents.json")
}

fn tasks_file() -> PathBuf {
    data_dir().join("tasks.json")
}

fn config_file() -> PathBuf {
    data_dir().join("config.json")
}

fn messages_dir() -> PathBuf {
    data_dir().join("messages")
}

fn task_messages_file(task_id: &str) -> PathBuf {
    messages_dir().join(format!("{}.json", task_id))
}

/// 确保数据目录存在
pub fn ensure_data_dir() {
    let dir = data_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).expect("无法创建数据目录");
    }
    let msg_dir = messages_dir();
    if !msg_dir.exists() {
        fs::create_dir_all(&msg_dir).expect("无法创建消息目录");
    }
}

// ===== 项目存储 =====
pub fn read_projects() -> Vec<Project> {
    let file = projects_file();
    if !file.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn write_projects(projects: &[Project]) {
    ensure_data_dir();
    let content = serde_json::to_string_pretty(&projects).expect("序列化项目失败");
    fs::write(projects_file(), content).expect("写入项目文件失败");
}

pub fn save_project(project: &Project) {
    let mut projects = read_projects();
    if let Some(idx) = projects.iter().position(|p| p.id == project.id) {
        projects[idx] = project.clone();
    } else {
        projects.push(project.clone());
    }
    write_projects(&projects);
}

pub fn remove_project(id: &str) {
    let projects = read_projects();
    let filtered: Vec<Project> = projects.into_iter().filter(|p| p.id != id).collect();
    write_projects(&filtered);
    // 同时删除关联的agents和tasks
    let agents = read_agents();
    let filtered_agents: Vec<Agent> = agents.into_iter().filter(|a| a.project_id != id).collect();
    write_agents(&filtered_agents);
    let tasks = read_tasks();
    let filtered_tasks: Vec<Task> = tasks.into_iter().filter(|t| t.project_id != id).collect();
    write_tasks(&filtered_tasks);
}

// ===== Agent存储 =====
pub fn read_agents() -> Vec<Agent> {
    let file = agents_file();
    if !file.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn write_agents(agents: &[Agent]) {
    ensure_data_dir();
    let content = serde_json::to_string_pretty(agents).expect("序列化Agent失败");
    fs::write(agents_file(), content).expect("写入Agent文件失败");
}

pub fn read_agents_by_project(project_id: &str) -> Vec<Agent> {
    read_agents().into_iter().filter(|a| a.project_id == project_id).collect()
}

pub fn find_agent(id: &str) -> Option<Agent> {
    read_agents().into_iter().find(|a| a.id == id)
}

pub fn save_agent(agent: &Agent) {
    let mut agents = read_agents();
    if let Some(idx) = agents.iter().position(|a| a.id == agent.id) {
        agents[idx] = agent.clone();
    } else {
        agents.push(agent.clone());
    }
    write_agents(&agents);
}

pub fn remove_agent(id: &str) {
    let agents = read_agents();
    let filtered: Vec<Agent> = agents.into_iter().filter(|a| a.id != id).collect();
    write_agents(&filtered);
}

// ===== 任务存储 =====
pub fn read_tasks() -> Vec<Task> {
    let file = tasks_file();
    if !file.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn write_tasks(tasks: &[Task]) {
    ensure_data_dir();
    let content = serde_json::to_string_pretty(tasks).expect("序列化任务失败");
    fs::write(tasks_file(), content).expect("写入任务文件失败");
}

pub fn read_tasks_by_project(project_id: &str) -> Vec<Task> {
    read_tasks().into_iter().filter(|t| t.project_id == project_id).collect()
}

pub fn find_task(id: &str) -> Option<Task> {
    read_tasks().into_iter().find(|t| t.id == id)
}

pub fn save_task(task: &Task) {
    let mut tasks = read_tasks();
    if let Some(idx) = tasks.iter().position(|t| t.id == task.id) {
        tasks[idx] = task.clone();
    } else {
        tasks.push(task.clone());
    }
    write_tasks(&tasks);
}

pub fn remove_task(id: &str) {
    let tasks = read_tasks();
    let child_ids: Vec<String> = tasks.iter()
        .filter(|t| t.parent_id.as_deref() == Some(id))
        .map(|t| t.id.clone())
        .collect();
    let filtered: Vec<Task> = tasks.into_iter().filter(|t| t.id != id).collect();
    write_tasks(&filtered);
    for cid in child_ids {
        remove_task(&cid);
    }
}

// ===== 配置存储 =====
pub fn read_config() -> AppConfig {
    let file = config_file();
    if !file.exists() {
        return AppConfig::default();
    }
    match fs::read_to_string(&file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub fn write_config(config: &AppConfig) {
    ensure_data_dir();
    let content = serde_json::to_string_pretty(config).expect("序列化配置失败");
    fs::write(config_file(), content).expect("写入配置文件失败");
}

// ===== 消息存储 =====
pub fn read_task_messages(task_id: &str) -> Vec<TaskMessage> {
    let file = task_messages_file(task_id);
    if !file.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_task_message(message: &TaskMessage) {
    ensure_data_dir();
    let mut messages = read_task_messages(&message.task_id);
    messages.push(message.clone());
    let content = serde_json::to_string_pretty(&messages).expect("序列化消息失败");
    fs::write(task_messages_file(&message.task_id), content).expect("写入消息文件失败");
}
