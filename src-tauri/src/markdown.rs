use pulldown_cmark::{CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd, html};
use std::collections::HashMap;

/// Render markdown to sanitized HTML.
///
/// Custom extensions applied as pre/post processing:
/// - ==highlight== → <mark>highlight</mark>
/// - ^superscript^ → <sup>superscript</sup>
/// - ~subscript~ → <sub>subscript</sub>
/// - [ ] / [x] → checkbox HTML
/// - [TOC] or [[_TOC_]] → nested list of document headings
pub fn render_markdown(input: &str) -> String {
    // Pre-process custom syntax before pulldown-cmark
    let processed = preprocess_custom_syntax(input);
    let line_starts = compute_line_starts(&processed);

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(&processed, options);

    // Collect events with source byte offsets for scroll-sync anchors
    let events_with_offsets: Vec<(Event, std::ops::Range<usize>)> =
        parser.into_offset_iter().collect();
    let events = inject_source_markers(events_with_offsets, &line_starts);

    let events = postprocess_autolinks(events);
    let (events, headings) = assign_heading_ids(events);
    let events = substitute_toc(events, &headings);

    let mut html_output = String::new();
    html::push_html(&mut html_output, events.into_iter());

    // Post-process HTML for custom syntax that can't be done at the event level
    let html_output = postprocess_custom_html(&html_output);

    // Sanitize with ammonia — allow safe HTML only
    sanitize_html(&html_output)
}

struct HeadingInfo {
    level: u8,
    id: String,
    text: String,
}

/// Walk events, assign a slugified `id` to every heading that doesn't
/// already carry one, and return the heading list for TOC generation.
fn assign_heading_ids<'a>(events: Vec<Event<'a>>) -> (Vec<Event<'a>>, Vec<HeadingInfo>) {
    let mut out = Vec::with_capacity(events.len());
    let mut headings = Vec::new();
    let mut slug_counts: HashMap<String, u32> = HashMap::new();

    let mut i = 0;
    while i < events.len() {
        if let Event::Start(Tag::Heading { level, id, classes, attrs }) = &events[i] {
            let level = *level;
            // Scan forward to gather plain text of the heading body
            let mut text = String::new();
            let mut j = i + 1;
            while j < events.len() {
                match &events[j] {
                    Event::End(TagEnd::Heading(_)) => break,
                    Event::Text(t) | Event::Code(t) => text.push_str(t),
                    _ => {}
                }
                j += 1;
            }
            let final_id = match id {
                Some(existing) => existing.to_string(),
                None => {
                    let base = slugify(&text);
                    let base = if base.is_empty() { "section".to_string() } else { base };
                    let count = slug_counts.entry(base.clone()).or_insert(0);
                    let unique = if *count == 0 {
                        base.clone()
                    } else {
                        format!("{}-{}", base, count)
                    };
                    *count += 1;
                    unique
                }
            };
            headings.push(HeadingInfo {
                level: heading_level_num(level),
                id: final_id.clone(),
                text,
            });
            out.push(Event::Start(Tag::Heading {
                level,
                id: Some(CowStr::Boxed(final_id.into_boxed_str())),
                classes: classes.clone(),
                attrs: attrs.clone(),
            }));
            i += 1;
            continue;
        }
        out.push(events[i].clone());
        i += 1;
    }
    (out, headings)
}

fn heading_level_num(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for c in s.chars() {
        if c.is_alphanumeric() {
            for lc in c.to_lowercase() {
                out.push(lc);
            }
            last_dash = false;
        } else if !out.is_empty() && !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Replace a paragraph whose text content is `[TOC]` (or `[[_TOC_]]`)
/// with a rendered table of contents. pulldown-cmark splits a bare
/// `[TOC]` into three text events ("[", "TOC", "]"), so we accumulate
/// all Text events between Start(Paragraph) and End(Paragraph) before
/// deciding.
fn substitute_toc<'a>(events: Vec<Event<'a>>, headings: &[HeadingInfo]) -> Vec<Event<'a>> {
    let toc_html = render_toc(headings);
    let mut out = Vec::with_capacity(events.len());
    let mut i = 0;
    while i < events.len() {
        if matches!(events[i], Event::Start(Tag::Paragraph)) {
            // Scan to matching End(Paragraph), gathering text content
            let mut j = i + 1;
            let mut text = String::new();
            let mut only_text = true;
            while j < events.len() {
                match &events[j] {
                    Event::End(TagEnd::Paragraph) => break,
                    Event::Text(t) => text.push_str(t),
                    Event::SoftBreak | Event::HardBreak => text.push(' '),
                    _ => {
                        only_text = false;
                        break;
                    }
                }
                j += 1;
            }
            if only_text && j < events.len() {
                let trimmed = text.trim();
                if trimmed == "[TOC]" || trimmed == "[[_TOC_]]" {
                    if !toc_html.is_empty() {
                        out.push(Event::Html(CowStr::Boxed(
                            toc_html.clone().into_boxed_str(),
                        )));
                    }
                    i = j + 1;
                    continue;
                }
            }
        }
        out.push(events[i].clone());
        i += 1;
    }
    out
}

struct TocNode {
    level: u8,
    id: String,
    text: String,
    children: Vec<TocNode>,
}

fn insert_toc_node(siblings: &mut Vec<TocNode>, node: TocNode) {
    if let Some(last) = siblings.last_mut() {
        if node.level > last.level {
            insert_toc_node(&mut last.children, node);
            return;
        }
    }
    siblings.push(node);
}

fn render_toc(headings: &[HeadingInfo]) -> String {
    if headings.is_empty() {
        return String::new();
    }
    let mut tree: Vec<TocNode> = Vec::new();
    for h in headings {
        insert_toc_node(
            &mut tree,
            TocNode {
                level: h.level,
                id: h.id.clone(),
                text: h.text.clone(),
                children: Vec::new(),
            },
        );
    }
    let mut html = String::from("<div class=\"toc\">");
    render_toc_nodes(&tree, &mut html);
    html.push_str("</div>");
    html
}

fn render_toc_nodes(nodes: &[TocNode], html: &mut String) {
    if nodes.is_empty() {
        return;
    }
    html.push_str("<ul>");
    for n in nodes {
        html.push_str("<li><a href=\"#");
        html.push_str(&n.id);
        html.push_str("\">");
        html.push_str(&html_escape(&n.text));
        html.push_str("</a>");
        if !n.children.is_empty() {
            render_toc_nodes(&n.children, html);
        }
        html.push_str("</li>");
    }
    html.push_str("</ul>");
}

// Emit an empty `<a class="src-line" data-src-line="N"></a>` marker before
// every top-level block event. The frontend uses these as anchors to map
// editor scroll position to the corresponding preview offset.
fn inject_source_markers<'a>(
    events_with_offsets: Vec<(Event<'a>, std::ops::Range<usize>)>,
    line_starts: &[usize],
) -> Vec<Event<'a>> {
    let mut out = Vec::with_capacity(events_with_offsets.len() * 2);
    let mut depth: i32 = 0;
    for (event, range) in events_with_offsets {
        let is_top_start = matches!(&event, Event::Start(tag) if is_top_block_start(tag)) && depth == 0;
        if is_top_start {
            let line = byte_offset_to_line(range.start, line_starts);
            let marker = format!(
                "<a class=\"src-line\" data-src-line=\"{}\"></a>",
                line
            );
            out.push(Event::Html(CowStr::Boxed(marker.into_boxed_str())));
        }
        if let Event::Start(tag) = &event {
            if is_top_block_start(tag) {
                depth += 1;
            }
        } else if let Event::End(tag_end) = &event {
            if is_top_block_end(tag_end) {
                depth -= 1;
            }
        }
        out.push(event);
    }
    out
}

fn is_top_block_start(tag: &Tag) -> bool {
    matches!(
        tag,
        Tag::Paragraph
            | Tag::Heading { .. }
            | Tag::BlockQuote(_)
            | Tag::CodeBlock(_)
            | Tag::List(_)
            | Tag::Table(_)
            | Tag::HtmlBlock
            | Tag::FootnoteDefinition(_)
    )
}

fn is_top_block_end(tag: &TagEnd) -> bool {
    matches!(
        tag,
        TagEnd::Paragraph
            | TagEnd::Heading(_)
            | TagEnd::BlockQuote(_)
            | TagEnd::CodeBlock
            | TagEnd::List(_)
            | TagEnd::Table
            | TagEnd::HtmlBlock
            | TagEnd::FootnoteDefinition
    )
}

fn compute_line_starts(input: &str) -> Vec<usize> {
    let mut starts = Vec::with_capacity(input.len() / 24 + 1);
    starts.push(0);
    for (i, b) in input.bytes().enumerate() {
        if b == b'\n' {
            starts.push(i + 1);
        }
    }
    starts
}

fn byte_offset_to_line(offset: usize, line_starts: &[usize]) -> usize {
    match line_starts.binary_search(&offset) {
        Ok(i) => i,
        Err(i) => i.saturating_sub(1),
    }
}

fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
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
        .add_tag_attributes("a", &["href", "title", "target", "class", "data-src-line"])
        .add_tag_attributes("h1", &["id"])
        .add_tag_attributes("h2", &["id"])
        .add_tag_attributes("h3", &["id"])
        .add_tag_attributes("h4", &["id"])
        .add_tag_attributes("h5", &["id"])
        .add_tag_attributes("h6", &["id"])
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
        assert!(result.contains("<h1 id=\"hello\">Hello</h1>"));
        assert!(result.contains("<strong>bold</strong>"));
        assert!(result.contains("<em>italic</em>"));
    }

    #[test]
    fn test_heading_ids_are_unique() {
        let result = render_markdown("# Intro\n\n## Intro\n\n## Intro");
        assert!(result.contains("id=\"intro\""));
        assert!(result.contains("id=\"intro-1\""));
        assert!(result.contains("id=\"intro-2\""));
    }

    #[test]
    fn test_toc_placeholder() {
        let md = "[TOC]\n\n# One\n\n## Sub\n\n# Two";
        let result = render_markdown(md);
        assert!(result.contains("<div class=\"toc\">"));
        assert!(result.contains("href=\"#one\""));
        assert!(result.contains("href=\"#sub\""));
        assert!(result.contains("href=\"#two\""));
        // Sub should be nested inside One's <li>
        let one_idx = result.find("href=\"#one\"").unwrap();
        let sub_idx = result.find("href=\"#sub\"").unwrap();
        let two_idx = result.find("href=\"#two\"").unwrap();
        assert!(one_idx < sub_idx && sub_idx < two_idx);
    }

    #[test]
    fn test_slugify_handles_punctuation() {
        let result = render_markdown("## Hello, World!");
        assert!(result.contains("id=\"hello-world\""));
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

    #[test]
    fn test_source_line_markers() {
        let md = "# Top\n\nSecond para.\n\n> A quote";
        let result = render_markdown(md);
        eprintln!("result: {}", result);
        assert!(result.contains("data-src-line=\"0\""));
        assert!(result.contains("data-src-line=\"2\""));
        assert!(result.contains("data-src-line=\"4\""));
    }
}
