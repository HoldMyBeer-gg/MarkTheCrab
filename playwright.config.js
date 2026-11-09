// End-to-end tests against the browser build (same app.js, Rust renderer as
// WASM). Chromium stands in for WebView2 (Windows), WebKit for WKWebView
// (macOS) and WebKitGTK (Linux). Build first: pnpm run build:demo.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.js", // not *.spec.js / *.test.js, which vitest collects
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4173", actionTimeout: 10_000 },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node scripts/serve-demo.mjs src",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
