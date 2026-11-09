import { describe, it, expect } from "vitest";
import {
  parseFontSetting,
  fontSettingValue,
  fontStack,
  cssFamily,
  selectValue,
  filterFamilies,
} from "./fonts.js";

describe("parseFontSetting", () => {
  it("treats empty, missing, the old 'monospace' default and unknown values as Default", () => {
    for (const v of ["", null, undefined, "monospace", "something odd"]) {
      expect(parseFontSetting(v)).toEqual({ kind: "default" });
    }
  });

  it("recognises the bundled OpenDyslexic however it was stored", () => {
    expect(parseFontSetting("OpenDyslexic")).toEqual({ kind: "bundled", id: "opendyslexic" });
    expect(parseFontSetting("'OpenDyslexic', Georgia, serif")).toEqual({ kind: "bundled", id: "opendyslexic" });
  });

  it("reads a system font", () => {
    expect(parseFontSetting("system:JetBrains Mono")).toEqual({ kind: "system", family: "JetBrains Mono" });
  });

  it("treats a blank system font as Default", () => {
    expect(parseFontSetting("system:   ")).toEqual({ kind: "default" });
  });
});

describe("fontSettingValue", () => {
  it("round-trips through parseFontSetting", () => {
    for (const c of [
      { kind: "default" },
      { kind: "bundled", id: "opendyslexic" },
      { kind: "system", family: "Iosevka Term" },
    ]) {
      expect(parseFontSetting(fontSettingValue(c))).toEqual(c);
    }
  });
});

describe("cssFamily", () => {
  it("quotes a family name and escapes quotes and backslashes", () => {
    expect(cssFamily("Fira Code")).toBe('"Fira Code"');
    expect(cssFamily('Evil" ; } body { x')).toBe('"Evil\\" ; } body { x"');
    expect(cssFamily("a\\b")).toBe('"a\\\\b"');
  });
});

describe("fontStack", () => {
  it("is empty for Default so the editor theme decides", () => {
    expect(fontStack({ kind: "default" })).toBe("");
  });

  it("uses the bundled stack for OpenDyslexic", () => {
    expect(fontStack({ kind: "bundled", id: "opendyslexic" })).toBe("'OpenDyslexic', Georgia, serif");
  });

  it("falls back to monospace after a system font", () => {
    expect(fontStack({ kind: "system", family: "Menlo" })).toBe('"Menlo", monospace');
  });
});

describe("selectValue", () => {
  it("maps a choice to the settings dropdown's option value", () => {
    expect(selectValue({ kind: "default" })).toBe("default");
    expect(selectValue({ kind: "bundled", id: "opendyslexic" })).toBe("opendyslexic");
    expect(selectValue({ kind: "system", family: "Menlo" })).toBe("system");
  });
});

describe("filterFamilies", () => {
  const families = ["Menlo", "Fira Code", "fira sans", "Arial", "Courier New"];

  it("returns everything, sorted case-insensitively, for an empty query", () => {
    expect(filterFamilies(families, "")).toEqual(["Arial", "Courier New", "Fira Code", "fira sans", "Menlo"]);
  });

  it("matches a case-insensitive substring", () => {
    expect(filterFamilies(families, "FIRA")).toEqual(["Fira Code", "fira sans"]);
    expect(filterFamilies(families, "  new ")).toEqual(["Courier New"]);
  });

  it("puts names that start with the query first", () => {
    expect(filterFamilies(["Source Code Pro", "Cascadia Code", "Code New Roman"], "code"))
      .toEqual(["Code New Roman", "Cascadia Code", "Source Code Pro"]);
  });
});
