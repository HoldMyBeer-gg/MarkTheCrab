import { test, expect } from "@playwright/test";
import { openApp, setDoc, computed } from "./helpers.js";

const STYLED = [
  "<style>",
  ".red { color: rgb(220, 20, 60); }",
  "body ~ * { display: none; }",
  "#toolbar { display: none; }",
  "</style>",
  "",
  'Plain text with a <span class="red">red span</span>.',
  "",
  "```html",
  "<style>p { color: red }</style>",
  "```",
].join("\n");

test.describe("document <style>", () => {
  test("styles the preview", async ({ page }) => {
    await openApp(page);
    await setDoc(page, STYLED);
    await expect.poll(() => computed(page.locator("#preview .red"), "color")).toBe("rgb(220, 20, 60)");
  });

  test("can't reach app UI outside the preview", async ({ page }) => {
    await openApp(page);
    const mascotDisplay = await computed(page.locator("#preview-mascot"), "display");
    await setDoc(page, STYLED);
    await expect.poll(() => computed(page.locator("#preview .red"), "color")).toBe("rgb(220, 20, 60)");

    await expect(page.locator("#toolbar")).toBeVisible();
    expect(await computed(page.locator("#preview-mascot"), "display")).toBe(mascotDisplay);
  });

  test("a <style> inside a code block is shown as text, not applied", async ({ page }) => {
    await openApp(page);
    await setDoc(page, STYLED);
    await expect(page.locator("#preview pre code")).toContainText("<style>p { color: red }</style>");
    await expect.poll(() => computed(page.locator("#preview p").first(), "color")).not.toBe("rgb(255, 0, 0)");
  });

  test("removing the <style> block removes its rules", async ({ page }) => {
    await openApp(page);
    await setDoc(page, STYLED);
    await expect.poll(() => computed(page.locator("#preview .red"), "color")).toBe("rgb(220, 20, 60)");
    await setDoc(page, 'Plain text with a <span class="red">red span</span>.');
    await expect.poll(() => computed(page.locator("#preview .red"), "color")).not.toBe("rgb(220, 20, 60)");
  });
});
