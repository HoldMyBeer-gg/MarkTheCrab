import { describe, it, expect } from "vitest";
import { scopeSelector, scopeThemeCss } from "./theme-scope.js";

describe("scopeSelector", () => {
  it("maps bare root selectors to the scope element", () => {
    for (const s of ["body", "html", ":root", ".remarkable-preview", "html body"]) {
      expect(scopeSelector(s, "#preview")).toBe("#preview");
    }
  });

  it("keeps whatever follows a root prefix", () => {
    expect(scopeSelector("html body p", "#preview")).toBe("#preview p");
    expect(scopeSelector("html a:hover", "#preview")).toBe("#preview a:hover");
    expect(scopeSelector("html *", "#preview")).toBe("#preview *");
    expect(scopeSelector("body.dark", "#preview")).toBe("#preview.dark");
  });

  it("makes everything else a descendant", () => {
    expect(scopeSelector("pre", "#preview")).toBe("#preview pre");
    expect(scopeSelector("*", "#preview")).toBe("#preview *");
  });
});

describe("scopeThemeCss", () => {
  it("applies Solarized's `html body` background to the preview", () => {
    const out = scopeThemeCss("html body {\n  background-color:#002b36\n}", "#preview");
    expect(out).toContain("#preview { ");
    expect(out).toContain("background-color:#002b36");
    expect(out).not.toContain("#preview body");
  });

  it("drops margin, padding and width from root rules so the app owns the preview layout", () => {
    const out = scopeThemeCss("body {\n  margin:40px 70px;\n  padding:30px;\n  max-width:42em;\n  color:red\n}", "#preview");
    expect(out).toContain("color:red");
    expect(out).not.toMatch(/margin|padding|max-width/);
  });

  it("keeps spacing on non-root rules", () => {
    expect(scopeThemeCss("pre { margin:0; padding:1em }", "#preview")).toMatch(/#preview pre \{.*margin:0.*padding:1em/s);
  });

  it("splits a mixed rule: root part loses spacing, the rest keeps it", () => {
    const out = scopeThemeCss("body,code { padding:1em; color:red }", "#preview");
    expect(out).toMatch(/#preview code \{[^}]*padding:1em[^}]*color:red/);
    const rootRule = out.match(/#preview \{[^}]*\}/)[0];
    expect(rootRule).toContain("color:red");
    expect(rootRule).not.toContain("padding");
  });

  it("paints the root background on the whole pane, not just the centred column", () => {
    const out = scopeThemeCss("html body { background-color:#002b36; color:#839496 }", "#preview", { paneScope: "#preview-pane" });
    const paneRule = out.match(/#preview-pane \{[^}]*\}/)[0];
    expect(paneRule).toContain("background-color:#002b36");
    expect(paneRule).not.toContain("color:#839496;");
  });

  it("doesn't split declarations on semicolons inside url()", () => {
    const out = scopeThemeCss("body { background:url(data:image/png;base64,AAAA); margin:0 }", "#preview");
    expect(out).toContain("background:url(data:image/png;base64,AAAA)");
    expect(out).not.toContain("margin");
  });

  it("leaves @media print blocks unscoped", () => {
    const out = scopeThemeCss("@media print { body { margin:0 } }\np { color:red }", "#preview");
    expect(out).toContain("@media print { body { margin:0 } }");
    expect(out).toContain("#preview p { ");
  });
});
