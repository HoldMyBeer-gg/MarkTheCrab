import { test, expect } from "@playwright/test";
import { openApp, setDoc, openSettings, chooseTypedFont, computed } from "./helpers.js";

test.describe("font settings", () => {
  test("Preview font changes preview text but not code, and not the editor", async ({ page }) => {
    await openApp(page);
    await setDoc(page, "Prose here.\n\n`code here`");
    await openSettings(page);
    await chooseTypedFont(page, "settings-preview-font-select", "Georgia");

    await expect.poll(() => computed(page.locator("#preview p").first(), "fontFamily")).toContain("Georgia");
    expect(await computed(page.locator("#preview code"), "fontFamily")).not.toContain("Georgia");
    expect(await computed(page.locator(".cm-content"), "fontFamily")).not.toContain("Georgia");
  });

  test("the chosen font shows as a named entry, with no blank option in the dropdown", async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    const select = page.locator("#settings-preview-font-select");
    await chooseTypedFont(page, "settings-preview-font-select", "Georgia");

    await expect(select).toHaveValue("system");
    await expect(select.locator('option[value="system"]')).toHaveText("Georgia");
    const labels = await select.locator("option").allTextContents();
    expect(labels.filter((l) => l.trim() === "")).toEqual([]);
  });

  test("cancelling the font dialog puts the dropdown back", async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    const select = page.locator("#settings-font-select");
    await select.selectOption("opendyslexic");
    await select.selectOption("choose");
    await page.locator("#font-cancel").click();
    await expect(select).toHaveValue("opendyslexic");
  });

  test("Editor font changes the editor only", async ({ page }) => {
    await openApp(page);
    await setDoc(page, "Prose here.");
    await openSettings(page);
    await chooseTypedFont(page, "settings-font-select", "Courier New");

    await expect.poll(() => computed(page.locator(".cm-content"), "fontFamily")).toContain("Courier New");
    expect(await computed(page.locator("#preview p"), "fontFamily")).not.toContain("Courier New");
  });

  test("Escape closes the font dialog from inside its search box", async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    const select = page.locator("#settings-font-select");
    await select.selectOption("choose");
    await page.locator("#font-search").fill("Geo");
    await page.locator("#font-search").press("Escape");
    await expect(page.locator("#font-dialog")).not.toBeVisible();
    await expect(page.locator("#settings-dialog")).toBeVisible();
    await expect(select).toHaveValue("default");
  });
});

