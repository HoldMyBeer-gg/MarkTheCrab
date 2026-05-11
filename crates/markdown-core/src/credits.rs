pub fn credits() -> String {
    let sections: &[(&str, &str)] = &[
        ("MarkTheCrab", include_str!("../../../LICENSE")),
        (
            "Preview themes — derived from Remarkable by Jamie McGowan",
            include_str!("../third-party-licenses/Remarkable-MIT.txt"),
        ),
        (
            "OpenDyslexic font — Abbie Gonzalez (SIL Open Font License 1.1)",
            include_str!("../third-party-licenses/OpenDyslexic-OFL.txt"),
        ),
        (
            "CodeMirror — MIT",
            include_str!("../third-party-licenses/CodeMirror-MIT.txt"),
        ),
        (
            "highlight.js — BSD-3-Clause",
            include_str!("../third-party-licenses/highlight.js-BSD3.txt"),
        ),
        (
            "KaTeX — MIT",
            include_str!("../third-party-licenses/KaTeX-MIT.txt"),
        ),
        (
            "Mermaid — MIT",
            include_str!("../third-party-licenses/Mermaid-MIT.txt"),
        ),
        (
            "pulldown-cmark — MIT",
            include_str!("../third-party-licenses/pulldown-cmark.txt"),
        ),
        (
            "ammonia — MIT (dual-licensed with Apache-2.0)",
            include_str!("../third-party-licenses/ammonia-MIT.txt"),
        ),
        (
            "regex-lite — MIT (dual-licensed with Apache-2.0)",
            include_str!("../third-party-licenses/regex-lite-MIT.txt"),
        ),
        (
            "Tauri — MIT (dual-licensed with Apache-2.0)",
            include_str!("../third-party-licenses/Tauri-MIT.txt"),
        ),
    ];

    let mut out = String::new();
    out.push_str("MarkTheCrab\n");
    out.push_str(&format!("Version {}\n\n", env!("CARGO_PKG_VERSION")));
    out.push_str("This software bundles work from the projects listed below. ");
    out.push_str("Each section reproduces the upstream license verbatim.\n\n");
    for (title, body) in sections {
        out.push_str(&"=".repeat(72));
        out.push('\n');
        out.push_str(title);
        out.push('\n');
        out.push_str(&"=".repeat(72));
        out.push_str("\n\n");
        out.push_str(body.trim_end());
        out.push_str("\n\n");
    }
    out
}
