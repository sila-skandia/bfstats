## Verdict summary

12 confirmed, 2 corrected, 0 refuted, 0 unverifiable. Safe to plan the D4 fix against: write `CrossHair/ScopeIndex` 0/1 plus `ScopeIcon`/`SniperSight`/`SightIcon` from weapon data; Radius offset nuance and the extra `0x006a9750` callers do not change that plan.

## Per claim

| # | Claim (abbreviated) | Verdict | What I found |
|---|---|---|---|
| 1 | CrossHair object at HUD `DAT_00a5f1a8`+0x1c; ctor `0x006e9d30`; `registerVariables` `0x006e9a60`; field offsets | CORRECTED | Singleton ctor stores CrossHair from `FUN_006e9d30` at `param_1[7]` = +0x1c. Ctor asm: `ShowCrossHair` +0x08=1, `ScopeIndex` +0x30=0, `CrossHairIcon` string +0x10, `ScopeIcon` +0x44, `SightIcon` +0x64, `ShowCenterPoint` +0x85=1. Sync writes `CrossHairType` at +0x0c and `SniperSight` at +0x84. **Radius/Deviation: live HUD slots are +0x34/+0x38** (SoldierHud feed `0x006e9690` writes them); **ctor defaults 5.0f are at +0x3c/+0x40**, which the report omits. Handles +0x2c/+0x60/+0x80 match `registerVariables`. Strings at `0x00926068`–`0x009260e0` present. |
| 2 | `ScopeIndex` is 0/1 overlay flag via `setZoom` → `0x006a9b20` when `useScope` | CONFIRMED | `setZoom` `0x005391b0`: template at `this+0x4c`; `useScope` byte at +0x3d8 (`0x00539233`); on zoom `mov 0xa5f1a8 → ecx; push 1; call 0x6a9b20`; unzoom `push 0; call 0x6a9b20`. `0x006a9b20` writes dword 0/1 to both HUD objects’ CrossHair+0x30 (`this+8` and `this+0xc` → +0xc → +0x30). Texture path is separate (`ScopeIcon`). |
| 3 | Generic setter `0x006a9750` only called from `0x006d4b50` with 0; no 2+ | CORRECTED | `0x006a9750` writes arbitrary int to both CrossHair+0x30. **Call sites: `0x006adbda`, `0x006aeb9c` (in the large HUD path around `0x006ad0a0`), and two in `0x006d4b50`** — all `push $0` / `xor eax; push eax`. Substance holds (no nonzero); “only caller `0x006d4b50`” is wrong. |
| 4 | Weapon→HUD sync `0x006e9dd0` copies type/icons/SniperSight from template offsets | CONFIRMED | Decompile: +0x474→`CrossHairType`(+0x0c), +0x478→`CrossHairIcon`, +0x494→`ScopeIcon`(+0x44), +0x4b0→`SightIcon`(+0x64), +0x4cc→`SniperSight`(+0x84). Caller `0x006e9690` at `0x006e96d0`: `ecx = SoldierHud+0xc` (CrossHair), `push` template `FireArms+0x4c`. |
| 5 | `.con` words useScope / setSniperSight / setScopeIcon / setSightIcon; property ctors | CONFIRMED | Ctors `0x004d2d50` (`useScope`), `0x004d3970` (`sniperSight`), `0x004d34d0` (`scopeIcon`), `0x004d3720` (`sightIcon`). Scripts use the `set*` command forms. |
| 6 | Vanilla No4Sniper / K98Sniper / Binoculars scope fields | CONFIRMED | HandFireArms-only parse: both snipers `useScope 1`, `setSniperSight 1`, `setScopeIcon "sniper.tga"`, `zoomFov 0.1`, `unZoomBetweenFireTime 3.0`, `altFireOnce 1`, final `setCrossHairType CHTNone` (=0 per ledger VHUD-5). Binoculars: `useScope 1`, `setSniperSight 0`, `binocular.tga`, `scout_ring_128x128.tga`, `zoomFov 0.2`. |
| 7 | 140 mod weapons with scope fields; ScopeIndex contract where menu embeds it | CONFIRMED | Same survey filter → **weapons=140**; 48 distinct `setScopeIcon` names. `ScopeIndex` in menu.rfa: bf1942, FH, FHSW, FinnWars, GCMOD, DesertCombat, WarFront, bf1918, bfheroes, bg42; absent DC_Final / XPack1 / XPack2 (as report Open notes). |
| 8 | `sniper.png` 256² blackout-by-alpha; layout el3 rect / atlas | CONFIRMED | PIL: 256×256 RGBA; corners `(0,0,0,255)`; centre alpha 0. Layout el[3] rect `[-8,-2,825,625]`, texture `sniper`, var `CrossHair/ScopeIcon`, when `ScopeIndex != 0`. |
| 9 | Landscape `_scaleFor` indep `sx/sy`; PictureNode letterbox open | CONFIRMED | `hud.js:286–291`: portrait uniform letterbox; landscape `sx=W/vw`, `sy=H/vh`. Letterbox of square TGA in 825×625 left open — correct. |
| 10 | Input bit 0x20 → setZoom; UnZoomBetweenFireTime clears via setZoom(0) | CONFIRMED | `0x004f76d0`: `(param_2 & 0x20)` → `FUN_005391b0(1/0)`. `0x00539c80`: if zoomed FOV stored `>0`, `FUN_005391b0(0)`. |
| 11 | Hip↔zoom ease 25% / FOV 0.7·c+0.3·t; camera (0,2); viewer hides rig | CONFIRMED | Corpus `handweapon-view-and-deviation.md` (25% per visual update; FOV 0.7/0.3; `isZoomed && useScope` → `(0,2)`). Viewer `map.html:5580`: `hw.rig.visible = !(hw.data?.zoom?.scope && zoomed)`. |
| 12 | Defect = missing `CrossHair/*` writes; painter/layout present | CONFIRMED | `updateSoldierHud` (`map.html:5769–5847`) never sets `CrossHair/*`. `hud.js:502–506` documents cull. README evidence index: `game-sniper-zoom.png` vs `mesh-sniper-zoom.png`. DOM `#crosshair` separate (`updateCrosshair`). |
| 13 | Atlas has `sniper` + `scout_ring`; `binocular.tga` in menu.rfa not packed | CONFIRMED | `hud.json` sprites: `sniper`, `scout_ring_128x128`, `icon_binoculars` — no `binocular`. bf1942 `menu.rfa` `binocular.tga` size **262188**. |
| 14 | ShowCrossHair default true; scoped gate is ScopeIndex!=0 | CONFIRMED | Ctor +0x08=1; helpers `0x006ea690` clear / `0x006ea960` set that byte. Layout: scope picture/fills require `ScopeIndex != 0`; hip art requires `ScopeIndex == 0`. (Variable-table “hide/show slots” list order is swapped vs asm — minor.) |

## Load-bearing inferences

- **PictureNode letterboxing (Open):** If the square TGA is stretch-to-rect with no letterbox, indep `sx≠sy` at 16:9 makes the aperture oval. Overlay still appears once vars are fed; roundness may need a follow-up.
- **`ScopeIcon` string → atlas key:** Plan assumes strip-to-basename (`sniper.tga` → `sniper`). Viewer must resolve that the same way other HUD `variable-picture`s do; mods need a general extract path (report already says this).
- **`CrossHairType` for hip after scope fix:** Optional follow-up; not required for D4. Sniper hip stays off via `CHTNone` / DOM rules.

## Anything the report missed

- Live Radius/Deviation (+0x34/+0x38) vs base defaults (+0x3c/+0x40 = 5.0f) used as multipliers in the HandFireArms HUD feed — irrelevant to scope blackout, relevant if someone later wires procedural hip crosshair from those fields alone.
- `0x006a9750` has additional call sites that also only clear ScopeIndex (spawn/transition paths), not only the submarine/vehicle helper at `0x006d4b50`.
