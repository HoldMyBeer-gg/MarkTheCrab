import { test, expect } from "@playwright/test";
import { openApp, setDoc, chooseTheme } from "./helpers.js";

const FLOW = "```mermaid\ngraph LR\n  A[Start] -->|yes| B[Go]\n  A -->|no| C[Stop]\n```\n";

// Relative luminance of the label text: light text on a dark preview, dark
// text on a light one, so the edge labels stay readable.
// While Mermaid redraws after a theme switch, the label can be caught
// detached with no computed colour. Report that as null ("not drawn yet")
// instead of throwing: expect.poll retries a failed match but not a throw,
// which made the theme-switch test fail about 1 run in 6.
const labelLuminance = (page) =>
  page.locator("#preview svg .edgeLabel").first().evaluate((el) => {
    const t = el.querySelector("p, span, text") || el;
    const rgb = getComputedStyle(t).color.match(/\d+/g);
    if (!el.isConnected || !rgb || rgb.length < 3) return null;
    const [r, g, b] = rgb.map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });

test.describe("mermaid follows the preview theme", () => {
  test("edge labels are dark on a light theme", async ({ page }) => {
    await openApp(page);
    await chooseTheme(page, "github");
    await setDoc(page, FLOW);
    await page.waitForSelector("#preview svg .edgeLabel", { timeout: 15000 });
    expect(await labelLuminance(page)).toBeLessThan(0.5);
  });

  test("edge labels are light on a dark theme", async ({ page }) => {
    await openApp(page);
    await chooseTheme(page, "dark");
    await setDoc(page, FLOW);
    await page.waitForSelector("#preview svg .edgeLabel", { timeout: 15000 });
    expect(await labelLuminance(page)).toBeGreaterThan(0.5);
  });

  test("switching theme re-renders the diagram in the new colours", async ({ page }) => {
    await openApp(page);
    await chooseTheme(page, "github");
    await setDoc(page, FLOW);
    await page.waitForSelector("#preview svg .edgeLabel", { timeout: 15000 });
    await chooseTheme(page, "dark");
    await expect.poll(() => labelLuminance(page), { timeout: 15000 }).toBeGreaterThan(0.5);
  });
});
