// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! Vela Desktop library — module declarations and Tauri app builder.

pub mod agent;
pub mod commands;
pub mod file;
pub mod settings;
pub mod storage;

use log::info;

/// Build and run the Tauri application.
pub fn run() {
    env_logger::init();
    info!("Starting Vela Desktop");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Start agent discovery in background
            tauri::async_runtime::spawn(async move {
                agent::discovery::run_discovery_loop(app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Storage commands
            commands::storage_get,
            commands::storage_set,
            commands::storage_delete,
            // File commands
            commands::open_deck,
            commands::save_deck,
            commands::recent_files,
            commands::open_file_dialog,
            commands::save_file_dialog,
            // Settings commands
            commands::get_settings,
            commands::update_settings,
            // Agent commands
            commands::get_agents,
            commands::set_active_agent,
            commands::agent_complete,
            commands::agent_health,
            commands::test_agent_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vela Desktop");
}
