// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod markdown;
mod settings;

use commands::AppState;
use settings::Settings;
use std::sync::Mutex;
use tauri::{Emitter, WindowEvent};

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
            commands::save_image,
            commands::read_file_with_mtime,
            commands::stat_mtime,
            commands::write_file_with_mtime,
            commands::get_credits,
            commands::confirm_close,
        ])
        .on_window_event(|window, event| {
            // Intercept close; let the frontend decide whether to proceed
            // based on unsaved state. The frontend calls `confirm_close`
            // to actually destroy the window.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("mtc:close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MarkTheCrab");
}
