import { test, expect } from "@playwright/test";
import { openApp, setDoc, chooseTheme, computed } from "./helpers.js";

test.describe("themes", () => {
  test("Solarized Dark and Light paint different backgrounds across the whole preview pane", async ({ page }) => {
    await openApp(page);
    await setDoc(page, "# Solar\n\nSome text.");

    await chooseTheme(page, "solarized-dark");
    await expect.poll(() => computed(page.locator("#preview-pane"), "backgroundColor")).toBe("rgb(0, 43, 54)");

    await chooseTheme(page, "solarized-light");
    await expect.poll(() => computed(page.locator("#preview-pane"), "backgroundColor")).toBe("rgb(253, 246, 227)");
  });

  test("a theme's page margin doesn't frame the preview", async ({ page }) => {
    await openApp(page);
    await setDoc(page, "text");
    await chooseTheme(page, "solarized-dark"); // its body rule says margin: 40px 70px
    await expect.poll(() => computed(page.locator("#preview-pane"), "backgroundColor")).toBe("rgb(0, 43, 54)");
    expect(await computed(page.locator("#preview"), "marginTop")).toBe("0px");
  });
});
