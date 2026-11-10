use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// `default` on the struct: a settings file missing fields (written by an
// older version, or hand-edited) keeps every value it has and fills the rest
// from Settings::default(). Without it, one missing key failed the whole
// parse and load() silently reset the user's settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: String,
    pub custom_css: String,
    pub font_family: String,
    /// Preview pane font: "" (the theme's own), "OpenDyslexic" or
    /// "system:<Family>". Older settings files don't have it.
    #[serde(default)]
    pub preview_font: String,
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
    pub emoji: bool,
    #[serde(default = "default_true")]
    pub show_mascot: bool,
    #[serde(default = "default_true")]
    pub mascot_animations: bool,
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "github".to_string(),
            custom_css: String::new(),
            font_family: "monospace".to_string(),
            preview_font: String::new(),
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
            emoji: true,
            show_mascot: true,
            mascot_animations: true,
        }
    }
}

/// Where settings live: `MARKTHECRAB_CONFIG_DIR` if set (isolated test runs
/// on any OS, so automation never touches the user's real settings),
/// otherwise `<platform config dir>/markthecrab`.
fn config_dir_from(override_dir: Option<String>, platform_dir: Option<PathBuf>) -> PathBuf {
    match override_dir {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => platform_dir
            .unwrap_or_else(|| PathBuf::from("."))
            .join("markthecrab"),
    }
}

impl Settings {
    fn config_path() -> PathBuf {
        let config_dir = config_dir_from(
            std::env::var("MARKTHECRAB_CONFIG_DIR").ok(),
            dirs::config_dir(),
        );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_from_before_preview_font_still_load() {
        // A settings.toml written by v0.2.10: no preview_font key.
        let mut old = toml::to_string(&Settings::default()).unwrap();
        old = old
            .lines()
            .filter(|l| !l.starts_with("preview_font"))
            .collect::<Vec<_>>()
            .join("\n");
        let s: Settings = toml::from_str(&old).unwrap();
        assert_eq!(s.preview_font, "");
    }

    #[test]
    fn a_settings_file_missing_fields_keeps_the_values_it_has() {
        // Before: any missing key failed the parse and load() silently fell
        // back to defaults, wiping the user's settings on upgrade.
        let partial = "theme = \"dark\"\nrecent_files = [\"/notes/a.md\"]\n";
        let s: Settings = toml::from_str(partial).expect("partial file must parse");
        assert_eq!(s.theme, "dark");
        assert_eq!(s.recent_files, vec!["/notes/a.md".to_string()]);
        assert_eq!(s.font_size, Settings::default().font_size);
        assert!(s.line_numbers);
    }

    #[test]
    fn config_dir_can_be_overridden_for_isolated_runs() {
        let base = Some(PathBuf::from("/home/u/.config"));
        assert_eq!(
            config_dir_from(None, base.clone()),
            PathBuf::from("/home/u/.config/markthecrab")
        );
        assert_eq!(
            config_dir_from(Some("/tmp/bam-run".into()), base.clone()),
            PathBuf::from("/tmp/bam-run")
        );
        assert_eq!(
            config_dir_from(Some(String::new()), base),
            PathBuf::from("/home/u/.config/markthecrab")
        );
    }
}
