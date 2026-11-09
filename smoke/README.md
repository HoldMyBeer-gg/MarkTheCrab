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

Prereqs: a release build (`pnpm tauri build`) or `pnpm run tauri dev`, and the
bad-ass-mcp tools. Run each script that lists your platform in `platforms`:

1. `SMOKE` = a fresh empty temp directory. Run every `setup` entry with the
   shell (`$SMOKE` expanded).
2. Launch the app with the script's `launch` arguments (paths relative to
   `$SMOKE`), e.g. `target/release/markthecrab "$SMOKE/a.md"`. Wait for its
   window (`wait_for_window` "MarkTheCrab"), note its `window_id`, and
   `start_recording` on that window.
3. For each phase:
   - `learn_layout(window_id, phase.learn)` → label → handle. A `null`
     handle is a failure: the element isn't there.
   - Build the `run_sequence` steps: replace `"target": "<label>"` with
     `"handle": "<handle id>"`, `"$WINDOW"` with the window id, and drop
     steps whose `only` doesn't include your platform. Strip `expect` before
     sending, along with `save`. Run with `stop_on_error: true`. Any failed
     step is a failure, and so is a `get_value` step whose result differs
     from its `expect`. A `get_value` step with `"save": "x"` keeps its
     result; a later `"expect": "$x"` compares against it.
4. Run `checks`:
   - `{"present": {name, role?}}` → `find_elements` must return ≥ 1.
   - `{"absent": {name, role?}}` → `find_elements` must return 0.
   - `{"windows": n}` → `list_windows` must show `n` MarkTheCrab windows.
   - `{"shell": "..."}` → must exit 0.
   - `{"manual": "..."}` → do what it says with the same tools; it's a
     check the format can't express yet. Turn it into phases when you can.
5. `stop_recording` to `$SMOKE/<script name>.mp4`, quit the app, report
   PASS/FAIL per script with the failing step or check.

### Phase extras

- A `learn` entry may carry `only`, like a step: skip it on other platforms
  (a skipped entry isn't a null-handle failure).
- `"window": "<title pattern>"` (or a per-platform object) runs the phase
  against that window instead of `$WINDOW`: `wait_for_window` it, then
  `learn_layout` with its id. Native dialogs and MarkTheCrab's own prompts
  (e.g. "Unsaved changes", "External changes") are separate windows.
- `"id": "x"` names a phase; `{"repeat": "x"}` runs that phase again with a
  fresh `learn_layout` (handles from the first pass are stale).
- A phase with only `checks` runs them at that point in the flow, same rules
  as the top-level `checks`.
- `{"no_window": "<pattern>"}` → `list_windows` must show no window whose
  name matches.
- `wait_for_window`'s `pattern` may be a per-platform object.

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

- `smoke/runner.py` executes the steps above through bad-ass-mcp's own
  functions in-process (see its header; it needs the bad-ass-mcp venv's
  Python for `gi`). The app runs with `GDK_BACKEND=x11` so xdotool works.
  It also records: ffmpeg x11grab (bad-ass-mcp's `start_recording`) is black
  under Wayland, so the runner takes compositor screenshots between steps
  and writes `<script>.mp4` (2 fps, cropped to the window).
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
