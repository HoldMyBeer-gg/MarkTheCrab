import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A release tag builds from four version strings. If they drift, the
// installer, the About box and the crate disagree about what shipped.
const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const RELEASE = "0.3.2";

describe("release version", () => {
  it("is the same everywhere a build reads it", () => {
    const lockEntry = read("Cargo.lock").match(/name = "markthecrab"\nversion = "([^"]+)"/);
    expect({
      packageJson: JSON.parse(read("package.json")).version,
      tauriConf: JSON.parse(read("src-tauri/tauri.conf.json")).version,
      cargoToml: read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)[1],
      cargoLock: lockEntry && lockEntry[1],
    }).toEqual({
      packageJson: RELEASE,
      tauriConf: RELEASE,
      cargoToml: RELEASE,
      cargoLock: RELEASE,
    });
  });
});
