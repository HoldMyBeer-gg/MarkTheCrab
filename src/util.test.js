import { describe, it, expect } from "vitest";
import {
  isMobilePlatform,
  parentDir,
  joinPath,
  encodeMarkdownUrl,
  rebaseDocumentsPath,
  bytesToBase64,
} from "./util.js";

// The contract that matters most: iOS work must not leak into desktop. Every
// non-mobile target keeps taking the desktop code paths.
describe("isMobilePlatform", () => {
  it("is true only for ios and android", () => {
    expect(isMobilePlatform("ios")).toBe(true);
    expect(isMobilePlatform("android")).toBe(true);
  });

  it("is false for every desktop target, the browser demo, and the fallback", () => {
    for (const name of ["macos", "windows", "linux", "browser", "desktop", "", undefined]) {
      expect(isMobilePlatform(name)).toBe(false);
    }
  });
});

describe("parentDir", () => {
  it("returns the directory of a unix path", () => {
    expect(parentDir("/Users/x/Documents/note.md")).toBe("/Users/x/Documents");
  });

  it("handles windows backslash paths", () => {
    expect(parentDir("C:\\Users\\x\\note.md")).toBe("C:\\Users\\x");
  });

  it("returns empty string for a bare filename", () => {
    expect(parentDir("note.md")).toBe("");
  });
});

describe("joinPath", () => {
  it("joins with a forward slash and trims duplicates", () => {
    expect(joinPath("/a/b/", "/c.md")).toBe("/a/b/c.md");
    expect(joinPath("/a/b", "c.md")).toBe("/a/b/c.md");
  });

  it("uses backslash for windows-style dirs", () => {
    expect(joinPath("C:\\a\\b", "c.md")).toBe("C:\\a\\b\\c.md");
  });
});

describe("encodeMarkdownUrl", () => {
  it("leaves clean urls untouched", () => {
    expect(encodeMarkdownUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
  });

  it("wraps urls with spaces or parens in angle brackets", () => {
    expect(encodeMarkdownUrl("images/my file (1).png")).toBe("<images/my file (1).png>");
  });

  it("does not wrap data urls (no spaces or parens in base64)", () => {
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    expect(encodeMarkdownUrl(url)).toBe(url);
  });

  it("returns empty string for falsy input", () => {
    expect(encodeMarkdownUrl("")).toBe("");
  });
});

describe("rebaseDocumentsPath", () => {
  it("re-bases a stale container path onto the live Documents dir", () => {
    const stale = "/var/.../Application/OLD-UUID/Documents/note.md";
    const live = "/var/.../Application/NEW-UUID/Documents";
    expect(rebaseDocumentsPath(stale, live)).toBe(
      "/var/.../Application/NEW-UUID/Documents/note.md",
    );
  });

  it("preserves subfolders under Documents", () => {
    const stale = "/old/Documents/sub/dir/note.md";
    expect(rebaseDocumentsPath(stale, "/new/Documents")).toBe("/new/Documents/sub/dir/note.md");
  });

  it("returns the original path when there is no Documents segment", () => {
    expect(rebaseDocumentsPath("/somewhere/else/note.md", "/new/Documents")).toBe(
      "/somewhere/else/note.md",
    );
  });

  it("tolerates a trailing slash on the live dir", () => {
    expect(rebaseDocumentsPath("/old/Documents/note.md", "/new/Documents/")).toBe(
      "/new/Documents/note.md",
    );
  });
});

describe("bytesToBase64", () => {
  it("encodes small byte runs", () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });

  it("encodes payloads larger than the chunk size without overflow", () => {
    const big = new Uint8Array(0x8000 * 2 + 5).fill(65); // > 2 chunks of 'A'
    const decoded = atob(bytesToBase64(big));
    expect(decoded.length).toBe(big.length);
    expect(decoded[0]).toBe("A");
    expect(decoded[decoded.length - 1]).toBe("A");
  });
});
