use crate::render::render_markdown;
use crate::themes::theme_css;

pub fn export_html(markdown_text: &str, styled: bool, theme: &str, custom_css: &str) -> String {
    let body = render_markdown(markdown_text);
    if styled {
        let css = theme_css(theme).replace(".remarkable-preview", ".markdown-preview");
        let extra_css = if custom_css.is_empty() {
            String::new()
        } else {
            let safe = custom_css.replace("</", "<\\/");
            format!("<style>{safe}</style>")
        };
        format!(
            r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>MarkTheCrab Export</title>
<style>{css}</style>
{extra_css}
</head>
<body class="markdown-preview">
{body}
</body>
</html>"#
        )
    } else {
        format!(
            r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>MarkTheCrab Export</title>
</head>
<body>
{body}
</body>
</html>"#
        )
    }
}
