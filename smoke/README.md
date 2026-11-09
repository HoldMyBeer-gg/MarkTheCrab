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
- `key` takes one key (`Return`, `Escape`, a single character). bad-ass-mcp
  has no Ctrl/Cmd chords on macOS or Windows, so scripts use toolbar buttons
  and menu items instead of shortcuts.
- Typing into the CodeMirror editor through `type` doesn't work (it isn't a
  plain text field); preload documents with `setup` + `launch`, and use
  single-character `key` steps for small edits.
- macOS opens its own emoji palette, so emoji-picker scripts skip `macos`.
