pub fn theme_css(theme: &str) -> &'static str {
    match theme {
        "dark" => include_str!("../../../src/themes/dark.css"),
        "foghorn" => include_str!("../../../src/themes/foghorn.css"),
        "github" => include_str!("../../../src/themes/github.css"),
        "handwriting" => include_str!("../../../src/themes/handwriting.css"),
        "markdown" => include_str!("../../../src/themes/markdown.css"),
        "metro-vibes" => include_str!("../../../src/themes/metro-vibes.css"),
        "metro-vibes-dark" => include_str!("../../../src/themes/metro-vibes-dark.css"),
        "modern" => include_str!("../../../src/themes/modern.css"),
        "solarized-dark" => include_str!("../../../src/themes/solarized-dark.css"),
        "solarized-light" => include_str!("../../../src/themes/solarized-light.css"),
        _ => include_str!("../../../src/themes/github.css"),
    }
}
