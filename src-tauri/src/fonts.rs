//! Installed font families for the "Choose a font…" dialog.

/// Families of every installed font, deduplicated and sorted. Empty on
/// mobile, where the dialog falls back to typing a name.
#[tauri::command]
pub async fn list_font_families() -> Vec<String> {
    // Scanning reads every font file's header; keep it off the main thread.
    tauri::async_runtime::spawn_blocking(scan)
        .await
        .unwrap_or_default()
}

#[cfg(desktop)]
fn scan() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    tidy_families(
        db.faces()
            .filter_map(|face| face.families.first().map(|(name, _)| name.clone())),
    )
}

#[cfg(not(desktop))]
fn scan() -> Vec<String> {
    Vec::new()
}

/// Trim, drop blanks and hidden system faces (macOS ".SF NS" and friends
/// can't be referenced by name), dedupe ignoring case, sort ignoring case.
pub fn tidy_families(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = names
        .into_iter()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty() && !n.starts_with('.'))
        .filter(|n| seen.insert(n.to_lowercase()))
        .collect();
    out.sort_by_key(|n| n.to_lowercase());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn dedupes_case_insensitively_and_sorts() {
        let got = tidy_families(names(&["Menlo", "arial", "Arial", "menlo", "Courier New"]));
        assert_eq!(got, names(&["arial", "Courier New", "Menlo"]));
    }

    #[test]
    fn drops_blank_and_hidden_system_families() {
        // macOS lists private UI faces like ".SF NS" that can't be used by name.
        let got = tidy_families(names(&[
            "",
            "  ",
            ".SF NS",
            ".AppleSystemUIFont",
            "Helvetica",
        ]));
        assert_eq!(got, names(&["Helvetica"]));
    }

    #[test]
    fn trims_names() {
        assert_eq!(
            tidy_families(names(&["  Fira Code "])),
            names(&["Fira Code"])
        );
    }
}
