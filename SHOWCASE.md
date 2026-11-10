# MarkTheCrab 🦀

<style>
:root { background: #fcfbf7; }
.note {
  border-left: 4px solid #0969da;
  background: #ddf4ff;
  padding: 0.4rem 0.9rem;
  border-radius: 0 6px 6px 0;
  margin: 0.7rem 0;
}
.note strong { color: #0550ae; }
</style>

*A markdown editor that keeps up with your typing. Built in Rust.* ✨

<div class="note">

**This preview is styled by the document itself** — the `<style>` block
scopes to the preview pane, so your paper stays your paper.

</div>

$$
\nabla \times \mathbf{B} \;=\; \mu_0\mathbf{J} + \mu_0\varepsilon_0\frac{\partial \mathbf{E}}{\partial t}
$$

- [x] Live preview — rendered as you type, with source-map scroll sync
- [x] KaTeX math — inline $E = mc^2$ and display blocks
- [x] Mermaid diagrams — flowcharts, sequence, Gantt, more
- [x] Tabs — open as many docs as you like, dirty-state tracked
- [x] Custom preview font, scoped `<style>`, in-app emoji picker
- [x] PDF export — `Ctrl+P` → *Save as PDF*, theme-aware

```mermaid
sequenceDiagram
  You->>Mark: types markdown
  Mark->>Preview: renders live
  Preview-->>You: live result
```
