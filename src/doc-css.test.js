import { describe, it, expect } from "vitest";
import { splitSelectorList, scopeDocSelector, serializeScopedRules } from "./doc-css.js";

describe("splitSelectorList", () => {
  it("splits on top-level commas only", () => {
    expect(splitSelectorList("a, b ,c")).toEqual(["a", "b", "c"]);
    expect(splitSelectorList(":is(a, b) > c, d")).toEqual([":is(a, b) > c", "d"]);
    expect(splitSelectorList('[title="x, y"], e')).toEqual(['[title="x, y"]', "e"]);
  });
});

describe("scopeDocSelector", () => {
  it("puts ordinary selectors inside the preview", () => {
    expect(scopeDocSelector(".red", "#preview")).toBe("#preview .red");
    expect(scopeDocSelector("p > em", "#preview")).toBe("#preview p > em");
  });

  it("maps body/html/:root to the preview itself", () => {
    expect(scopeDocSelector("body", "#preview")).toBe("#preview");
    expect(scopeDocSelector(":root", "#preview")).toBe("#preview");
    expect(scopeDocSelector("html body p", "#preview")).toBe("#preview p");
  });

  it("refuses sibling combinators off the root, which would reach app UI next to the preview", () => {
    expect(scopeDocSelector("body ~ *", "#preview")).toBe(null);
    expect(scopeDocSelector("body + div", "#preview")).toBe(null);
    expect(scopeDocSelector("html~div", "#preview")).toBe(null);
  });
});

describe("serializeScopedRules", () => {
  const S = "#preview";

  it("scopes style rules and keeps their declarations", () => {
    const css = serializeScopedRules([{ type: "style", selector: ".red, body", declarations: "color: red;" }], S);
    expect(css).toBe("#preview .red, #preview { color: red; }");
  });

  it("drops a rule whose every selector was refused", () => {
    expect(serializeScopedRules([{ type: "style", selector: "body ~ *", declarations: "display: none;" }], S)).toBe("");
  });

  it("keeps the allowed selectors of a mixed list", () => {
    expect(serializeScopedRules([{ type: "style", selector: "body ~ *, .ok", declarations: "x: 1;" }], S))
      .toBe("#preview .ok { x: 1; }");
  });

  it("recurses into @media and @supports, dropping them if empty", () => {
    const css = serializeScopedRules([
      { type: "media", condition: "(min-width: 600px)", rules: [{ type: "style", selector: "p", declarations: "x: 1;" }] },
      { type: "supports", condition: "(display: grid)", rules: [{ type: "style", selector: "body ~ *", declarations: "y: 2;" }] },
    ], S);
    expect(css).toBe("@media (min-width: 600px) { #preview p { x: 1; } }");
  });

  it("keeps @font-face and drops everything else (@import, @keyframes, unknown)", () => {
    const css = serializeScopedRules([
      { type: "font-face", declarations: 'font-family: "Mine"; src: url(data:font/woff2;base64,AA);' },
      { type: "import" },
      { type: "keyframes" },
      { type: "other" },
    ], S);
    expect(css).toBe('@font-face { font-family: "Mine"; src: url(data:font/woff2;base64,AA); }');
  });
});
