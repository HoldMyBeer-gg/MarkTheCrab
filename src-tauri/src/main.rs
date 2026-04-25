// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod markdown;
mod settings;

use commands::AppState;
use settings::Settings;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
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
            //
            // Safety valve: if the frontend never responded (JS crashed,
            // webview broken), a second close attempt forces the window
            // to close so the user isn't trapped.
            static CLOSE_PENDING: AtomicBool = AtomicBool::new(false);
            if let WindowEvent::CloseRequested { api, .. } = event {
                if CLOSE_PENDING.swap(true, Ordering::SeqCst) {
                    // Second attempt — force close
                    let _ = window.destroy();
                    return;
                }
                api.prevent_close();
                let _ = window.emit("mtc:close-requested", ());

                // Reset after 3 seconds so normal usage isn't affected
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    CLOSE_PENDING.store(false, Ordering::SeqCst);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MarkTheCrab");
}
