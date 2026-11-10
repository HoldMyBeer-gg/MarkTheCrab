# Smoke scripts

Repeatable functional checks of the real desktop app, driven through the
accessibility tree with bad-ass-mcp. They cover what the browser e2e tests
(`e2e/`, CI) can't reach: native dialogs, real files, the file watcher,
multiple windows, OS emoji/font integration.

Each `*.json` file is one flow. A fresh Claude session (any platform) can run
the whole suite from this page alone; nothing depends on earlier context.

## Keeping it current

Every user-facing feature or fix adds or updates the script for its flow in
the same commit. A run is the existing suite plus that delta.

## Running

The scripts run with BAM, bad-ass-mcp's script runner. From this repo, on any
platform, with a fresh release build (`pnpm tauri build`):

```
bad-ass-mcp run smoke/ --config bam.json
```

`bam.json` (not committed; the app path differs per machine):

```json
{
  "window": "MarkTheCrab",
  "app": {
    "macos": "/path/to/target/release/markthecrab",
    "windows": "C:\\path\\to\\target\\release\\markthecrab.exe",
    "linux": "/path/to/a/wrapper/that/execs/markthecrab"
  },
  "ready": { "name": "Insert emoji" },
  "launch_timeout": 30
}
```

- `app` makes the run launch its own copy and drive only that, so an open
  MarkTheCrab with real notes is never touched.
- `ready` waits for the toolbar: the window exists before its page does, and
  keys sent earlier are lost.
- Scripts for other platforms are skipped. Results, proof screenshots per
  phase and `report.html` land in `bam-results/`; `--resume`, `--fail-fast`,
  `--retries`, `--video` are described in bad-ass-mcp's `docs/bam.md`, which
  is also the format reference (phases, checks, `only`, per-platform values,
  `state`, `count`, `variables`, shell steps, `{"other": ...}` windows).
- The run takes over keyboard and mouse for a minute or two.

## Conventions

- Elements are found by accessible **name**, which is the same on every OS
  for our own UI (it comes from `aria-label` / button text). `role` is
  platform-native (macOS `button`, Windows UIA control types, AT-SPI on
  Linux), so leave it out unless a name is ambiguous, and then give it per
  platform: `"role": {"windows": "...", "linux": "...", "macos": "..."}`.
- Any `name` or `role` may be a per-platform object
  (`{"windows": "...", "linux": "..."}`): pick yours.
- Native dialogs (Save As, the OS replace prompt) differ per OS and are
  separate windows: find them with `list_windows` / `wait_for_window` and
  learn their elements with that window's id.
- `"confirm": true` marks a name or role written from docs, not a run. Fix
  it on the first run, drop the flag, and commit the delta. A script with no
  `confirm` left and a `verified` date per platform is fully trusted.
- `note` fields are instructions for the runner, not steps.
- `key` takes one key (`Return`, `Escape`, `F10`, `Down`, a single
  character). bad-ass-mcp has no Ctrl/Cmd chords on macOS or Windows, so
  scripts use toolbar buttons and menu items instead of shortcuts.
- **Windows:** a `key` with `window_id` is posted to the top-level window and
  never reaches WebView2 page content. Send keys to our UI *without*
  `window_id` (real input to the focused element), via `only: ["windows"]`
  twins of the `window_id` steps.
- **Windows:** the native menu bar's items are in the tree (role
  `menuitem`), but a UIA invoke on `File` doesn't open its popup, and the
  popup's items aren't under the window. Open menus with keys: `F10`, then
  `Down` (opens the menu on its first item), more `Down`s, `Return`.
- **Windows:** a `<select>` opens a native popup the tree can't see. Pick an
  option with the `select` action instead of clicking.
- Typing into the CodeMirror editor with `type`: works on Linux (the backend
  sends real keystrokes through xdotool to the focused element, which is how
  bad-ass-mcp's own MarkTheCrab demo is recorded); does nothing on macOS
  (the backend sets the AX value, which CodeMirror ignores); unverified on
  Windows. Scripts preload documents with `setup` + `launch` and use
  single-character `key` steps, which work everywhere.
- macOS opens its own emoji palette, so emoji-picker scripts skip `macos`.
- `only` works on checks too, and a `window` / `wait_for_window` pattern given
  per platform may be `null`: the phase then runs against `$WINDOW` and the
  wait is skipped. Linux needs this (see below).
- A learn entry (or a `present`/`absent` check) may add `"state": "focused"`
  / `"selected"` (per platform if needed): take the first `find_elements`
  match that carries that AT state. Needed where a native widget has no
  accessible name (GTK's file chooser name entry).
- `"count": n` on a `present` check asserts exactly n matches (default ≥ 1).
- `variables` hold per-platform literals (`$SMOKE` expands inside them);
  `$name` is substituted in `text`, `shell` and `cmd` fields. Explanations go
  in `variables_note`.
- `{"action": "shell", "cmd": "..."}` runs a shell command as a step, for
  `only`-gated platform glue (xdotool on Linux), never for the flow itself.

## Linux notes (SteamOS / KDE Wayland, WebKitGTK 2.54, run 2026-11-09)

- Launch the app with `GDK_BACKEND=x11` (e.g. in the `app` wrapper) so
  xdotool can drive it. Running bad-ass-mcp from source needs its Linux extra
  for `gi` (`uv sync --extra linux`).
- `--video` is black under Wayland (ffmpeg x11grab); leave it off there. Proof
  screenshots per phase still work.
- Roles: the menu bar's `File` is AT-SPI `menu`; tabs are `page tab` in a
  `page tab list` named "Open documents"; the active tab carries the
  `selected` state.
- `<select>` dropdowns: don't `click` the option. WebKitGTK leaves the native
  popup open and it swallows every keystroke after it. Use `select`.
- Menus: give the popup a beat (0.5 s) after opening it before activating an
  item; an immediate activation is lost.
- **Native dialogs are not separate windows on Linux.** GTK's file chooser is
  a `file chooser` child of the app itself ("Save File" / "Open File"), and
  MarkTheCrab's own prompts ("Unsaved changes", "External changes") are
  in-page dialogs. `list_windows` never shows them, so `window` and
  `wait_for_window` patterns are `null` for Linux and the checks use
  `absent` instead of `no_window`. The Save dialog's name entry is an unnamed
  `text` with the `focused` state; its `Save` button shares its name with the
  toolbar's, so confirm with Return. The Open dialog has no name entry until
  Ctrl+L. GTK's replace prompt button is `Replace`.
- Windows count: AT-SPI lists one application per process; each window is a
  `frame` under it, so `{"windows": n}` counts frames.
- bad-ass-mcp's Linux backend needed three fixes for these scripts to drive
  WebKitGTK at all; they live in that repo: XTEST keys instead of
  `xdotool key --window` (GTK drops the synthetic events), XTEST typing with
  select-all instead of `EditableText.set_text_contents` (it fires no DOM
  input events, so filtering never runs), and `--onlyvisible` when picking
  the X window to activate (GTK keeps closed dialogs' windows around unmapped).
