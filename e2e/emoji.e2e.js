import { test, expect } from "@playwright/test";
import { openApp, setDoc } from "./helpers.js";

test.describe("emoji picker", () => {
  test("the toolbar button opens a picker with sections when no OS picker exists", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Insert emoji" }).click();
    const dialog = page.locator("#emoji-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Smileys" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "crab", exact: true })).toBeAttached();
  });

  test("search + Enter inserts the top match at the cursor", async ({ page }) => {
    await openApp(page);
    await setDoc(page, "hello ");
    await page.getByRole("button", { name: "Insert emoji" }).click();
    await page.locator("#emoji-search").fill("crab");
    await page.locator("#emoji-search").press("Enter");
    await expect(page.locator("#emoji-dialog")).not.toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("hello 🦀");
    await expect(page.locator("#preview")).toContainText("hello 🦀");
  });

  test("clicking an emoji inserts it; Escape closes without inserting", async ({ page }) => {
    await openApp(page);
    await setDoc(page, "x");
    await page.getByRole("button", { name: "Insert emoji" }).click();
    await page.locator("#emoji-search").fill("tada");
    await page.locator("#emoji-dialog").getByRole("button", { name: "tada", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText("x🎉");

    await page.getByRole("button", { name: "Insert emoji" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#emoji-dialog")).not.toBeVisible();
    await expect(page.locator(".cm-content")).toHaveText("x🎉");
  });
});
