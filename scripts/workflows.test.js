import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Without a permissions block a workflow gets the repository's default
// GITHUB_TOKEN, which can include write access it never uses. CodeQL flagged
// ci.yml for this; the guard keeps a new workflow from repeating it.
const dir = join(import.meta.dirname, "..", ".github", "workflows");
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

describe("workflow permissions", () => {
  it.each(files)("%s declares top-level permissions", (file) => {
    const text = readFileSync(join(dir, file), "utf8");
    expect(text).toMatch(/^permissions:/m);
  });
});
