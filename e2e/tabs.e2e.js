import { test, expect } from "@playwright/test";
import { openApp } from "./helpers.js";

test.describe("tabs", () => {
  test("every tab's accessible name is just its title, active or not", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "New tab" }).click();
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(2);
    // Before the fix the active tab read "Untitled Close Untitled" (its close
    // button's label folded in), so name-based automation only found the
    // inactive one.
    await expect(page.getByRole("tab", { name: "Untitled", exact: true })).toHaveCount(2);
  });
});
