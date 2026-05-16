// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;
mod settings;

use commands::AppState;
use settings::Settings;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, WindowEvent};
#[cfg(target_os = "macos")]
use tauri::{Manager, RunEvent};

fn file_from_cli_args() -> Option<String> {
    std::env::args().skip(1).find_map(|arg| {
        if arg.starts_with('-') {
            return None;
        }
        let p = PathBuf::from(&arg);
        if p.is_file() {
            // Canonicalize so relative paths from the shell resolve correctly.
            match p.canonicalize() {
                Ok(abs) => Some(abs.to_string_lossy().into_owned()),
                Err(_) => Some(arg),
            }
        } else {
            None
        }
    })
}

#[cfg(target_os = "macos")]
fn url_to_path(url: &tauri::Url) -> Option<String> {
    if url.scheme() == "file" {
        url.to_file_path()
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn main() {
    let settings = Settings::load();
    let cli_open = file_from_cli_args();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            settings: Mutex::new(settings),
            current_file: Mutex::new(None),
            pending_open_file: Mutex::new(cli_open),
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
            commands::quit_app,
            commands::refresh_recent_menu,
            commands::take_pending_open_file,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            menu::install(&handle)?;
            app.on_menu_event(move |app, event| {
                menu::handle_event(app, event.id().as_ref());
            });
            Ok(())
        })
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
        .build(tauri::generate_context!())
        .expect("error while building MarkTheCrab");

    #[cfg(target_os = "macos")]
    app.run(|app, event| {
        if let RunEvent::Opened { urls } = event {
            // macOS routes Finder double-clicks (and `open file.md`) here.
            // If the webview isn't ready yet, stash the path so the
            // frontend can pull it via take_pending_open_file on init.
            // Once it's up, emit so an already-running instance loads it.
            for url in urls {
                if let Some(path) = url_to_path(&url) {
                    let state = app.state::<AppState>();
                    let mut pending = state.pending_open_file.lock().unwrap();
                    *pending = Some(path.clone());
                    drop(pending);
                    let _ = app.emit("mtc:open-path", path);
                }
            }
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}
