use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,
    pub custom_css: String,
    pub font_family: String,
    pub font_size: u32,
    pub line_numbers: bool,
    pub word_wrap: bool,
    pub live_preview: bool,
    pub night_mode: bool,
    pub show_toolbar: bool,
    pub show_statusbar: bool,
    pub vertical_layout: bool,
    pub zoom_level: f64,
    pub rtl: bool,
    pub recent_files: Vec<String>,
    pub window_width: u32,
    pub window_height: u32,
    pub spellcheck: bool,
    #[serde(default = "default_true")]
    pub show_mascot: bool,
    #[serde(default = "default_true")]
    pub mascot_animations: bool,
}

fn default_true() -> bool { true }

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "github".to_string(),
            custom_css: String::new(),
            font_family: "monospace".to_string(),
            font_size: 14,
            line_numbers: true,
            word_wrap: true,
            live_preview: true,
            night_mode: false,
            show_toolbar: true,
            show_statusbar: true,
            vertical_layout: false,
            zoom_level: 1.0,
            rtl: false,
            recent_files: Vec::new(),
            window_width: 1200,
            window_height: 800,
            spellcheck: true,
            show_mascot: true,
            mascot_animations: true,
        }
    }
}

impl Settings {
    fn config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("markthecrab");
        fs::create_dir_all(&config_dir).ok();
        config_dir.join("settings.toml")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        match fs::read_to_string(&path) {
            Ok(contents) => toml::from_str(&contents).unwrap_or_default(),
            Err(_) => {
                let settings = Self::default();
                settings.save().ok();
                settings
            }
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        let contents = toml::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, contents).map_err(|e| e.to_string())
    }

    pub fn add_recent_file(&mut self, path: &str) {
        self.recent_files.retain(|p| p != path);
        self.recent_files.insert(0, path.to_string());
        self.recent_files.truncate(10);
    }
}
