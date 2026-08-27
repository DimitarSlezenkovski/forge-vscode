# Jarvis Glass — the Forge colour theme

Two themes, **Jarvis Glass Dark** (the Forge default) and **Jarvis Glass Light**.
They are one of the three layers that make Forge look like glass; on their own
they give translucency but no blur. The full recipe is in
[`docs/design/glass-ui.md`](../../../../docs/design/glass-ui.md) §6.3 and the
"Glass" section of [`../../README.md`](../../README.md).

| Layer | What it does | Where it lives |
| --- | --- | --- |
| Electron window material | Mica (Windows 11) / vibrancy (macOS) behind the whole window | `patches/0004-glass-window-material.patch` |
| **This theme** | `#RRGGBBAA` workbench + editor colours so the layers below read through | `apps/forge-vscode/extensions/jarvis-glass-theme` |
| Workbench CSS | the actual `backdrop-filter` blur, specular edges, concentric radii | `patches/0003-glass-workbench-css.patch` |

## Generated, not hand-written

`themes/*.json` are **generated** by
[`../../scripts/generate-glass-themes.mjs`](../../scripts/generate-glass-themes.mjs).
Do not hand-edit them; edit the palette tables in that script and re-run it:

```powershell
node apps\forge-vscode\scripts\generate-glass-themes.mjs           # write
node apps\forge-vscode\scripts\generate-glass-themes.mjs --check   # contrast gate only
```

A VS Code theme's `include` only resolves inside its own extension, so the
token colours cannot reference `theme-defaults`. The generator flattens
upstream's `dark_modern → dark_plus → dark_vs` (and the light equivalent) chain
once, lays the Jarvis Glass workbench palette over it, and lifts the token
colours that would not clear **7:1** against the translucent editor.

## Why 7:1 and not 4.5:1

Code is dense and read for hours, so Forge holds syntax colours to 7:1 rather
than the 4.5:1 floor `glass-ui.md` uses for UI text. The generator models the
real stack behind a glyph — native material → app-owned ambient wash → editor
blob peak → editor scrim — for the two extreme backdrops (a pure white and a
pure black wallpaper tint) and reports the worst contrast each colour reaches.
Both themes currently pass: nothing below **7.05:1** (dark) or **7.15:1**
(light).

Ten dark and thirteen light token colours are lifted along their own hue for
this; everything else is upstream's value untouched. The generator's `suggest()`
helper does the search, so the table is filled in from the measurement rather
than by eye — but the values are checked in, so a rerun cannot silently re-tint
the palette.

## `configurationDefaults`

The manifest sets `workbench.colorTheme`, the two `preferred*ColorTheme`
settings and `terminal.integrated.gpuAcceleration: "off"` (xterm's WebGL
renderer ignores an alpha `terminal.background`; the DOM renderer honours it).

`window.titleBarStyle` is **not** set here even though the glass chrome needs
`custom`: it is an `APPLICATION`-scoped setting, and VS Code's
`configurationDefaults` handler drops those with a warning in the extension host
log. Upstream's default is already `custom` on Windows and Linux, so there is
nothing to override.
