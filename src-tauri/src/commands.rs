use crate::menu;
use crate::settings::Settings;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub current_file: Mutex<Option<String>>,
}

#[tauri::command]
pub fn render_markdown(text: &str) -> String {
    markdown_core::render_markdown(text)
}

#[tauri::command]
pub fn get_credits() -> String {
    markdown_core::credits()
}

#[tauri::command]
pub fn load_settings(state: State<AppState>) -> Settings {
    let settings = state.settings.lock().unwrap();
    settings.clone()
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    let mut current = state.settings.lock().unwrap();
    *current = settings;
    current.save()
}

#[tauri::command]
pub fn update_setting(state: State<AppState>, key: &str, value: &str) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    match key {
        "theme" => settings.theme = value.to_string(),
        "custom_css" => settings.custom_css = value.to_string(),
        "font_family" => settings.font_family = value.to_string(),
        "font_size" => {
            settings.font_size = value
                .parse()
                .map_err(|e: std::num::ParseIntError| e.to_string())?
        }
        "line_numbers" => settings.line_numbers = value == "true",
        "word_wrap" => settings.word_wrap = value == "true",
        "live_preview" => settings.live_preview = value == "true",
        "night_mode" => settings.night_mode = value == "true",
        "show_toolbar" => settings.show_toolbar = value == "true",
        "show_statusbar" => settings.show_statusbar = value == "true",
        "vertical_layout" => settings.vertical_layout = value == "true",
        "zoom_level" => {
            settings.zoom_level = value
                .parse()
                .map_err(|e: std::num::ParseFloatError| e.to_string())?
        }
        "rtl" => settings.rtl = value == "true",
        "spellcheck" => settings.spellcheck = value == "true",
        "show_mascot" => settings.show_mascot = value == "true",
        "mascot_animations" => settings.mascot_animations = value == "true",
        _ => return Err(format!("Unknown setting: {key}")),
    }
    settings.save()
}

#[tauri::command]
pub fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    fs::write(path, trim_trailing_whitespace(content)).map_err(|e| e.to_string())
}

fn mtime_ms(meta: &std::fs::Metadata) -> Result<u64, String> {
    meta.modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())
        .map(|d| d.as_millis() as u64)
}

#[tauri::command]
pub fn read_file_with_mtime(path: &str) -> Result<(String, u64), String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok((content, mtime_ms(&meta)?))
}

#[tauri::command]
pub fn write_file_with_mtime(path: &str, content: &str) -> Result<u64, String> {
    fs::write(path, trim_trailing_whitespace(content)).map_err(|e| e.to_string())?;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    mtime_ms(&meta)
}

fn trim_trailing_whitespace(content: &str) -> String {
    let mut out = content
        .lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    if content.ends_with('\n') {
        out.push('\n');
    }
    out
}

// Returns the current mtime for a path, or None if the file no longer
// exists (e.g. moved or deleted externally while open).
#[tauri::command]
pub fn stat_mtime(path: &str) -> Result<Option<u64>, String> {
    match fs::metadata(path) {
        Ok(meta) => Ok(Some(mtime_ms(&meta)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn confirm_close(window: tauri::Window) {
    let _ = window.destroy();
}

#[tauri::command]
pub fn refresh_recent_menu(app: AppHandle) -> Result<(), String> {
    menu::refresh(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_current_file(state: State<AppState>, path: Option<String>) {
    let mut current = state.current_file.lock().unwrap();
    *current = path.clone();
    if let Some(ref p) = path {
        let mut settings = state.settings.lock().unwrap();
        settings.add_recent_file(p);
        settings.save().ok();
    }
}

#[tauri::command]
pub fn get_current_file(state: State<AppState>) -> Option<String> {
    state.current_file.lock().unwrap().clone()
}

#[tauri::command]
pub fn export_html(markdown_text: &str, styled: bool, theme: &str, custom_css: &str) -> String {
    markdown_core::export_html(markdown_text, styled, theme, custom_css)
}

/// Save image bytes to an `images/` directory next to the current markdown file.
/// Returns the relative path suitable for embedding in markdown.
#[tauri::command]
pub fn save_image(
    state: State<AppState>,
    image_data: Vec<u8>,
    filename: String,
) -> Result<String, String> {
    let current = state.current_file.lock().unwrap();
    let base_dir = match current.as_deref() {
        Some(path) => Path::new(path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from(".")),
        None => dirs::document_dir().unwrap_or_else(|| PathBuf::from(".")),
    };

    let images_dir = base_dir.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    // Avoid overwriting: append a number if file exists
    let mut dest = images_dir.join(&filename);
    if dest.exists() {
        let stem = Path::new(&filename)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let ext = Path::new(&filename)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let mut n = 1u32;
        loop {
            dest = images_dir.join(format!("{stem}_{n}{ext}"));
            if !dest.exists() {
                break;
            }
            n += 1;
        }
    }

    fs::write(&dest, &image_data).map_err(|e| e.to_string())?;

    // Return relative path from the markdown file's directory
    let relative = format!("images/{}", dest.file_name().unwrap().to_string_lossy());
    Ok(relative)
}
