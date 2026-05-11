use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = renderMarkdown)]
pub fn render_markdown(text: &str) -> String {
    markdown_core::render_markdown(text)
}

#[wasm_bindgen(js_name = exportHtml)]
pub fn export_html(text: &str, styled: bool, theme: &str, custom_css: &str) -> String {
    markdown_core::export_html(text, styled, theme, custom_css)
}

#[wasm_bindgen(js_name = getCredits)]
pub fn credits() -> String {
    markdown_core::credits()
}
