use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = renderMarkdown)]
pub fn render_markdown(text: &str) -> String {
    markdown_core::render_markdown(text)
}

/// HTML plus the CSS from the document's own `<style>` blocks.
#[wasm_bindgen]
pub struct RenderedDocument {
    html: String,
    css: String,
}

#[wasm_bindgen]
impl RenderedDocument {
    #[wasm_bindgen(getter)]
    pub fn html(&self) -> String {
        self.html.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn css(&self) -> String {
        self.css.clone()
    }
}

#[wasm_bindgen(js_name = renderDocument)]
pub fn render_document(text: &str) -> RenderedDocument {
    let doc = markdown_core::render_document(text);
    RenderedDocument {
        html: doc.html,
        css: doc.css,
    }
}

#[wasm_bindgen(js_name = exportHtml)]
pub fn export_html(text: &str, styled: bool, theme: &str, custom_css: &str) -> String {
    markdown_core::export_html(text, styled, theme, custom_css)
}

#[wasm_bindgen(js_name = getCredits)]
pub fn credits() -> String {
    markdown_core::credits()
}
