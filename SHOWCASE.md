I used Remarkable for years. The features people kept asking for never landed, the repo went quiet, and I finally got tired of waiting. So I built a replacement: [MarkTheCrab](https://github.com/HoldMyBeer-gg/MarkTheCrab).

It's a cross-platform markdown editor built on Tauri + Rust + CodeMirror 6. The crab mascot is named Mark. He bounces when you click him.

Things it does that Remarkable never got around to:

- KaTeX math inline and display ($E = mc^2$, $$...$$ and fenced blocks)
- Mermaid diagrams in \`\`\`mermaid fences
- Source-map-based scroll sync, not the crude viewport-ratio approach
- PDF export via system print dialog, clean and chrome-free
- 10 themes scoped to the preview pane only
- Recent files, custom CSS, syntax highlighting for 24 languages


MIT licensed. Quickstart is short if you already have Rust and Node:

```bash
git clone https://github.com/HoldMyBeer-gg/MarkTheCrab
pnpm install && pnpm tauri dev
```
Still early days but the core feature set is solid. Happy to answer questions via github issues!
