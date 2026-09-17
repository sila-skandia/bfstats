# MEME-10 — spawn-screen map dimming (settled 2026-09-17)

Ghidra project `bf1942-mp-enabler`, program `BF1942.exe`. No global re-analysis;
CRT `0x00838b5e`–`0x008b191f` ignored.

## Verdict

The spawn map is not dimmed by any `EffectNode` in `ShowMap`. `BfMap__update`
(`0x0046a680`) draws the map quad with colour alpha:

| Mode | Byte `+0x3c` | Quad alpha |
|---|---|---|
| Closed HUD minimap | 0 | `1.0 × (+0x54)` |
| Open map (M / spawn) | ≠0 | `(+0x4c) × 0.8 × (+0x54)` |

Steady state with the map visible (`+0x4c → 1`) and shipped default
`game.setMinimapTransparency 20`:

**spawn / open-map alpha = 0.8 × (1 − 20/100) = 0.64**

The capture's "black sea, faint grid" is that alpha over a near-black panel, not
a second multiplier. Profiles with a high transparency (e.g. local `86`) push
open-map alpha to `0.8 × 0.14 = 0.112` and look much darker.

## Field map (`BfMap`)

| Offset | Role |
|---|---|
| `+0x3c` | Open/closed target (byte). Writer `FUN_00467960` (`0x00467960`), from HUD frame `FUN_006ad0a0` at `0x006adaa2` |
| `+0x3d` | Deploy/icon-scale mode (byte). Writer `FUN_00467dd0` (`0x00467dd0`), from `0x006ad90c` = `*(game+0x30)+0x1c` |
| `+0x4c` | Current fade alpha. Eased in `BfMap__animate` `0x00468fb0` toward `+0x50` at rate −9 (same exp as zoom) |
| `+0x50` | Fade **target** 0 or 1 (show/hide), **not** transparency. Sole writer `FUN_00467920` (`0x00467920`) ← `FUN_006ad0a0` at `0x006ada70` |
| `+0x54` | Transparency multiplier. Writer `FUN_00467930` (`0x00467930`) |

Ctor `0x0046e230` seeds `+0x4c` / `+0x50` at 1.0.

## `setMinimapTransparency` link

| Address | Role |
|---|---|
| `0x0091fd04` | `"setMinimapTransparency"` |
| `0x006b8ad0` | Console-command registrar (`FUN_006b8ad0`) |
| `0x006b8c20` | Command execute (untyped blob): pushes int arg → `FUN_006d5650` |
| `0x006d5650` | Profile apply: stores int at profile `+0x40`, then if BfMap exists (`DAT_00973ab8+0x6e4`) calls `FUN_00467930(1.0 − pct×0.01)` |
| `0x00923a60` | `"MinimapTransparency"` (options UI / profile load via `0x006d4daf`) |
| `0x00923c8c` | `"game.setMinimapTransparency %d\n"` (save in `FUN_006d5a20`) |

Formula: **`+0x54 = 1.0 − (int)T × 0.01`**. T=0 opaque, T=100 invisible. Default 20 → 0.80.

## Map-quad use of the alphas

In `BfMap__update` at `0x0046a955`–`0x0046a968`:

- if `+0x3c == 0`: load 1.0 (`0x008c53c8`)
- else: `FLD [this+0x4c]` × 0.8 (`0x008d6290` = `0x3f4ccccd`)
- then `FMUL [this+0x54]`
- store as vertex colour A and pass into `FUN_00468260` (`0x00468260`) → `FUN_007ed7e0`

Icons still multiply various constants by `+0x4c` (and when `+0x3d` is set use
smaller bases: players 0.45, flags 0.3, CPs 0.5) via `FUN_00468870`
(`0x00468870`). That is icon chrome, not the art dim.

## Ruled out (unchanged)

| Symbol / addr | Why not the dimmer |
|---|---|
| `ShowMap` / empty `ClipNode` | No `EffectNode`; confirmed MEME-8 |
| `minimap_resolveMapPath` `0x0045d7c0` | Installs level picture into `MapPath` only |
| `Textures/InGameMap.tga` `0x008d56f8` → `FUN_0045cf00` | Path builder only |
| `+0x50` | Visibility fade target, not the transparency slider |

## Viewer

`tools/bf1942-models/viewer/map.html` `drawArt` spawn path updated from hand-tuned
`0.3` to **`0.64`** (`0.8 × (1 − 20/100)`).
