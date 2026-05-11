#!/usr/bin/env node
// Wrap wasm-pack so it runs with rustup-managed cargo/rustc on the PATH.
// On macOS, Homebrew rust at /opt/homebrew/bin can shadow rustup; npm scripts
// don't inherit the shell rc that fixes that, so we prepend ~/.cargo/bin here.

import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

const cargoBin = join(homedir(), ".cargo", "bin");
const sep = delimiter;
process.env.PATH = `${cargoBin}${sep}${process.env.PATH ?? ""}`;

const args = [
  "build",
  "crates/wasm-bindings",
  "--target",
  "web",
  "--out-dir",
  "../../src/dist/wasm/pkg",
  "--release",
];

const isWin = platform() === "win32";
const child = spawn("wasm-pack", args, { stdio: "inherit", shell: isWin });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("Failed to spawn wasm-pack:", err.message);
  console.error("Is wasm-pack installed? Try: cargo install wasm-pack");
  process.exit(1);
});
