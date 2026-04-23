// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod markdown;
mod settings;

use commands::AppState;
use settings::Settings;
use std::sync::Mutex;

fn main() {
    let settings = Settings::load();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            settings: Mutex::new(settings),
            current_file: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::render_markdown,
            commands::load_settings,
            commands::save_settings,
            commands::update_setting,
            commands::read_file,
            commands::write_file,
            commands::set_current_file,
            commands::get_current_file,
            commands::export_html,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Remarkable");
}
