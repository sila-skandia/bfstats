## Summary

Retail’s tank driver looks through a first-person interior mesh (`1P_Sherman_Gunner_M1`), not a HUD picture or the hull’s exterior: same `DistCompareSelector` / `addLodComparison 0.5` cockpit swap aircraft already use. The HUD is always stretched from an 800×600 virtual space onto the full framebuffer with independent X and Y scale (no letterbox/pillarbox). The viewer already has `Sherman.cockpit.glb` and the landscape stretch formula; it still blanks the soldier group in vehicles, never feeds driver ammo/`ShowTurretIcon`, and its portrait HUD path letterboxes contrary to the engine.

## Findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | The black riveted frame is geometry: `ShermanCockpitInternal` → `1P_Sherman_Gunner_M1`, via `lodShermanCockpit` / `shermancockpitSelector` (`DistCompareSelector`, exterior `Sherman_Canon2_M1` first, interior second, `addLodComparison 0.5`). | confirmed | Parsed `Objects/Vehicles/Land/Sherman/Objects.con`; `reaches_first_person(library,"Sherman")==True`; same pattern as Corsair cockpits |
| 2 | `extract_models.py --cockpit` already produces the asset; no extractor change needed. `viewer/models/Sherman.cockpit.glb` exists (`cockpitSwaps: lodShermanCockpit: ShermanCockpitInternal replaces ShermanCockpitExternal`). | confirmed | `reaches_first_person`; file on disk + report JSON |
| 3 | Driver eye is `ShermanCamera` under `ShermanGunBase`, local pos `(-0.304, 0, 0.06)` after cockpit child pos `(0.234, -0.019, 0.14)`. No `vehicleFov`/`zoomFov`/`useScope` on Sherman (GUN-6). Template `vehicleFov` defaults to `0.0f` (PCO ctor `esi=0` → `+0x248`); `Camera::setVehicleFOV` skips when FOV is 0, so world RenderView FOV applies (ctor default 60° vertical). | confirmed | Objects.con; lnxded `PlayerControlObjectTemplate` ctor `0x083194a0`, `setVehicleFOV` `0x081aadd0`, `getVehicleFov` reads `template+0x248` |
| 4 | Screen mapping (engine): orthographic projection width=800, height=600 (`FUN_006021f0` → `setProjectionType(1)`, `setOrthoWidth(800)`, `setOrthoHeight(600)`, near 0.01, far 1.0), matrix `m00=2/800`, `m11=2/600` (`FUN_008086c9`). Menu root is built as size 800×600 centered at (−400,−300) (`FUN_007eb4f0`). Full-screen D3D viewport ⇒ **no letterbox**. | confirmed | Client decompile/disasm `0x006021f0`, `0x008086c9`, `0x007eb4f0`, `0x0045ede4` pushes 800/600 into `FUN_00603770`; MEME-5 |
| 5 | Mapping formula: `device_x = x * W/800`, `device_y = y * H/600`, `device_w = w * W/800`, `device_h = h * H/600`. At 2542×1440, vehicle HP `(174,525)` → `(552.9, 1260)`; letterbox/pillar predict x≈729. Capture brightness rises at x≈550–560; crosshair centre `(400,300)` → `(1271,720)` is red `(234,38,33)`. | confirmed | Binary + measured `game-tank-1p.png` |
| 6 | No HUD element is exempt: minimap and InGame bars share the same 800×600 space (MEME-13/VHUD-7). | confirmed | Corpus + layout |
| 7 | Viewer `_scaleFor` already does independent stretch when `W/H ≥ 1`; its **portrait letterbox branch is wrong** vs the engine (engine always stretches). Residual ~30 px / ~1.3× defects in evidence are more likely stage-size/CSS than a wrong landscape formula. | confirmed / inferred | `hud.js:286-291`; stage-size note in `in-game-hud.md` |
| 8 | Soldier group stays live in vehicles. `SoldierHud::reset` only zeros pose and restores fallback icon; it does **not** clear `ShowSoldierIcon`. Layout gates `soldierIcon` solely on `ShowSoldierIcon==true`. Capture shows soldier bar + figure beside vehicle bar. Viewer sets `ShowSoldierIcon = onFootActive` and early-returns — that is the defect. | confirmed | `SoldierHud::reset` `0x006e9570`; HUD-3; `hud-layout.json`; `updateSoldierHud` `map.html:5783-5786`; capture |
| 9 | VHUD-10 (static): Sherman root `NumberOfWeaponIcons 2`; primary = `ShermanGunBarrel` (`magSize 30`, `ABAmmoBarReloadBar`, cannon icon); secondary = `Coaxial_Browning` (`magSize 400`, `ABAmmoBarHeatBar`, coax on `c_PIAltFire`). Matches retail `30` / `400`. | confirmed | Weapons.con + Coaxial_Browning Objects.con; capture |
| 10 | VHUD-10 (live): driver’s own FireArms must feed `Ammo/PrimaryAmmoText`, `SecondaryAmmoText`, `Overheat/OverHeat`, `Ammo/ReloadTime(+Secondary)`. Registrars exist (`0x006e8d70`, `0x006ee610`). Viewer only feeds live ammo when `mannedActive()`; `drive()` fires `vehicleGuns` without per-gun `FireState`, so drivetrain root shows icons and no counts. | confirmed (gap) | `feedVehicleHud` comments; capture missing digits |
| 11 | VHUD-9: Sherman sets `setHasTurretIcon 1`. `ShowTurretIcon` is registered beside `ShowVehicleIcon` (`0x006d6500`). Dial should be eligible for a Sherman driver; angle unit/sign/pivot for `IconLookRotation` (`+0x320` in `0x006e10b0`) still unread. Capture crosshair region is busy; dial presence not pixel-proven. | partial | Objects.con; VHUD-1/7; open on angle |
| 12 | Crosshair: root `setCrossHairType CHTCrossHair` (=2). Layout draws `kind=crosshair` when type==2; capture centre is red. Colours come from `CrossHair/CrossHairRed/Green/Blue` (÷256 per layout notes); exact default ints not fully traced this pass. Deviation bound via `CrossHair/Deviation`. | confirmed (type); open (default RGB ints) | Objects.con; VHUD-5; layout; capture RGB |
| 13 | Seat dots: driver’s own seat → `Occupied` state `1` (`Icon_vehicledot_local.tga`) per VHUD-2 table; capture shows blue/local dot on tank icon. `ShowVehiclePlayers` popup not visible in still (timeout 3 s / key — not forced on). | confirmed (table + capture); open (live selector code) | VHUD-2/7; capture |
| 14 | `C` cycles camera view modes (`Camera::setViewMode`, modes 0..0x11). Viewer already has `CAMERA_MODES` incl. cockpit/chase; retail help line matches. | inferred | lnxded `0x081ac7c0`; viewer `flight.js` |

### Screen-mapping formula

```
device_x = virtual_x * screen_width  / 800
device_y = virtual_y * screen_height / 600
device_w = virtual_w * screen_width  / 800
device_h = virtual_h * screen_height / 600
ox = oy = 0
```

Always full-bleed stretch. Not uniform letterbox. Not pillarbox.

### HUD variables a tank driver’s frame needs

| Variable | Retail writer / source | Viewer today |
|---|---|---|
| `Vehicle/ShowVehicleIcon` | Occupancy / vehicle HUD update | fed `true` in `feedVehicleHud` |
| `Vehicle/VehicleIcon` | Seat/root `setVehicleIcon` | fed from seat HUD |
| `Vehicle/VehicleHitPoints` / `Max` | Root Armor (VHUD-8) | fed from root HUD |
| `Vehicle/VehiclePosX/Y1..` | Seat icon positions | via occupied-seat / seat data |
| `Occupied/OccupiedData` | Per-seat team/local table | often unfed (dots may miss) |
| `Vehicle/ShowTurretIcon` | From `hasTurretIcon` (runtime copy unread) | **never fed** |
| `Vehicle/IconLookRotation` | Per-frame float at `+0x320` | **never fed** |
| `Vehicle/ShowVehiclePlayers` + texts | Timed popup | not needed for default strip |
| `Ammo/NumberOfWeaponIcons` | Seat word (`2` on Sherman root) | fed |
| `Ammo/Primary/SecondaryAmmoIcon` | Seat words | fed |
| `Ammo/Primary/SecondaryAmmoBar` | Seat enums | fed |
| `Ammo/PrimaryAmmoText` / `SecondaryAmmoText` | Live FireArms ammo (cannon/coax) | **null for drivetrain** |
| `Overheat/OverHeat` | Coax heat | **null for drivetrain** |
| `Ammo/ReloadTime` (+ Secondary) | Cannon reload fraction | **null for drivetrain** |
| `Soldier/ShowSoldierIcon` | Stays true (file default; reset does not clear) | **forced false in vehicle** |
| `Soldier/SoldierIcon` | reset → standing fallback while seated | not fed in vehicle |
| `Soldier/SoldierHitPoints` / Max / health-bar icons | Player body Armor + `setHealthBarIcons` | early-return skips |
| `CrossHair/ShowCrossHair` | In-game default true | must be written (often missing with other CrossHair/*) |
| `CrossHair/CrossHairType` | Seat `CHTCrossHair` → 2 | must feed from seat HUD |
| `CrossHair/CrossHairRed/Green/Blue` | Registry (÷256) | open defaults |
| `CrossHair/Radius` / `Deviation` | Aim state | partial |

## What the viewer must change

1. **`flight.js` `Vehicle` / tank path** — Keep loading `Sherman.cockpit.glb` (already default). Ensure `setFirstPerson(true)` in cockpit mode actually runs the `CockpitSwap` for `lodShermanCockpit` (interior on, external barrel shroud off). No change to `extract_models.py`. Command that already builds it: `python extract_models.py Sherman --cockpit`.

2. **Camera** — Bind eye to `ShermanCamera` (already intended). FOV ≈ world default (~57–60° vertical); do not invent `vehicleFov`. Hide exterior-only alternatives while 1P; show `1P_Sherman_Gunner_M1`.

3. **`hud.js` `_scaleFor`** — Always `{ sx: W/800, sy: H/600, ox:0, oy:0 }`. Remove portrait letterbox. Verify paint stage size matches the 3D canvas (avoid another stale `stageWidth` / CSS stretch).

4. **`map.html` `updateSoldierHud`** — Keep `Soldier/ShowSoldierIcon = true` while seated; keep feeding HP + health-bar icons from the player body; allow pose to fall back to standing. Do not early-return before soldier health art when `inVehicle`.

5. **`map.html` `drive()` / `feedVehicleHud`** — Give each `vehicleGuns` entry a gated `FireState`. For Sherman root: primary = cannon (30, reload bar), secondary = coax (400, heat). Feed `PrimaryAmmoText`/`SecondaryAmmoText`/`Overheat`/`ReloadTime*` every tick while driving.

6. **Turret dial** — Set `Vehicle/ShowTurretIcon = true` when seat/root has `hasTurretIcon`. Feed `IconLookRotation` only once unit/sign is verified (still open).

7. **Crosshair** — Feed `CrossHair/ShowCrossHair`, `CrossHairType=2`, and RGB so the red `+` appears in the slot (coordinate with R5 on shared `CrossHair/*`).

8. **Seat dots** — Feed `Occupied/OccupiedData` with state `1` for the local driver’s seat.

## Open

- Exact runtime instruction that copies `hasTurretIcon` → `ShowTurretIcon`, and `IconLookRotation` unit/sign/pivot.
- Default integer values of `CrossHairRed/Green/Blue` (capture is clearly red; ÷256 path not fully decompiled).
- Live Occupied selector code path (table known; which comparisons produce friend/enemy).
- Why `Sherman.cockpit.glb` is present yet the mesh capture still lacks the interior (graft timing, `setFirstPerson`, or node-name match) — viewer diagnosis, not missing extract.
- Precise `FireArmsBundle::getAmmo` semantics: demangled `0x08290cd0` looks like vector maintenance; live counts appear to come from `FireArms::getAmmo`→`mags` / `getAmmoInActiveMag` (`0x0828cc00` / `0x0828cbe0`). Full HUD write path from those into `PrimaryAmmoText` not single-step traced this pass; retail numbers still match declaration order + mag sizes.
- Load-bearing but partly inferred: that ShowSoldierIcon remains true solely because reset never clears it (no positive writer found that sets it true on vehicle entry — consistent with VHUD-6 default-true + capture).

## Proposed ledger rows

| id | finding | status | evidence |
|---|---|---|---|
| VHUD-11 | InGame HUD screen map is independent stretch: `x' = x·W/800`, `y' = y·H/600`; ortho 800×600 via `FUN_006021f0` / `FUN_008086c9`; no letterbox | verified | client `0x006021f0`, `0x008086c9`, `0x007eb4f0`; capture 2542×1440 vs letterbox prediction |
| VHUD-10 | Sherman driver: primary `ShermanGunBarrel` mag 30 + reload bar; secondary `Coaxial_Browning` mag 400 + heat; both feed ammo text/heat/reload | verified (static); working (live feed required) | Weapons.con; Coaxial Objects.con; capture 30/400 |
| VHUD-12 | Soldier HUD group remains visible in vehicles: `ShowSoldierIcon` not cleared by `SoldierHud::reset`; pose→standing fallback | verified | `0x006e9570`; layout gate; capture |
| TANK-VIEW-1 | Tank 1P frame is cockpit mesh `1P_*` via DistCompareSelector 0.5, same as aircraft; Sherman `reaches_first_person` true; `--cockpit` sufficient | verified | Objects.con; assemble.py; `Sherman.cockpit.glb` |
| TANK-VIEW-2 | Sherman driver FOV = default RenderView (template `vehicleFov` 0.0; setVehicleFOV no-ops) | verified | lnxded ctor `esi=0`→`+0x248`; `Camera::setVehicleFOV` |
| VHUD-9 | `setHasTurretIcon 1` on Sherman enables dial eligibility; `IconLookRotation` convention still open | partial | Objects.con; prior VHUD-9 |

---

### Scripts (scratch prefix `r4_`)

**`/tmp/r4_scratch/r4_sherman_cockpit.py`**

```python
#!/usr/bin/env python3
"""Survey Sherman for first-person / cockpit geometry and HUD words."""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, "/home/dylan/projects/skandia/bfstats/tools/bf1942-models")
from bf42 import con as con_mod
from bf42.assemble import reaches_first_person, geometry_is_first_person
import extract_models as em

TANKS = [
    "Sherman", "PanzerIV", "Chi-Ha", "ChiHa", "M10", "Stuart", "Tiger", "T34",
    "Churchill", "Willy", "Corsair", "Spitfire", "bf109",
]

def main() -> None:
    game_dir = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
    chain = em.mod_chain(game_dir, "bf1942")
    print("mod chain:", [p.name for p in chain])
    meshes, textures, objects, game = em.build_pools(chain, [])
    print(f"object names: {sum(1 for _ in objects.names())}")
    library = em.build_library(objects)
    print(f"templates: {len(library.objects)}")

    print("\n=== reaches_first_person ===")
    for name in TANKS:
        t = library.object(name)
        if t is None:
            print(f"  {name}: NOT FOUND")
            continue
        fp = reaches_first_person(library, name)
        print(f"  {name}: type={t.kind!r} geom={t.geometry!r} reaches_fp={fp} nchildren={len(t.children)}")

    print("\n=== Sherman walk ===")
    def walk(name: str, depth: int = 0, stack: frozenset[str] = frozenset()) -> None:
        if depth > 12 or name.lower() in stack:
            return
        t = library.object(name)
        if t is None:
            print("  " * depth + f"{name} MISSING")
            return
        fp_g = geometry_is_first_person(t.geometry)
        lod = getattr(t, "lod_selector", None)
        lod_s = ""
        if lod is not None:
            kind = getattr(lod, "kind", getattr(lod, "type", type(lod).__name__))
            lod_s = f" lod={kind}"
        print("  " * depth + f"{name} kind={t.kind} geom={t.geometry} fp={fp_g}{lod_s}")
        for ref in t.children:
            child = con_mod.instance_template_name(ref, library.object)
            if child:
                walk(child, depth + 1, stack | {name.lower()})
    walk("Sherman")

    print("\n=== 1P geometries tank/interior/cockpit ===")
    count_1p = 0
    hits = []
    for t in library.objects.values():
        if geometry_is_first_person(t.geometry):
            count_1p += 1
            g = (t.geometry or "").lower()
            n = t.name.lower()
            if any(s in n or s in g for s in (
                "sherman", "panzer", "tank", "tiger", "chi", "stuart", "m10",
                "churchill", "katyusha", "interior", "cockpit",
            )):
                hits.append((t.name, t.geometry))
    print(f"total 1P: {count_1p}; tankish: {len(hits)}")
    for n, g in sorted(hits):
        print(f"  {n}: {g}")

if __name__ == "__main__":
    main()
```

**`/tmp/r4_scratch/r4_hud_measure.py`**

```python
#!/usr/bin/env python3
"""Measure game-tank-1p.png against independent-stretch vs letterbox predictions."""
from PIL import Image
import numpy as np

game = np.asarray(Image.open(
    "/home/dylan/bfstats-evidence/viewer-defects-2026-09-16/game-tank-1p.png"))
H, W = game.shape[0], game.shape[1]
print("size", W, H)

def indep(x, y):
    return x * W / 800, y * H / 600

def letterbox(x, y):
    s = min(W / 800, H / 600)
    return (W - 800 * s) / 2 + x * s, (H - 600 * s) / 2 + y * s

for name, fn in [("indep", indep), ("letterbox", letterbox)]:
    print(name, "vehicleHP(174,525)", fn(174, 525))

x, y = map(int, indep(400, 300))
print("crosshair centre", x, y, "rgb", game[y, x, :3])
```

**Corpus check:** `./xref.py check` → sha256 `60c9452d…` **MATCH** before client claims.
