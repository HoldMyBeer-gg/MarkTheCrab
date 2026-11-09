//! SteamOS gaming mode runs apps inside gamescope, which draws no window
//! chrome: a window that opens at its default size can't be maximized by
//! hand. Detect it so windows can fill the screen themselves.

/// Whether we're running inside gamescope (SteamOS gaming mode, or gamescope
/// nested on a desktop). `env` reads an environment variable.
pub fn under_gamescope(env: impl Fn(&str) -> Option<String>) -> bool {
    let desktop = env("XDG_CURRENT_DESKTOP").unwrap_or_default();
    desktop
        .split(':')
        .any(|d| d.eq_ignore_ascii_case("gamescope"))
        || env("GAMESCOPE_WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty())
}

/// Under gamescope, make `window` fill the screen: there's no window chrome
/// to maximize it with, and gamescope gives the app the whole display.
#[cfg(desktop)]
pub fn fit_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    if !under_gamescope(|k| std::env::var(k).ok()) {
        return;
    }
    if let Err(e) = window.set_fullscreen(true) {
        eprintln!("gamescope: fullscreen failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| map.get(k).cloned()
    }

    #[test]
    fn steam_deck_gaming_mode_is_detected() {
        // Captured from a Steam Deck launching MarkTheCrab in gaming mode.
        assert!(under_gamescope(env(&[
            ("XDG_CURRENT_DESKTOP", "gamescope"),
            ("GAMESCOPE_WAYLAND_DISPLAY", "gamescope-0"),
            ("SteamDeck", "1"),
        ])));
    }

    #[test]
    fn either_signal_is_enough() {
        assert!(under_gamescope(env(&[(
            "XDG_CURRENT_DESKTOP",
            "gamescope"
        )])));
        assert!(under_gamescope(env(&[(
            "GAMESCOPE_WAYLAND_DISPLAY",
            "gamescope-0"
        )])));
    }

    #[test]
    fn desktop_mode_and_other_desktops_are_not() {
        // Deck desktop mode is Plasma; SteamDeck=1 alone doesn't mean gamescope.
        assert!(!under_gamescope(env(&[
            ("XDG_CURRENT_DESKTOP", "KDE"),
            ("SteamDeck", "1")
        ])));
        assert!(!under_gamescope(env(&[("XDG_CURRENT_DESKTOP", "GNOME")])));
        assert!(!under_gamescope(env(&[("GAMESCOPE_WAYLAND_DISPLAY", "")])));
        assert!(!under_gamescope(env(&[])));
    }
}
