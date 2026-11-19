import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// vite 8.0.0 to 8.1.5 carry five advisories (launch-editor command
// execution, server.fs.allow bypass, cross-origin middleware). vite only
// arrives through vitest, so nothing pins it; this keeps the lockfile honest.
const lock = readFileSync(join(import.meta.dirname, "..", "pnpm-lock.yaml"), "utf8");

function versionsOf(name) {
  const re = new RegExp(`^  ${name}@(\\d+)\\.(\\d+)\\.(\\d+):`, "gm");
  return [...lock.matchAll(re)].map((m) => m.slice(1, 4).map(Number));
}

describe("locked dependencies", () => {
  it("resolves no vite 8 release older than 8.1.6", () => {
    const vites = versionsOf("vite");
    expect(vites.length).toBeGreaterThan(0);
    for (const [major, minor, patch] of vites) {
      const vulnerable = major === 8 && (minor < 1 || (minor === 1 && patch < 6));
      expect(vulnerable, `vite ${major}.${minor}.${patch}`).toBe(false);
    }
  });

  // katex below 0.18.2 lets existing prototype pollution bypass its trust
  // restrictions. mermaid 11 pulls 0.16.x in alongside our own katex.
  it("resolves no katex older than 0.18.2", () => {
    const katexes = versionsOf("katex");
    expect(katexes.length).toBeGreaterThan(0);
    for (const [major, minor, patch] of katexes) {
      const vulnerable = major === 0 && (minor < 18 || (minor === 18 && patch < 2));
      expect(vulnerable, `katex ${major}.${minor}.${patch}`).toBe(false);
    }
  });
});
