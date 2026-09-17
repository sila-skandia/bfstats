## Summary

A bolt-action sniper shot is not a looping fire clip: the engine enters `Ub_Fire*` (`c_AsmPlayOnce`, 1.0 s), then **always** transitions into `Ub_StandReload*` (1.67 s) — the same body clip as a magazine reload — because `AnimationStatesShoot.con` explicitly wires `addTransitionWhenDone Ub_StandReload…` for No4/K98 and their sniper clones. The viewer plays only `fire`, clamps the dipped end pose for `1/roundOfFire` (~3.33 s), and never chains to reload; that is the awkward dip. Rifle projectiles are `invisible 1` (no drawn body); the viewer still draws a dim eye-line “tracer” for every hand-weapon shot. The 1P muzzle flash is `e_MuzzGun` / `fx_1p_MuzzGun` at **size 0.2**, **TTL 0.07 s**, on the `e_MuzzGun` child at `0/0.045/0.745` (No4 family).

## Findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Per standing shot: `Ub_FireNo4Sniper` → `Ub_StandReloadNo4Sniper` → `_POSE_` (aim). Same pattern for K98Sniper / No4 / K98. Comment in data: `rem No4 - Trigger reload after fire`. | confirmed | `animations/AnimationStatesShoot.con`; `bf42/animstates.py` parse: fire `returnTo=Ub_StandReload*`, `loop=c_AsmPlayOnce`, `morph=10000` |
| 2 | Fire and reload are **different** 1P clips (`1PFireNo4.baf` 11 frames @ speed 1.0 → 1.0 s; `1PReloadNo4.baf` 99 frames @ 0.6 → 1.667 s). User’s “looks like reload” is the **post-fire StandReload state**, not the fire clip path. | confirmed | archive BAFs + state machine |
| 3 | Thompson fire **is** looping (`c_AsmLooping`, speed 10, span 0.1 s, `returnTo=_POSE_`). Bolt rifles must not inherit that rule. | confirmed | `Ub_FireThompson` vs `Ub_FireNo4Sniper` |
| 4 | `extract_viewmodel.py` hardcodes `("fire", "Fire", True)` (always loop) and does not encode fire→reload chaining; extras still carry `returnTo`. | confirmed | `extract_viewmodel.py` FAMILIES / `resolve_families` |
| 5 | Viewer: on shot plays `fire` once, sets `cool = 1/roundOfFire`, keeps clamped fire while `cool > 0`; reload only on mag change / R. | confirmed | `map.html` `guns.onShot` ~5486–5489, `updateViewmodelAnimation` ~5315–5318 |
| 6 | `No4Sniper`/`K98Sniper`: `roundOfFire 0.3`, `reloadtime 1.6`, `fireOnce 1`, `magSize 5`, `numOfMag 3`. Plain No4/K98: `roundOfFire 0.37`. Period `1/0.3 ≈ 3.33 s` fits fire (1.0) + reload (1.67) + slack. | confirmed (data); ROF unit in binary partially open | `Objects/HandWeapons/{No4,K98}/Objects.con`; viewer `1/rof` |
| 7 | While scoped: `useScope 1`, `zoomFov 0.1`, `unZoomBetweenFireTime 3.0` — firing unzooms for 3 s (ZOOM-2). Viewer already hides the rig when scoped (`rig.visible = !(scope && zoomed)`). Fire/reload play after unzoom in hip view. | confirmed | Objects.con; ledger ZOOM-2; `map.html` ~5578–5580, ~5490–5494 |
| 8 | `no4Projectile` / `k98Projectile`: geometry `bullet_m1` but **`invisible 1`**, TTL 1 s, gravity 0, no tracer words. Retail draws no rifle round body. | confirmed | `Objects/HandWeapons/Common/Weapons.con`; `assemble.py` already skips invisible bodies |
| 9 | Viewer defect (1): for `kind === 'bullet'` with `aimRay` (hand weapons), `gunfire.js` spawns a **dim tracer every shot** even with no tracer interval. | confirmed | `gunfire.js` 545–554 |
| 10 | Muzzle: `e_MuzzGun` at `0/0.045/0.745` (No4/No4Sniper), `startoneffects 0`. Bundle: 3P `em_MuzzGun`→`fx_MuzzGun2` (geom `muzzGun_m1`, TTL 0.07); 1P `em_1P_MuzzGun` `showInFirstPerson 1`→`fx_1p_MuzzGun` geom `e_muzzGun_m1`, **size 0.2**, TTL 0.07; emitter TTL 0.1, intensity 10, `startRotation` uniform 0–180°. Glow is **3P only**. | confirmed | `Objects/Effects/e_MuzzGun/Effects.con`; weapon Objects.con |
| 11 | Shell eject `e_Shell792D` / `e_shell792D` at grip (`0/0.03/0.39`), `startoneffects 1`; 1P emitter has **delay 2.0 s** — not the instantaneous speck. | confirmed | Effects.con + Objects.con |
| 12 | Weapon-channel `WeaponFire*Sniper` cites `No4Fire.baf` — **file absent** from `animations.rfa`. `WeaponReloadNo4Sniper` cites `No4SniperReload.baf` — **also absent**; K98 reload channel uses existing `No4Reload.baf` (bone `Load`, 99 frames). Body clips still drive the visible motion. | confirmed | archive listing |
| 13 | Fire clip motion is rotational (R UpperArm end-vs-start ~89°, R Hand ~64°). Clamping the last fire frame holds a dipped pose — matches the “dip” if reload never follows. | confirmed | BAF quat deltas |
| 14 | Sniper fire camera shake (not the No4 rifle set): pitch layer0 `0 2.0 10`, fadeOut `4.0`; layer1 pitch `0.1/1.0`, yaw `-0.03/2.3`. Passed at factor 1.0 (CS-6). | confirmed | `AnimationStatesCameraShakes.con` |
| 15 | No4Sniper has **no** `setFireDev` / `setMinDev` / `setRecoilForce*` (unlike No4). Deviation is speed/misc only; fire bloom is zero. | confirmed | Objects.con |
| 16 | Rest pose extras: `center1pHands -0.12/-1.56/0.1`, `set1pFov 0.47`; No4Sniper `soldierCameraPosition -0.03/-0.04/0.1`, `soldierZoomPosition 0.1/0/0`, `soldierZoomFov 0.6`. Hip FOV large vs world still open (VIEW-9); placement mismatch is consistent with wrong FOV and/or mount, not a separate anim bug. | confirmed (fields); placement prediction open | CommonSoldierData.inc; Objects.con; VIEW-9 |

### 1P animation table (fire / reload / aim / deploy — both rifles)

| State | Clip (1P) | speed | span (s) | loop | morph | returnTo | weapon channel |
|---|---|---|---|---|---|---|---|
| Ub_FireNo4Sniper | 1PFireNo4.baf | 1.0 | 1.000 | c_AsmPlayOnce | 10000 | Ub_StandReloadNo4Sniper | WeaponFireNo4Sniper → No4Fire.baf (MISSING) |
| Ub_StandReloadNo4Sniper | 1PReloadNo4.baf | 0.6 | 1.667 | c_AsmPlayOnce | 10000 | _POSE_ | WeaponReloadNo4Sniper → No4SniperReload.baf (MISSING) |
| Ub_StandAimNo4Sniper | 1PStandAimNo4.baf | 0.1 | 10.0 | 1 | 0.7 | self | — |
| Ub_StandRaiseWeaponNo4Sniper | 1PDeployNo4.baf | 1.0 | 1.000 | c_AsmPlayOnce | 10000 | _POSE_ | — |
| Ub_LieFireNo4Sniper | 1PLieFireNo4.baf | 1.0 | 1.000 | c_AsmPlayOnce | 10000 | Ub_LieReloadNo4Sniper | — |
| Ub_FireK98Sniper | 1PFireK98.baf | 1.0 | 1.000 | c_AsmPlayOnce | 10000 | Ub_StandReloadK98Sniper | WeaponFireK98Sniper → No4Fire.baf (MISSING) |
| Ub_StandReloadK98Sniper | 1PReloadK98.baf | 0.6 | 1.667 | c_AsmPlayOnce | 10000 | _POSE_ | WeaponReloadK98Sniper → No4Reload.baf (OK, Load) |
| Ub_StandAimK98Sniper | 1PStandAimK98.baf | 0.1 | 10.0 | 1 | 0.7 | self | — |

Full Ub_* / Weapon* enumeration for both weapons is in `/tmp/r2_scratch/r2_finish_out.txt` (script below).

### Muzzle / projectile numbers (diff vs viewer)

| Item | Engine / data | Notes for viewer |
|---|---|---|
| Flash bundle | `e_MuzzGun` | Attach at weapon child pos `0/0.045/0.745` (No4*), `0/0.05/0.84` (K98*) |
| 1P emitter | `em_1P_MuzzGun`, TTL 0.1, intensity 10, startRotation 0–180°, showInFirstPerson | First spawn at t=0 (EMT-2) |
| 1P particle | `fx_1p_MuzzGun`, geom `e_muzzGun_m1`, **size 0.2**, TTL **0.07**, sizeModifier 1/1/1 | Must not use 3P mesh/size |
| 3P particle | `fx_MuzzGun2`, geom `muzzGun_m1`, TTL 0.07 (no size word) | |
| Glow | `fx_MuzzGun_glow` size 0.12, TTL 0.07, **third person only** | |
| Projectile | `no4Projectile` / `k98Projectile`, invisible 1, TTL 1, gravity 0, material 218/219 | **Draw nothing** |
| Velocity (weapon) | No4Sniper/K98Sniper `velocity 2000`; No4/K98 `1000` | Ballistic speed, not a mesh |
| Shell casing | `e_Shell792D`, delay 2.0 on emitters | Not the instant speck |

### Single shot, first 0.5 s (hip, after any unzoom)

| t (s) | State / systems | What moves |
|---|---|---|
| 0.00 | Enter `Ub_Fire*` (cut, morph 10000); spawn 1P muzzle burst; spawn invisible projectile; apply sniper fire shake; start ROF cooldown (~3.33 s); if was scoped, start 3.0 s unzoom | Arms: 1PFire*; flash at muzzle size 0.2 for ≤0.07 s |
| 0.00–0.50 | Still in fire one-shot (span 1.0 s) | Large arm rotation (recoil), not a lower “dip-and-hold” |
| 1.00 | Fire phase > 1 → `Ub_StandReload*` | Same motion family as mag reload; weapon `Load` bone if clip present |
| 1.00–2.67 | StandReload @ 0.6 | Bolt / cycle |
| 2.67 | Reload done → aim (`_POSE_`) | Idle aim sway |
| ~3.33 | ROF gate clears | Next shot allowed |

(If still scoped at trigger: unzoom runs first; weapon was hidden while scoped.)

## What the viewer must change

1. **`map.html` / viewmodel state machine** — On bolt / `fireOnce` (or whenever extras `returnTo` is a reload state): after fire one-shot finishes, play `reload` (do not hold clamped fire for the whole `cool`). Keep mag-empty / R reload as today. Honour `clips.fire.loop === false` and `returnTo`.
2. **`extract_viewmodel.py`** — Set fire `loop` from the state’s `c_AsmPlayOnce` / `c_AsmLooping`, not hardcoded `True`. Bake / document `returnTo` for implementers (already in extras).
3. **`gunfire.js`** — For `kind === 'bullet'` with no tracer interval: **do not** spawn the dim `aimRay` stand-in streak. Invisible projectiles stay collision-only.
4. **`effects` / flash path** — Ensure 1P uses `em_1P_MuzzGun` / `fx_1p_MuzzGun` with **size 0.2**, TTL 0.07, attached to the `e_MuzzGun` node at the authored offset — not the grip stub, not 3P-sized geom, not lingering past ~0.1 s.
5. **Shake** — Drive sniper fire shake from `Ub_FireNo4Sniper` / `Ub_FireK98Sniper` camera-shake rows (not Thompson’s tiny shake, not No4’s full set alone).
6. **Optional** — Re-check hip mount with `center1pHands + soldierCameraPosition` under both FOV modes (`?fov1p=world` vs default); cornered rifle in mesh-hip is likely FOV/mount, secondary to the fire→reload chain.

## Open

- Exact binary mapping of `roundOfFire` → cooldown: Fire stores `3.14 / template[+0x1e4]` at `+0x250`; whether `+0x1e4` is `roundOfFire` is unverified. Data + viewer `1/rof` match gameplay timing comments (`0.37 → 2.7 s`); treat π-division as verifier work.
- Predicted screen position of No4Sniper under both FOV states vs `game-sniper-hip.png` (measurement not completed to pixel error).
- Whether missing `No4Fire.baf` / `No4SniperReload.baf` means retail skips weapon-channel parts entirely for those states (body-only) — likely yes; no alternate path found in the archive.
- Flash “left of muzzle / 40% width” in mesh capture: attachment vs size vs wrong emitter — engine numbers above; X1 should confirm which viewer path is live.

## Proposed ledger rows

| id | finding | status | evidence |
|---|---|---|---|
| ANIM-7 | Bolt-action / single-shot rifles chain `Ub_Fire*` → `Ub_StandReload*` via `addTransitionWhenDone`; fire is `c_AsmPlayOnce`, not looping | verified | `AnimationStatesShoot.con` (“Trigger reload after fire”); animstates parse; contrast Thompson `c_AsmLooping` |
| ANIM-8 | Per-shot bolt cycle body clip is `Ub_StandReload*`, same as magazine reload; fire clip is a separate shorter one-shot | verified | clip paths + spans 1.0 s / 1.667 s |
| GUN-10 | `no4Projectile`/`k98Projectile` are `invisible 1`; client must not draw a body or stand-in streak | verified | Common/Weapons.con; gunfire.js aimRay dim-tracer is a viewer bug |
| EMT-6 | Hand-rifle 1P muzzle flash is `e_MuzzGun`→`em_1P_MuzzGun`→`fx_1p_MuzzGun` size 0.2 TTL 0.07; 3P glow not in 1P | verified | e_MuzzGun/Effects.con |
| ZOOM-3 | Snipers set `unZoomBetweenFireTime 3.0`; scoped 1P weapon is not shown (viewer hides; overlay is R5) | verified | Objects.con; map.html hide; ZOOM-2 |
| CS-7 | Sniper fire shake authored on `Ub_FireNo4Sniper`/`K98Sniper` (pitch 2.0/10 + fade 4.0 + secondary pitch/yaw), distinct from Ub_FireNo4 | verified | AnimationStatesCameraShakes.con |

---

### Scripts (scratch prefix `r2_`)

Primary finish script used for tables/fields:

```python
#!/usr/bin/env python3
"""R2 finish: remaining numbers for the report."""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

ROOT = Path("/home/dylan/projects/skandia/bfstats")
sys.path.insert(0, str(ROOT / "tools/bf1942-models"))
from bf42.rfa import ArchivePool
from bf42.animstates import parse as parse_asm
from bf42 import baf as bafmod

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
pool = ArchivePool()
for rfa in sorted((MODS / "bf1942" / "Archives").glob("*.rfa")):
    try:
        pool.add(rfa, rfa.name)
    except Exception:
        pass

def read(path: str) -> str | None:
    try:
        d = pool.read(path)
    except Exception:
        return None
    return None if d is None else d.decode("latin-1", "replace")

def get_raw(path: str) -> bytes | None:
    try:
        return pool.read(path)
    except KeyError:
        hit = next((n for n in pool.names() if n.lower() == path.lower()), None)
        return pool.read(hit) if hit else None

print("=== No4Fire / Weapon BAF existence ===")
for p in (
    "Animations/Weapons/No4/No4Fire.baf",
    "Animations/Weapons/No4/No4Reload.baf",
    "Animations/Weapons/No4Sniper/No4SniperReload.baf",
):
    raw = get_raw(p)
    print(f"  {p}: {'OK' if raw else 'MISSING'}", end="")
    if raw:
        a = bafmod.parse(raw, name=p)
        print(f" frames={a.frames} bones={[t.name for t in a.bones]}")
    else:
        print()

print("\n=== HandFireArms key fields ===")
for path, names in (
    ("Objects/HandWeapons/No4/Objects.con", ("No4", "No4Sniper")),
    ("Objects/HandWeapons/K98/Objects.con", ("K98", "K98Sniper")),
):
    text = read(path) or ""
    for name in names:
        m = re.search(
            rf"ObjectTemplate\.create HandFireArms {name}\b(.*?)(?=\nObjectTemplate\.create |\Z)",
            text, re.S | re.I)
        if not m:
            continue
        print(f"\n-- {name} --")
        for line in m.group(0).splitlines():
            low = line.lower()
            if any(k in low for k in (
                "roundoffire", "reloadtime", "fireonce", "velocity",
                "soldiercamera", "soldierzoom", "unzoom", "usescope",
                "zoomfov", "setfiredev", "setmindev", "setspeeddev",
                "setmiscdev", "magsize", "numofmag", "projectile",
                "e_muzz", "e_shell", "startoneffects", "setposition",
                "recoil", "fireincamera",
            )):
                print(" ", line.strip())

print("\n=== center1pHands / set1pFov ===")
for n in sorted(pool.names()):
    if not n.lower().endswith((".con", ".inc")):
        continue
    text = read(n)
    if not text or ("center1pHands" not in text and "set1pFov" not in text):
        continue
    for i, line in enumerate(text.splitlines(), 1):
        if "center1pHands" in line or "set1pFov" in line:
            print(f"  {n}:{i}: {line.strip()}")

machine = parse_asm(read)

def quat_angle(q0, q1):
    dot = abs(sum(a * b for a, b in zip(q0, q1)))
    dot = min(1.0, max(-1.0, dot))
    return math.degrees(2 * math.acos(dot))

print("\n=== 1PFireNo4 rotation motion ===")
anim = bafmod.parse(get_raw(machine.state("Ub_FireNo4Sniper").clip_1p().path), name="fire")
for track in anim.bones:
    if track.name not in (
        "Bip01 R Hand", "Bip01 R Forearm", "Bip01 R UpperArm",
        "Bip01 L Hand", "Bip01 L Forearm", "Bip01 Spine3",
    ):
        continue
    angles = [quat_angle(track.rotations[i], track.rotations[i + 1])
              for i in range(len(track.rotations) - 1)]
    print(f"  {track.name}: max_step={max(angles):.2f} sum_steps={sum(angles):.2f} "
          f"end_vs_start={quat_angle(track.rotations[0], track.rotations[-1]):.2f}")

print("\n=== 1P state table No4Sniper / K98Sniper ===")
for w in ("No4Sniper", "K98Sniper"):
    print(f"\n## {w}")
    for k, st in sorted(machine.states.items()):
        if not st.name.endswith(w):
            continue
        if not (st.name.startswith("Ub_") or st.name.startswith("Weapon")):
            continue
        clip = st.clip_1p() or (st.clips[0] if st.clips else None)
        if not clip:
            continue
        span = 1.0 / abs(clip.speed) if clip.speed else None
        print(f"  {st.name:40s} clip={clip.path.split('/')[-1]:24s} "
              f"spd={clip.speed:5} span={span:.3f}s loop={clip.looping!r:16s} "
              f"morph={st.morph_factor} ret={st.return_to} wpn={st.weapon_state}")
```

Supporting scripts already under `/tmp/r2_scratch/`: `r2_sniper_anims.py`, `r2_shoot_effects.py`, `r2_sniper_objects.py`, `r2_shake_and_motion.py`, `r2_finish.py`. Bridge check: `sha256 … MATCH` on `BF1942.exe`.
