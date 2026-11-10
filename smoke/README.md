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
- `{"action": "drag", "from_target": "a", "to_target": "b"}` drags between two
  learned elements with real pointer events; `"dx"` / `"dy"` instead of
  `to_target` drags the element by that many pixels (the editor/preview
  splitter). `{"action": "get_bounds", "target": "a"}` reads `[x, y, w, h]`;
  with `"save"` before a drag and `"expect_not": "$saved"` after it, the step
  fails unless something moved. Needs bad-ass-mcp from 2026-11-09 or later.
- A `state` may be `"pressed"`: a toolbar toggle with `aria-pressed="true"`
  (verified on Linux; other platforms' toggle states unconfirmed).

## The app under test uses the real settings file

MarkTheCrab reads and writes the user's own `settings.toml`
(`dirs::config_dir()/markthecrab/`: `~/.config` on Linux, `%APPDATA%` on
Windows, `~/Library/Application Support` on macOS). A smoke run therefore
changes it: every launched file lands in `recent_files` (and in the Recent
dropdown), and any toolbar toggle a script clicks is persisted at once:
`live_preview` (Toggle preview), `vertical_layout` (Toggle layout),
`night_mode`, `theme`, fonts, `zoom_level`, window size. A script that flips
one must flip it back, and a script that fails in between leaves it flipped
(resize-split between its two Toggle layout clicks leaves the app stacked).

Isolate it where you can. On Linux the `dirs` crate honours
`XDG_CONFIG_HOME`, so point the BAM launch wrapper at a scratch dir that it
wipes per launch (fresh defaults every run, nothing of the user's touched).
Under distrobox the variable must go on the inner command, since
`distrobox-enter` resets it:

```sh
exec distrobox-enter -n build -- env XDG_CONFIG_HOME="$CFG" GDK_BACKEND=x11 \
  target/release/markthecrab "$@"
```

Windows and macOS have no such override (the app would need a config-dir
env var of its own), so there the runner should start from, and restore, a
copy of the user's file.

Seed the isolated file with a complete `settings.toml` (copy one the app
wrote, or `Settings::default()` serialised) that has one `recent_files`
entry, any path. It must be complete: a file missing any key other than
`preview_font` fails to parse and the app silently replaces it with all
defaults, so a one-line seed is no seed. With no recent files,
a launch without a file argument (font-picker-escape, new-window) opens the
first-run welcome card, a modal `<dialog>` that makes the page inert, and
WebKitGTK drops inert content from the a11y tree: the toolbar vanishes and
the app never becomes "ready" (seen 2026-11-09, two scripts failed that way).

Under distrobox, terminating the `distrobox-enter` client does not stop the
app inside the container, so each run leaves a MarkTheCrab behind unless the
wrapper traps TERM and kills it (`pkill -x -n markthecrab`, newest only).

## Linux notes (SteamOS / KDE Wayland, WebKitGTK 2.54, run 2026-11-09)

- Launch the app with `GDK_BACKEND=x11` (e.g. in the `app` wrapper) so
  xdotool can drive it. bad-ass-mcp on Linux has no extra: run it from a venv
  created with `--system-site-packages`, so it sees the system's `gi`.
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
- Drags work: xdotool's XTEST pointer (`mousedown`, interpolated `mousemove`,
  `mouseup`) reaches the page's mouse handlers, so `resize-split.json` moves
  the splitter in both layouts. `aria-pressed` is the AT-SPI `pressed` state.
- bad-ass-mcp's Linux backend needed three fixes for these scripts to drive
  WebKitGTK at all; they live in that repo: XTEST keys instead of
  `xdotool key --window` (GTK drops the synthetic events), XTEST typing with
  select-all instead of `EditableText.set_text_contents` (it fires no DOM
  input events, so filtering never runs), and `--onlyvisible` when picking
  the X window to activate (GTK keeps closed dialogs' windows around unmapped).
