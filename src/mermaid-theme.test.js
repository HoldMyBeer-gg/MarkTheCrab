import { describe, it, expect } from "vitest";
import { isDarkColor, mermaidThemeFor } from "./mermaid-theme.js";

describe("isDarkColor", () => {
  it("reads rgb() and rgba() as computed styles report them", () => {
    expect(isDarkColor("rgb(0, 0, 0)")).toBe(true);
    expect(isDarkColor("rgb(255, 255, 255)")).toBe(false);
    expect(isDarkColor("rgb(0, 43, 54)")).toBe(true); // Solarized Dark
    expect(isDarkColor("rgb(253, 246, 227)")).toBe(false); // Solarized Light
    expect(isDarkColor("rgb(92, 81, 70)")).toBe(true); // Metro Vibes Dark
  });

  it("treats transparent or unreadable colours as not dark", () => {
    expect(isDarkColor("rgba(0, 0, 0, 0)")).toBe(false);
    expect(isDarkColor("transparent")).toBe(false);
    expect(isDarkColor("")).toBe(false);
  });
});

describe("mermaidThemeFor", () => {
  it("uses the first opaque background, preview before pane", () => {
    expect(mermaidThemeFor(["rgba(0, 0, 0, 0)", "rgb(0, 0, 0)"])).toBe("dark");
    expect(mermaidThemeFor(["rgb(255, 255, 255)", "rgb(0, 0, 0)"])).toBe("default");
    expect(mermaidThemeFor(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"])).toBe("default");
  });
});
