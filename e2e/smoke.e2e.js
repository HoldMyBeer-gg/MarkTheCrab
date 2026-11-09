import { test, expect } from "@playwright/test";
import { openApp, setDoc } from "./helpers.js";

test("renders markdown through the wasm renderer", async ({ page }) => {
  await openApp(page);
  await setDoc(page, "# Hello crab");
  await expect(page.locator("#preview h1")).toHaveText("Hello crab");
});
