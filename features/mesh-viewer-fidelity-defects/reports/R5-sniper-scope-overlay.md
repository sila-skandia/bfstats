## Summary

Retail turns the sniper (and binocular) overlay on inside `FireArms::setZoom` by writing `CrossHair/ScopeIndex` to **1** when the weapon’s `useScope` flag is set, and back to **0** on unzoom. The blackout is the opaque exterior of the weapon’s `setScopeIcon` texture (vanilla `sniper.tga` / `binocular.tga`), already extracted for the rifle as `sniper.png`; sight lines are layout fills gated by `CrossHair/SniperSight`. The viewer already paints that layout group and already hides the 1P rig when scoped — it never writes any `CrossHair/*` vars, so `_visible` culls the whole group.

## Findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | `CrossHair` HUD object is created on the client HUD singleton (`DAT_00a5f1a8` slot +0x1c), ctor `0x006e9d30`, `registerVariables` `0x006e9a60`. Fields: `ShowCrossHair` +0x08 (default 1), `CrossHairType` +0x0c, `ScopeIndex` +0x30 (default 0), `Radius` +0x34, `Deviation` +0x38, `CrossHairIcon` path +0x10 / handle +0x2c, `ScopeIcon` path +0x44 / handle +0x60, `SightIcon` path +0x64 / handle +0x80, `SniperSight` +0x84, `ShowCenterPoint` +0x85 (default 1). | confirmed | asm of `0x006e9a60` / `0x006e9d30`; string xrefs at `0x00926068`–`0x009260e0` |
| 2 | **`ScopeIndex` is a 0/1 zoom-overlay flag, not a texture-table index.** `FireArms::setZoom` `0x005391b0`, when `useScope` (template +0x3d8 off the `+0x4c` pointer) is true, calls HUD `0x006a9b20(1)` which stores **1** at `CrossHair+0x30` on both SoldierHud’s and AmmoHud’s CrossHair pointers; unzoom calls `0x006a9b20(0)`. Texture choice is the `ScopeIcon` string, not the index. | confirmed | objdump `0x00539233`–`0x00539319`; `0x006a9b20` |
| 3 | Generic setter `0x006a9750(value)` can write any int to `ScopeIndex`, but the only caller found (`0x006d4b50`) passes **0**. No `setZoom` path writes 2+. | confirmed | decompile `0x006a9750`, `0x006d4b50`; xrefs |
| 4 | Weapon → HUD sync `0x006e9dd0` (from SoldierHud feed `0x006e9690`) copies template: `CrossHairType` ← +0x474, `CrossHairIcon` ← +0x478, `ScopeIcon` ← +0x494, `SightIcon` ← +0x4b0, `SniperSight` ← +0x4cc. | confirmed | decompile `0x006e9dd0`; asm `0x006e96d0` |
| 5 | `.con` words: `useScope`, `setSniperSight`, `setScopeIcon`, `setSightIcon` (property ctors `0x004d2d50`, `0x004d3970`, `0x004d34d0`, `0x004d3720`). | confirmed | string xrefs; property vtables |
| 6 | Vanilla `No4Sniper` / `K98Sniper`: `useScope 1`, `setSniperSight 1`, `setScopeIcon "sniper.tga"`, `zoomFov 0.1`, `unZoomBetweenFireTime 3.0`, `altFireOnce 1`, `setCrossHairType CHTNone`. `Binoculars`: `useScope 1`, `setSniperSight 0`, `setScopeIcon "binocular.tga"`, `setSightIcon "scout_ring_128x128.tga"`, `zoomFov 0.2`. | confirmed | `menu.rfa` / Objects.con via ArchivePool |
| 7 | Across installed mods, **140** hand-weapon cons set useScope/scopeIcon/sniperSight; many custom `*.tga` names. `SniperSight 1` ⇒ rifle sight-line fills; `0` ⇒ ring via `SightIcon`. Contract (`ScopeIndex` / `SniperSight` / `ScopeIcon`) matches in every mod whose `menu.rfa` embeds `ScopeIndex` (bf1942, FH, FHSW, bg42, bf1918, GCMOD, DesertCombat, …). | confirmed | `/tmp/r5_scope_survey.sh` |
| 8 | `sniper.png` is **256×256 RGBA**; corners `(0,0,0,255)`; centre alpha **0** (world shows through). Blackout is the texture, not fill quads. Layout element 3 rect `(-8,-2,825,625)` with atlas key `sniper` / var `CrossHair/ScopeIcon`. | confirmed | PIL on shipped PNG; `hud-layout.json` |
| 9 | HUD stage mapping in `hud.js` `_scaleFor`: landscape **independent** `sx=W/800`, `sy=H/600` (same family as README vehicle-bar measurement). Element 3 deliberately overscans virtual 800×600. Whether `PictureNode` letterboxes the square TGA inside that rect (needed for a strictly round hole under widescreen indep stretch) was **not** finished in the draw path — see Open. | confirmed / open | `hud.js:285–291`; README; incomplete `PictureNode::draw` |
| 10 | Zoom input: soldier input bit **0x20** → `setZoom(1/0)` at `0x004f76d0`. Vanilla weapons use `altFireOnce 1` (toggle). `UnZoomBetweenFireTime` path calls `setZoom(0)` (`0x00539c80`), which also clears `ScopeIndex`. | confirmed | decompile `0x004f76d0`, `0x00539c80` |
| 11 | Hip↔zoom ease (already in corpus VIEW): position **25% of remaining per visual frame**; FOV `0.7·cur+0.3·target`. Camera mode when `isZoomed && useScope` → `(0,2)` — 1P weapon not shown in retail scoped capture; viewer already sets `hw.rig.visible = !(scope && zoomed)`. | confirmed | `handweapon-view-and-deviation.md`; `map.html:5578–5580`; evidence |
| 12 | Viewer defect cause: `updateSoldierHud` never writes `CrossHair/*`; `hud.js` comment at `_drawCrosshair` states the group is culled. Zoom FOV path already works. DOM `#crosshair` is a separate hip UI. | confirmed | `map.html` `updateSoldierHud`; `hud.js:502–506`; `mesh-sniper-zoom.png` vs `game-sniper-zoom.png` |
| 13 | Atlas has `sniper` and `scout_ring_128x128`; **`binocular.tga` is in `menu.rfa` (262188 bytes) but not in the HUD pack** (only `icon_binoculars` kit icon). | confirmed | `hud.json`; ArchivePool |
| 14 | `ShowCrossHair` defaults true; sniper hip uses `CHTNone` so hip DOM/layout crosshair stays off; scoped overlay gates on `ScopeIndex != 0` only (plus ShowCrossHair and not periscope). | confirmed | layout `when` clauses; ctor default |

### `CrossHair/*` variable table (writer / viewer values)

| Variable | Retail writer | Rifle scope (zoomed) | Binoculars (zoomed) | Neither (hip / unzoomed) |
|---|---|---|---|---|
| `ShowCrossHair` | default 1; hide/show slots `0x006ea960` / `0x006ea690` | `true` | `true` | `true` (still; type gates hip art) |
| `ScopeIndex` | `setZoom` → `0x006a9b20` | **`1`** | **`1`** | **`0`** |
| `SniperSight` | template +0x4cc via `0x006e9dd0` | **`true`** | **`false`** | irrelevant if index 0 |
| `ScopeIcon` | template +0x494 via `0x006e9dd0` / `0x006e9090` | atlas/`sniper` (`sniper.tga`) | needs `binocular` extract | unused |
| `SightIcon` | template +0x4b0 | unused when SniperSight | `scout_ring_128x128` | unused |
| `CrossHairType` | template +0x474 | `0` (CHTNone) | typically None | weapon’s CHT* for hip |
| `CrossHairIcon` | template +0x478 | unused when scoped | unused | path for CHTIcon |
| `ShowCenterPoint` | default 1 | n/a for scope fills | centre fill when !SniperSight | for CHTCrossHair + centre |
| `Radius` / `Deviation` | HandFireArms path in `0x006e9690` | n/a for scope picture | n/a | procedural crosshair |
| `Submarine/ShowPeriscope` | submarine HUD (VHUD-5) | **`false`** | **`false`** | false on foot |

## What the viewer must change

**Minimum change (one paragraph):** In `map.html` `updateSoldierHud()` (same once-per-rendered-frame place as other HUD vars, immediately before `gameHud.paint()`), when on foot with a hand weapon: if `isZoomed() && hw.data.zoom.scope` (`useScope`), set `CrossHair/ShowCrossHair=true`, `CrossHair/ScopeIndex=1`, `CrossHair/SniperSight=!!hw.data.zoom.sniperSight`, `CrossHair/ScopeIcon` to the atlas key derived from `hw.data.zoom.icon` (strip path/quotes; vanilla → `sniper`), and if not sniperSight set `CrossHair/SightIcon` from `setSightIcon` / default `scout_ring_128x128`; always set `Submarine/ShowPeriscope=false` on foot; when not scoped set `ScopeIndex=0` and feed `CrossHairType` / icon for the existing DOM or layout hip crosshair. Keep hiding the 1P rig when scoped (already done). After the layout group is fed, hide the DOM `#crosshair` whenever `ScopeIndex!=0` (already roughly true) and prefer retiring DOM hip crosshair in favour of the layout group once `CrossHairType`/`CrossHairIcon`/`Radius`/`Deviation` are fed — `_drawCrosshair` need not be a traced `BfCrosshairNode` clone for the scope defect; the scope path is `variable-picture` + fills, not that node.

File-level:

1. **`map.html` — `updateSoldierHud`:** write the vars above; clear `ScopeIndex` on holster/reload/unzoom (already clears `hw.zoomed`).
2. **`map.html` — DOM `#crosshair`:** keep hidden while scoped; after full `CrossHair/*` feed, stop using DOM for hip and let `hud.js` draw CHTIcon/CHTCrossHair (optional follow-up).
3. **`extract_hud_pack.py` / pack:** add `binocular.tga` → `binocular.png` + atlas entry (mods need a general “resolve ScopeIcon string → texture” path).
4. **`hud.js`:** no painter change required for the rifle if vars are set; confirm `variable-picture` resolves `ScopeIcon` string the same way other HUD pictures do.
5. **Aspect:** keep current `_scaleFor` indep stretch (aligned with vehicle HUD evidence). If the scope hole goes oval at 16:9 after the feed, then and only then special-case picture aspect — do not invent a second stage mapping first.

## Open

- Whether `PictureNode` / the scope `variable-picture` **letterboxes** the square TGA inside `(-8,-2,825,625)` so the aperture stays round under widescreen independent stretch. Independent stretch is confirmed for other HUD; a non-letterboxed stretch-to-rect of a square into 825×625 is already non-square in virtual space. Load-bearing for “looks like retail at 16:9”; not load-bearing for “overlay appears at all.”
- Exact binding of input bit 0x20 to the keyboard/mouse action name in the control map file (behaviour is toggle via `altFireOnce` / right-aim — viewer already matches).
- Whether any retail path sets `ScopeIndex` to values other than 0/1 (none found on `setZoom`; `0x006a9750` unused for nonzero).
- Mod `menu.rfa` files that omit or replace the crosshair group (DC_Final / XPack1 search did not find `ScopeIndex` in the same way) — viewer may need per-mod layout later; variable names appear stable where present.
- Full `BfCrosshairNode::draw` trace for the procedural hip crosshair (not required to fix D4).

## Proposed ledger rows

| id | finding | status | evidence |
|---|---|---|---|
| SCOPE-1 | `CrossHair/ScopeIndex` is written 0/1 by HUD `0x006a9b20` from `FireArms::setZoom` when `useScope`; it selects overlay vs hip, not a texture slot | verified | `0x005391b0`, `0x006a9b20`, layout gates |
| SCOPE-2 | `ScopeIcon` / `SightIcon` / `SniperSight` / `CrossHairType` are copied from HandFireArms template offsets +0x494 / +0x4b0 / +0x4cc / +0x474 by `0x006e9dd0` | verified | `0x006e9dd0`, `0x006e9690` |
| SCOPE-3 | `setSniperSight 1` ⇒ sight-line fills; `0` + `setSightIcon` ⇒ binocular ring branch | verified | vanilla Binoculars/No4Sniper cons; layout elements 4–9 |
| SCOPE-4 | Scope blackout is opaque alpha of `sniper.tga` (256²), not HUD colour fills | verified | `sniper.png` pixels; layout element 3 |
| SCOPE-5 | Viewer D4 is missing `CrossHair/*` writes in `updateSoldierHud`; art/layout/painter already present for the rifle | verified | `map.html`, `hud.js:505`, evidence PNGs |

---

### Scripts (scratch prefix `r5_`)

**`/tmp/r5_scope_survey.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import sys
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, "/home/dylan/projects/skandia/bfstats/tools/bf1942-models")
from bf42.rfa import ArchivePool

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
rows = []
menu_rfas = []
scope_textures = defaultdict(list)

for mod_dir in sorted(MODS.iterdir()):
    if not mod_dir.is_dir():
        continue
    mod = mod_dir.name
    archives = mod_dir / "Archives"
    if not archives.is_dir():
        continue
    pool = ArchivePool()
    for rfa in sorted(archives.glob("*.rfa")):
        try:
            pool.add(rfa, rfa.name)
        except Exception:
            pass
        if rfa.name.lower() == "menu.rfa":
            menu_rfas.append((mod, str(rfa)))
    for name in pool.names():
        ln = name.lower().replace("\\", "/")
        if not ln.endswith(".con"):
            continue
        if "handweapon" not in ln and "handweapons" not in ln and "/weapons/" not in ln:
            if "objects/" not in ln:
                continue
            if "hand" not in ln and "binocular" not in ln and "sniper" not in ln:
                continue
        try:
            text = pool.read(name).decode("latin-1", "replace")
        except Exception:
            continue
        low = text.lower()
        if not any(k in low for k in ("usescope", "setscopeicon", "setsnipersight", "zoomfov")):
            continue
        info = {"mod": mod, "file": name, "useScope": None, "sniperSight": None,
                "scopeIcon": None, "sightIcon": None, "zoomFov": None,
                "crossHairType": None}
        for line in text.splitlines():
            s = line.strip()
            if not s or s.startswith("//"):
                continue
            parts = s.split(None, 1)
            if len(parts) < 2:
                continue
            cmd = parts[0].lower()
            if "." in cmd:
                cmd = cmd.split(".", 1)[-1]
            args = parts[1].strip()
            if cmd == "usescope":
                info["useScope"] = args.split()[0] if args else "1"
            elif cmd == "setsnipersight":
                info["sniperSight"] = args.split()[0] if args else "1"
            elif cmd == "setscopeicon":
                tok = args.strip().strip('"')
                info["scopeIcon"] = tok.split()[0] if tok else None
                if info["scopeIcon"]:
                    scope_textures[info["scopeIcon"].lower()].append(f"{mod}:{name}")
            elif cmd == "setsighticon":
                tok = args.strip().strip('"')
                info["sightIcon"] = tok.split()[0] if tok else None
            elif cmd == "zoomfov":
                info["zoomFov"] = args.split()[0]
            elif cmd == "setcrosshairtype":
                info["crossHairType"] = args.split()[0]
        if info["useScope"] or info["scopeIcon"] or info["sniperSight"]:
            rows.append(info)

print(f"weapons={len(rows)} menu.rfa_mods={len(menu_rfas)}")
for r in sorted(rows, key=lambda x: (x["mod"], x["file"])):
    print(r)
print("scopeIcons:", sorted(scope_textures))
PY
```

**`/tmp/r5_texture_geom.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from PIL import Image

sniper = Path("/home/dylan/projects/skandia/bfstats/tools/bf1942-models/viewer/maps/_shared/hud/sniper.png")
img = Image.open(sniper)
print(f"sniper.png: size={img.size} mode={img.mode}")
px = img.load()
w, h = img.size
for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, h // 2)]:
    print(f"  ({x},{y}) = {px[x, y]}")

def is_mask(p):
    r, g, b, a = p
    return a > 200 and r < 40 and g < 40 and b < 40

row = h // 2
inside = [not is_mask(px[x, row]) for x in range(w)]
left = next(i for i, v in enumerate(inside) if v)
right = w - 1 - next(i for i, v in enumerate(reversed(inside)) if v)
print(f"center-row clear span: {left}..{right} diameter={right - left}")
PY
```

**`/tmp/r5_menu_crosshair.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, "/home/dylan/projects/skandia/bfstats/tools/bf1942-models")
from bf42.rfa import ArchivePool

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
for mod in ["bf1942", "FH", "DesertCombat", "DC_Final", "FHSW", "XPack1", "bg42", "bf1918", "GCMOD"]:
    archives = MODS / mod / "Archives"
    menu = next((p for p in archives.glob("*.rfa") if p.name.lower() == "menu.rfa"), None)
    if not menu:
        print(f"{mod}: no menu.rfa")
        continue
    pool = ArchivePool()
    pool.add(menu, menu.name)
    has_scopeindex = False
    for n in pool.names():
        if "ingame" not in n.lower().replace("\\", "/"):
            continue
        try:
            data = pool.read(n)
        except Exception:
            continue
        if b"ScopeIndex" in data:
            has_scopeindex = True
            break
    tex = [n for n in pool.names() if n.lower().endswith("sniper.tga") or n.lower().endswith("binocular.tga")]
    print(f"{mod}: ScopeIndex={has_scopeindex} tex={[t.split('/')[-1] for t in tex]}")
PY
```

**Corpus check:** `./xref.py check` → sha256 `60c9452d…` **MATCH** before client claims.
