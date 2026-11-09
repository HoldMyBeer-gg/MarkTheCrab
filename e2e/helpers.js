import { expect } from "@playwright/test";

// Load the browser build and get past the first-run welcome card.
export async function openApp(page) {
  await page.goto("/");
  const welcome = page.locator("#welcome-dialog");
  await page.locator("#welcome-go").click({ timeout: 5000 }).catch(() => {});
  await expect(welcome).not.toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();
}

// Replace the editor's text and wait for the preview to re-render.
export async function setDoc(page, text) {
  // Focus directly: in an empty editor the sleeping mascot is clickable (it
  // celebrates) and sits over the middle of .cm-content.
  await page.locator(".cm-content").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

export async function openSettings(page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
}

export async function chooseTheme(page, value) {
  await openSettings(page);
  await page.locator("#settings-theme-select").selectOption(value);
  await page.keyboard.press("Escape");
}

// Pick "Choose a font…" in a font dropdown and use a typed family name. The
// browser build can't list installed fonts, so this is the typed-name path.
export async function chooseTypedFont(page, selectId, family) {
  await page.locator(`#${selectId}`).selectOption("choose");
  await expect(page.locator("#font-dialog")).toBeVisible();
  await page.locator("#font-search").fill(family);
  await expect(page.locator("#font-list li").first()).toHaveText(`Use \u201c${family}\u201d`);
  await page.locator("#font-search").press("Enter");
  await expect(page.locator("#font-dialog")).not.toBeVisible();
}

export const computed = (locator, prop) =>
  locator.evaluate((el, p) => getComputedStyle(el)[p], prop);
