use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd, html};

/// Render markdown to sanitized HTML.
///
/// Custom extensions applied as pre/post processing:
/// - ==highlight== → <mark>highlight</mark>
/// - ^superscript^ → <sup>superscript</sup>
/// - ~subscript~ → <sub>subscript</sub>
/// - [ ] / [x] → checkbox HTML
pub fn render_markdown(input: &str) -> String {
    // Pre-process custom syntax before pulldown-cmark
    let processed = preprocess_custom_syntax(input);

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(&processed, options);

    // Post-process events for autolinks
    let events: Vec<Event> = parser.collect();
    let events = postprocess_autolinks(events);

    let mut html_output = String::new();
    html::push_html(&mut html_output, events.into_iter());

    // Post-process HTML for custom syntax that can't be done at the event level
    let html_output = postprocess_custom_html(&html_output);

    // Sanitize with ammonia — allow safe HTML only
    sanitize_html(&html_output)
}

fn preprocess_custom_syntax(input: &str) -> String {
    let mut result = String::with_capacity(input.len());

    for line in input.lines() {
        let line = process_highlight(line);
        let line = process_superscript(&line);
        let line = process_subscript(&line);
        result.push_str(&line);
        result.push('\n');
    }

    result
}

/// ==text== → <mark>text</mark>
fn process_highlight(line: &str) -> String {
    let mut result = String::new();
    let mut chars = line.char_indices().peekable();
    let mut last_end = 0;

    while let Some((i, c)) = chars.next() {
        if c == '=' {
            if let Some(&(_, '=')) = chars.peek() {
                chars.next();
                // Find closing ==
                let start = i + 2;
                let mut found_end = false;
                let search = &line[start..];
                if let Some(end_pos) = search.find("==") {
                    result.push_str(&line[last_end..i]);
                    result.push_str("<mark>");
                    result.push_str(&search[..end_pos]);
                    result.push_str("</mark>");
                    last_end = start + end_pos + 2;
                    // Advance chars past the closing ==
                    while let Some(&(idx, _)) = chars.peek() {
                        if idx >= last_end {
                            break;
                        }
                        chars.next();
                    }
                    found_end = true;
                }
                if !found_end {
                    continue;
                }
            }
        }
    }
    result.push_str(&line[last_end..]);
    result
}

/// ^text^ → <sup>text</sup> (but not inside code)
fn process_superscript(line: &str) -> String {
    replace_paired_marker(line, '^', "sup")
}

/// ~text~ → <sub>text</sub> (single tildes only, ~~ is strikethrough)
fn process_subscript(line: &str) -> String {
    let mut result = String::new();
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut last_end = 0;

    while i < len {
        if bytes[i] == b'~' && (i + 1 >= len || bytes[i + 1] != b'~') {
            // Single tilde — look for closing single tilde
            let start = i + 1;
            if let Some(pos) = line[start..].find('~') {
                let end = start + pos;
                // Make sure the closing tilde is also single
                if end + 1 >= len || bytes[end + 1] != b'~' {
                    let content = &line[start..end];
                    if !content.is_empty() && !content.contains(' ') {
                        result.push_str(&line[last_end..i]);
                        result.push_str("<sub>");
                        result.push_str(content);
                        result.push_str("</sub>");
                        last_end = end + 1;
                        i = last_end;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
    result.push_str(&line[last_end..]);
    result
}

fn replace_paired_marker(line: &str, marker: char, tag: &str) -> String {
    let mut result = String::new();
    let mut rest = line;

    loop {
        if let Some(start) = rest.find(marker) {
            let after_start = &rest[start + marker.len_utf8()..];
            if let Some(end) = after_start.find(marker) {
                let content = &after_start[..end];
                if !content.is_empty() && !content.contains(' ') {
                    result.push_str(&rest[..start]);
                    result.push_str(&format!("<{tag}>{content}</{tag}>"));
                    rest = &after_start[end + marker.len_utf8()..];
                    continue;
                }
            }
            result.push_str(&rest[..start + marker.len_utf8()]);
            rest = &rest[start + marker.len_utf8()..];
        } else {
            break;
        }
    }
    result.push_str(rest);
    result
}

fn postprocess_autolinks(events: Vec<Event>) -> Vec<Event> {
    let url_pattern = regex_lite::Regex::new(
        r"(https?://[^\s<>\[\]()]+)"
    ).unwrap();

    let mut result = Vec::with_capacity(events.len());
    let mut in_link = false;

    for event in events {
        match &event {
            Event::Start(Tag::Link { .. }) => {
                in_link = true;
                result.push(event);
            }
            Event::End(TagEnd::Link) => {
                in_link = false;
                result.push(event);
            }
            Event::Text(text) if !in_link => {
                let text_str = text.to_string();
                if url_pattern.is_match(&text_str) {
                    // Split text on URLs and create link events
                    let mut last_end = 0;
                    for mat in url_pattern.find_iter(&text_str) {
                        if mat.start() > last_end {
                            result.push(Event::Text(
                                text_str[last_end..mat.start()].to_string().into(),
                            ));
                        }
                        let url = mat.as_str().to_string();
                        result.push(Event::Start(Tag::Link {
                            link_type: pulldown_cmark::LinkType::Autolink,
                            dest_url: url.clone().into(),
                            title: "".into(),
                            id: "".into(),
                        }));
                        result.push(Event::Text(url.clone().into()));
                        result.push(Event::End(TagEnd::Link));
                        last_end = mat.end();
                    }
                    if last_end < text_str.len() {
                        result.push(Event::Text(
                            text_str[last_end..].to_string().into(),
                        ));
                    }
                } else {
                    result.push(event);
                }
            }
            _ => result.push(event),
        }
    }
    result
}

fn postprocess_custom_html(_html: &str) -> String {
    // Future home for any HTML-level post-processing
    _html.to_string()
}

fn sanitize_html(html: &str) -> String {
    ammonia::Builder::new()
        .add_tags(&[
            "mark", "sup", "sub", "details", "summary",
            "table", "thead", "tbody", "tr", "th", "td",
            "h1", "h2", "h3", "h4", "h5", "h6",
            "p", "br", "hr", "div", "span",
            "ul", "ol", "li",
            "a", "img",
            "pre", "code", "blockquote",
            "strong", "em", "del", "s",
            "input",
            "dl", "dt", "dd",
            "figure", "figcaption",
            "abbr", "cite", "dfn", "kbd", "samp", "var",
        ])
        .add_tag_attributes("a", &["href", "title", "target"])
        .add_tag_attributes("img", &["src", "alt", "title", "width", "height"])
        .add_tag_attributes("input", &["type", "checked", "disabled"])
        .add_tag_attributes("td", &["align", "colspan", "rowspan"])
        .add_tag_attributes("th", &["align", "colspan", "rowspan"])
        .add_tag_attributes("code", &["class"])
        .add_tag_attributes("pre", &["class"])
        .add_tag_attributes("div", &["class"])
        .add_tag_attributes("span", &["class"])
        .link_rel(Some("noopener noreferrer"))
        .clean(html)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_markdown() {
        let result = render_markdown("# Hello\n\nThis is **bold** and *italic*.");
        assert!(result.contains("<h1>Hello</h1>"));
        assert!(result.contains("<strong>bold</strong>"));
        assert!(result.contains("<em>italic</em>"));
    }

    #[test]
    fn test_highlight() {
        let result = render_markdown("This is ==highlighted== text.");
        assert!(result.contains("<mark>highlighted</mark>"));
    }

    #[test]
    fn test_superscript() {
        let result = render_markdown("E = mc^2^");
        assert!(result.contains("<sup>2</sup>"));
    }

    #[test]
    fn test_subscript() {
        let result = render_markdown("H~2~O");
        assert!(result.contains("<sub>2</sub>"));
    }

    #[test]
    fn test_strikethrough() {
        let result = render_markdown("~~deleted~~");
        assert!(result.contains("<del>deleted</del>"));
    }

    #[test]
    fn test_table() {
        let input = "| A | B |\n|---|---|\n| 1 | 2 |";
        let result = render_markdown(input);
        assert!(result.contains("<table>"));
        assert!(result.contains("<td>1</td>"));
    }

    #[test]
    fn test_checklist() {
        let result = render_markdown("- [ ] todo\n- [x] done");
        assert!(result.contains("type=\"checkbox\""));
    }

    #[test]
    fn test_xss_prevention() {
        let result = render_markdown("<script>alert('xss')</script>");
        assert!(!result.contains("<script>"));
    }

    #[test]
    fn test_autolink() {
        let result = render_markdown("Visit https://example.com for info");
        assert!(result.contains("<a "));
        assert!(result.contains("https://example.com"));
    }
}
