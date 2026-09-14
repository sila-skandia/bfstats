# Mesh viewer: Neutral Depth pass and crew stations

The Claude Design mock `Mesh Viewer.dc.html` (turn 1: 1a global shell, 1b model
inspector), implemented in
[`tools/bf1942-models/viewer`](../../tools/bf1942-models/viewer). One addition
the mock does not have: the crew console.

## What maps to what

| Mock | Where |
|---|---|
| 1a topbar, feature tabs, search pill | `shell.css`, the `<nav>` in all three pages |
| 1a olive mod strip + per-tab counts | `mods.js` `install()`; grows `--nav-h` 46 → 76px via `html.shell-has-mods` |
| Tokens, Geist, Geist Mono | `tokens.css`, fonts vendored under `vendor/fonts/` (OFL) |
| 1b control column | `index.html` `<aside>` |
| 1b stage tone, crumb, hints strip, corner load card | `.stage`, `#crumb`, `#hints`, `createLoadOverlay(main, { placement: 'corner' })` |

Maps and Poses got the shell and a token remap of their own `--bg`/`--line`/
`--accent` variables, not a panel redesign — the mock does not cover them.

## Crew stations

The mock kept Views, Guns and Rig as three sidebar sections, each listing every
seat. On a Sherman that put the commander's Browning trigger a screen away from
the dial that traverses it.

Every rig input, FireArms template and camera template already names its
PlayerControlObject, so the console groups by that: one station per seat, docked
under the stage, each carrying

- **Aim** — a top-down traverse dial (hull up, needle is the turret, olive arc is
  the authored yaw range) and an elevation scale (reachable arc, highest at top).
  Both are drawn from the rig's own min/max, so a Wespe's ±20° and a Sherman's
  free turret look different.
- **Stick / drive** — XY pads. Drive springs home on release.
- **Gear** — Down/Up that travels over 0.9 s rather than jumping.
- **Engine** — the baked spin clips, on the driver/pilot station.
- **Triggers** — hold to fire, projectile kind, rate, velocity, rounds fired.
- **Seat camera** — the eye button; Orbit sits in the console header.

Camera-only seats (the Hanomag's passengers) share one Passengers station.

| Key | Does |
|---|---|
| `1`–`9` | select station |
| `Space` / `F` | fire the station's first / second gun |
| `W A S D` | drive (throttle, steer) — held, springs back |
| arrows | stick (pitch, roll) |
| `G` / `E` | gear / engine |
| `V` / `O` | seat view / orbit |

Sign conventions were checked against renders, not assumed: a +45° traverse
points a Sherman's barrel forward-right from above, and its `-20..5` pitch range
is twenty degrees of elevation and five of depression.

## Where the build departs from the mock

- **Armour ramp reads Vulnerable → Protected**, not Critical → Immune: without a
  weapon selected the ranking is inferred, and immune faces are marked
  separately (dashed chip, darker mesh).
- **"Mirror both hulls" is not built.** No behaviour behind it was defined.
- **Explode is a slider**, with the furthest part offset in metres as the mock
  shows; halfway is the old fixed 2.2x.
- **The head-on duel (mock 1c) is not built.** Compare shipped and was removed
  again: parking a ghosted opponent to read a shots-to-kill scoreboard was not
  an intuitive way to ask the question. Armour inspection covers the same tables
  one face at a time.

## Follow-ups

- Re-shoot browse thumbnails (`node shoot.mjs --thumbs`): they carry the old
  `#14150f` background, a shade off the new `#0c0c0c` stage well.
- Maps and Poses panels are still the pre-mock layout under the new tokens.

## Verification

Headless Chromium (SwiftShader) against `python3 -m http.server`: Sherman,
Chi-ha, M10, B17, Hanomag, Katyusha, Spitfire, Thompson, the armoury, Maps,
Poses and a 400px viewport, with no page errors. Keyboard fire and the
traverse/elevation signs checked from top and side renders.
`node shoot.mjs --rig` now drives inputs through `__modelInspector.setInput`;
`--thumbs` still produces 500x500.
