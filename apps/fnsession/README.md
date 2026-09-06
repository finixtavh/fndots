# fnsession

`fnsession` is a small Hyprland 0.56 session CLI. It saves each mapped
window's workspace, absolute position, size, identity, and a minimal launch
command in a JSON file.

```text
fnsession save [name]
fnsession load [name]
fnsession watch [name] [--interval seconds]
fnsession scrub [--apply]
```

- Without a name, `save` uses the current local date and time.
- Without a name, `load` selects the most recently saved session.
- `watch` keeps one rolling, atomic snapshot and preserves the last non-empty
  layout while Hyprland is shutting down or restarting.
- Sessions live in `${XDG_STATE_HOME:-$HOME/.local/state}/fnsession/sessions`.
- Existing matching windows are reused. Missing windows are launched only when
  the newly created window matches the saved class; an unrelated window is
  never moved as a fallback.
- By default only a minimal executable is stored. Set
  `FNSESSION_CAPTURE_CONTEXT=1` while saving to opt into full argv and working
  directory capture when exact process context is more important than privacy.
- Floating windows are restored to their exact pixel rectangle.
- Tiled windows are temporarily positioned, then returned to Hyprland's tiled
  layout so window swapping, reordering, and insertion continue to work.

Versions installed before the privacy-safe default could store full process
arguments and working directories, which may include tokens or private paths.
Run `fnsession scrub` to inspect how many legacy files are affected, then
`fnsession scrub --apply` to rewrite them atomically. Loading without
`FNSESSION_CAPTURE_CONTEXT=1` already ignores legacy arguments in memory, but
scrubbing is still required to remove them from disk. Rotate any credentials
that may have been present in an older session file.

Session files are mode `0600` and are written atomically. Loading a session
executes the argument arrays stored in that session without invoking a shell.
`hyprctl` calls have a bounded timeout (`FNSESSION_HYPRCTL_TIMEOUT`, default 3s).
