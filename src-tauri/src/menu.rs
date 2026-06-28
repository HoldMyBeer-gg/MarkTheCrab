use crate::commands::AppState;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::menu::{
    Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

// Runtime-created windows need labels distinct from the config window ("main").
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

/// Open a fresh editor window. Each starts empty (the frontend's
/// `take_pending_open_file` returns None for all but the first launch).
pub fn new_window<R: Runtime>(app: &AppHandle<R>) {
    // Opening a window cancels any in-progress quit.
    crate::commands::QUITTING.store(false, Ordering::SeqCst);
    let n = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("main-{n}");
    if let Err(e) =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("MarkTheCrab")
            .inner_size(1308.0, 800.0)
            .min_inner_size(950.0, 400.0)
            .build()
    {
        eprintln!("failed to open new window {label}: {e}");
    }
}

/// Emit a menu-driven event to the focused window only. With multiple
/// windows open, broadcasting (`app.emit`) would, e.g., save every window
/// on a single Cmd+S. `emit_to(label, ..)` only reaches that window's
/// scoped listeners (see the frontend's per-window `listen`). Falls back to
/// a broadcast if nothing is focused.
fn emit_focused<R: Runtime, S: serde::Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    match focused_label(app) {
        Some(label) => {
            let _ = app.emit_to(label, event, payload);
        }
        None => {
            let _ = app.emit(event, payload);
        }
    }
}

/// Label of the currently focused window, if any. (`get_focused_window` is
/// behind the unstable feature, so we scan the stable window list instead.)
pub fn focused_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build(app)?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn refresh<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build(app)?;
    app.set_menu(menu)?;
    Ok(())
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let recents: Vec<String> = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        s.recent_files.clone()
    };

    let mut b = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "MarkTheCrab")
            .item(&MenuItemBuilder::with_id("help.about", "About MarkTheCrab").build(app)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
            .item(
                &MenuItemBuilder::with_id("app.quit", "Quit MarkTheCrab")
                    .accelerator("Cmd+Q")
                    .build(app)?,
            )
            .build()?;
        b = b.item(&app_menu);
    }

    b = b.item(&file_menu(app, &recents)?);
    b = b.item(&edit_menu(app)?);
    b = b.item(&insert_menu(app)?);
    b = b.item(&view_menu(app)?);
    b = b.item(&help_menu(app)?);

    b.build()
}

fn file_menu<R: Runtime>(app: &AppHandle<R>, recents: &[String]) -> tauri::Result<Submenu<R>> {
    let new_item = MenuItemBuilder::with_id("file.new", "New Window")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let new_tab_item = MenuItemBuilder::with_id("file.new_tab", "New Tab")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;
    let open_item = MenuItemBuilder::with_id("file.open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let recent_sub = recent_submenu(app, recents)?;
    let save_item = MenuItemBuilder::with_id("file.save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as_item = MenuItemBuilder::with_id("file.save_as", "Save As...")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let export_styled = MenuItemBuilder::with_id("file.export_styled", "Export HTML (styled)...")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let export_raw = MenuItemBuilder::with_id("file.export_raw", "Export HTML (raw)...")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let print_item = MenuItemBuilder::with_id("file.print", "Print / Export PDF...")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;

    #[cfg_attr(target_os = "macos", allow(unused_mut))]
    let mut sb = SubmenuBuilder::new(app, "File")
        .item(&new_item)
        .item(&new_tab_item)
        .item(&open_item)
        .item(&recent_sub)
        .separator()
        .item(&save_item)
        .item(&save_as_item)
        .separator()
        .item(&export_styled)
        .item(&export_raw)
        .item(&print_item);

    #[cfg(not(target_os = "macos"))]
    {
        sb = sb.separator().item(
            &MenuItemBuilder::with_id("app.quit", "Quit")
                .accelerator("Ctrl+Q")
                .build(app)?,
        );
    }

    sb.build()
}

fn recent_submenu<R: Runtime>(app: &AppHandle<R>, recents: &[String]) -> tauri::Result<Submenu<R>> {
    let mut sb = SubmenuBuilder::new(app, "Open Recent");
    if recents.is_empty() {
        let empty = MenuItemBuilder::with_id("file.recent.empty", "No recent files")
            .enabled(false)
            .build(app)?;
        sb = sb.item(&empty);
    } else {
        for (i, path) in recents.iter().take(20).enumerate() {
            let label = std::path::Path::new(path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let id = format!("file.recent.{i}");
            let item = MenuItemBuilder::with_id(id, label).build(app)?;
            sb = sb.item(&item);
        }
        let clear = MenuItemBuilder::with_id("file.recent.clear", "Clear Recent").build(app)?;
        sb = sb.separator().item(&clear);
    }
    sb.build()
}

fn edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Edit")
        .item(&MenuItemBuilder::with_id("edit.undo", "Undo").build(app)?)
        .item(&MenuItemBuilder::with_id("edit.redo", "Redo").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.find", "Find...")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .build()
}

fn insert_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Insert")
        .item(
            &MenuItemBuilder::with_id("insert.bold", "Bold")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("insert.italic", "Italic")
                .accelerator("CmdOrCtrl+I")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("insert.strike", "Strikethrough")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("insert.h1", "Heading 1")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("insert.h2", "Heading 2")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("insert.h3", "Heading 3")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("insert.h4", "Heading 4")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("insert.link", "Link...")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("insert.image", "Image...")
                .accelerator("CmdOrCtrl+Shift+I")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("insert.table", "Table...")
                .accelerator("CmdOrCtrl+Shift+T")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("insert.hr", "Horizontal Rule")
                .accelerator("CmdOrCtrl+H")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("insert.code", "Code Block").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("insert.ul", "Bulleted List").build(app)?)
        .item(&MenuItemBuilder::with_id("insert.ol", "Numbered List").build(app)?)
        .item(&MenuItemBuilder::with_id("insert.checklist", "Checklist").build(app)?)
        .item(&MenuItemBuilder::with_id("insert.quote", "Blockquote").build(app)?)
        .build()
}

fn view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("view.toggle_preview", "Toggle Preview")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("view.toggle_layout", "Toggle Layout").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("view.zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+Equal")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+Minus")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.zoom_reset", "Reset Zoom")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("view.settings", "Settings...")
                .accelerator("CmdOrCtrl+Comma")
                .build(app)?,
        )
        .build()
}

fn help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help.about", "About MarkTheCrab").build(app)?)
        .build()
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == "file.new" {
        new_window(app);
        return;
    }
    if let Some(rest) = id.strip_prefix("file.recent.") {
        match rest {
            "empty" => {}
            "clear" => {
                {
                    let state = app.state::<AppState>();
                    let mut s = state.settings.lock().unwrap();
                    s.recent_files.clear();
                    let _ = s.save();
                }
                let _ = refresh(app);
                emit_focused(app, "mtc:menu", "file.recent.cleared".to_string());
            }
            other => {
                if let Ok(idx) = other.parse::<usize>() {
                    let path = {
                        let state = app.state::<AppState>();
                        let s = state.settings.lock().unwrap();
                        s.recent_files.get(idx).cloned()
                    };
                    if let Some(p) = path {
                        emit_focused(app, "mtc:menu:open-recent", p);
                    }
                }
            }
        }
        return;
    }
    emit_focused(app, "mtc:menu", id.to_string());
}
