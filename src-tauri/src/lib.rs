mod commands;
mod models;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::create_project,
            commands::delete_project,
            commands::get_project_stats,
            commands::list_agents,
            commands::create_agent,
            commands::delete_agent,
            commands::clone_agent,
            commands::list_tasks,
            commands::create_task,
            commands::delete_task,
            commands::assign_task,
            commands::review_task,
            commands::get_agent_status,
            commands::send_task_message,
            commands::get_task_messages,
            commands::get_config,
            commands::save_config,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
