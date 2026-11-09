use crate::render::render_document;
use crate::themes::theme_css;

pub fn export_html(markdown_text: &str, styled: bool, theme: &str, custom_css: &str) -> String {
    let doc = render_document(markdown_text);
    let body = doc.html;
    // The document's own <style> blocks. An exported file is the document
    // itself, so they apply unscoped, as they would in any HTML page.
    let doc_css = style_tag(&doc.css);
    if styled {
        let css = theme_css(theme).replace(".remarkable-preview", ".markdown-preview");
        let extra_css = if custom_css.is_empty() {
            String::new()
        } else {
            style_tag(custom_css)
        };
        format!(
            r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>MarkTheCrab Export</title>
<style>{css}</style>
{extra_css}
{doc_css}
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
{doc_css}
</head>
<body>
{body}
</body>
</html>"#
        )
    }
}

/// `<style>` with `css` inside, unable to close itself early. Empty in,
/// empty out.
fn style_tag(css: &str) -> String {
    if css.trim().is_empty() {
        return String::new();
    }
    format!("<style>{}</style>", css.replace("</", "<\\/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "<style>.red { color: red }</style>\n\n<span class=\"red\">x</span>";

    #[test]
    fn styled_and_plain_exports_keep_the_documents_own_css() {
        for styled in [true, false] {
            let out = export_html(DOC, styled, "github", "");
            assert!(
                out.contains("<style>.red { color: red }</style>"),
                "styled={styled}: {out}"
            );
            assert!(
                out.contains(r#"<span class="red">x</span>"#),
                "styled={styled}: {out}"
            );
        }
    }

    #[test]
    fn document_css_cannot_close_its_style_tag() {
        let out = export_html(
            "<style>a{}</style ><style>b{content:'</style><script>x</script>'}</style>",
            false,
            "github",
            "",
        );
        assert!(!out.contains("<script>"), "{out}");
    }
}
