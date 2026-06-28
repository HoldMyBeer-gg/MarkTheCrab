mod commands;
#[cfg(desktop)]
mod menu;
mod settings;

use commands::AppState;
use settings::Settings;
use std::sync::Mutex;

#[cfg(desktop)]
use std::collections::HashSet;
#[cfg(desktop)]
use std::path::PathBuf;
#[cfg(desktop)]
use std::sync::OnceLock;
#[cfg(desktop)]
use std::sync::atomic::Ordering;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
#[cfg(desktop)]
use tauri::{Emitter, Manager, WindowEvent};

#[cfg(desktop)]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = Settings::load();

    // CLI / Finder file-open is a desktop notion; mobile launches with none.
    #[cfg(desktop)]
    let cli_open = file_from_cli_args();
    #[cfg(not(desktop))]
    let cli_open: Option<String> = None;

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            settings: Mutex::new(settings),
            current_file: Mutex::new(std::collections::HashMap::new()),
            pending_open_file: Mutex::new(cli_open),
        })
        .invoke_handler(tauri::generate_handler![
            commands::render_markdown,
            commands::platform,
            commands::documents_dir,
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
            commands::new_window,
            commands::refresh_recent_menu,
            commands::take_pending_open_file,
        ]);

    // Native menus and window-close interception exist only on desktop
    // (Windows, Linux, macOS). Mobile has neither, so this whole block is
    // compiled out for iOS/Android and the desktop targets are unchanged.
    #[cfg(desktop)]
    {
        builder = builder
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
                // to close so the user isn't trapped. Tracked per-window
                // label so closing one window can't force-close another.
                static CLOSE_PENDING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let label = window.label().to_string();
                    let pending = CLOSE_PENDING.get_or_init(|| Mutex::new(HashSet::new()));
                    let first_attempt = pending.lock().unwrap().insert(label.clone());
                    if !first_attempt {
                        // Second attempt — force close
                        let _ = window.destroy();
                        return;
                    }
                    api.prevent_close();
                    // Scoped to this window so other windows don't also prompt.
                    let _ = window.emit_to(window.label(), "mtc:close-requested", ());

                    // Reset after 3 seconds so normal usage isn't affected
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        if let Some(p) = CLOSE_PENDING.get() {
                            p.lock().unwrap().remove(&label);
                        }
                    });
                } else if let WindowEvent::Destroyed = event {
                    // During a Cmd+Q quit, exit once the final window is gone.
                    // (Closing the last window otherwise leaves the app running,
                    // matching the prior single-window macOS behavior.)
                    if commands::QUITTING.load(Ordering::SeqCst) {
                        let app = window.app_handle();
                        let others_remain =
                            app.webview_windows().keys().any(|l| l != window.label());
                        if !others_remain {
                            app.exit(0);
                        }
                    }
                }
            });
    }

    let app = builder
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
                    // Load into the focused window if one is up; otherwise the
                    // stash above feeds the first window via take_pending_open_file.
                    if let Some(label) = menu::focused_label(app) {
                        let _ = app.emit_to(label, "mtc:open-path", path);
                    } else {
                        let _ = app.emit("mtc:open-path", path);
                    }
                }
            }
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}
