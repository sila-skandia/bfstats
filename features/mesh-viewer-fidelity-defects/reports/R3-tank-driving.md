## Summary

Retail does not move a tank by a per-side `driveAccel` tyre force. A shared `PhysicsEngine::updatePhysics` path applies one whole-body acceleration `F = forward * K * getCurrentRatio()` at the engine node (same law as aircraft), while `EngineGrip` wheels only set a contact-speed target from `ratio * differentialRPM` (scaled by a constant defaulting to 0.5) and let Coulomb friction resolve slip; `SpinWheel` is visual only. The viewer’s `TrackedVehicle` invents thrust per side, doubles it at yaw 0, and closes top speed with fitted `trackResistance` — that is the magnitude gap, not the gear curve. Video on Wake puts cruise roughly in the 4–12 m/s band and standing-start accel near ~3.5 m/s², which matches body-thrust launch (~4.4 m/s²) but **disagrees** with sphere-drag asymptote (~31 m/s), so box drag and/or wheel friction must dominate the ceiling.

## Findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Bridge alive; client sha256 MATCH | confirmed | `./xref.py check` → `60c9452d… MATCH` |
| 2 | Body thrust law (unchanged): `e = thr − ρ(v·fwd)/fadeSpeed`, `K = 0.1\|thr\| + e\|e\|`, `a = fwd * K * ratio` at engine node | confirmed | Client `PhysicsEngine::updatePhysics` `0x0057bfb0`; lnxded `0x0824cbb0` ends in `getCurrentRatio` + vtable `+0x68` |
| 3 | Thrust runs only if `ObjectTemplate::getFlags() & 1`; console registers `hasMobilePhysics` with bit value 1; `ShermanEngine` sets it | confirmed | lnxded gate `and $1` at `0x0824cc16`; client console ctor `0x00511510` (`param_1[1]=1`); `Physics.con` |
| 4 | `setTorque` still sound-only (TANK-4); not re-opened | confirmed | Prior ledger; `feedbackLoop` only consumer of torque curve |
| 5 | Gear curve / differential RPM unchanged (TANK-2/3); Sherman ratio = 4.0 at gear=1, `numberOfGears=5` | confirmed | Settled; `differential 4`, `numberOfGears 5` in `Physics.con` |
| 6 | `SpinWheel` does **not** apply force — updates wheel pitch from speed/radius and writes transform | confirmed | lnxded `0x0825b440`: radius floor 0.05, `angle += speed/radius`, wrap ±360°, `pitchIf` + `setTransformation` |
| 7 | EngineGrip drive path: `v_target = (1 − 0.5·engine[+0xb8]) * ratio * getCurrentDifferentialRPM(side) * wheel_forward`; default `+0xb8 = 1.0` → scale **0.5** → Sherman full-throttle target **2.0 m/s** | confirmed | `addFriction` `0x0825c252`–`0x0825c346`; ctor `0x0824c74c` movl `1.0` to `+0xb8`; no later `fstps`/`movl` to `+0xb8` found |
| 8 | Friction result is converted to acceleration by × `g_simulationFps` (**30.0** at `0x08716b5c`), then applied via physics-node vtable `+0x70` | confirmed | `addFriction` `0x0825bc67`–`0x0825bd0f` |
| 9 | Coulomb magnitude still uses `ResponsePhysics+0xa8` and gravity constants (`9.82`, `2.25`, `1.5`); full closed µ·N form not finished | open / partial | Cap setup at `0x0825b7c9`; PHY-2 still open on magnitudes |
| 10 | `MaterialManager::getFrictionForMaterial` exists (material `+0xc`); default float at manager `+0x20` = **0.1** (matches water note in `collision.js`); **no** `materialFriction` strings in vanilla RFAs; **no** direct CALLs to the symbol from `addFriction` | confirmed (API) / open (terrain scale on drive) | `0x081751b0`; ctor `0x08174857`; archive sweep 0 hits |
| 11 | Wake airfield road material id **13** (“Sand Road”); contact mostly id **11** wet sand | confirmed | `scene.json` terrain materials histogram |
| 12 | Sherman mass 25000, drag 2; Engine differential 4, gears 5, torque 4; throttle/yaw axes ±1° @ maxSpeed 4/10; 4× `EngineGrip` springs strength 18 / damping 4 at rear bogies; dummies `EngineDummyGrip` | confirmed | `Objects.con` / `Physics.con` |
| 13 | Driven-wheel radius ≈0.255 m from mesh (prior TANK-6); no `.con` radius | confirmed | Prior measurement; geometries are StandardMeshes only |
| 14 | `fadeSpeed` / `setNoPropellerEffectAtSpeed` default **100** | confirmed | EngineTemplate ctor writes `0x42c80000`; `FADE_SPEED_DEFAULT=100` in `ground.js` |
| 15 | Predicted launch accel from body thrust alone: **4.4 m/s²**; sphere-drag top ~**31 m/s** (any r∈1.5–4) | confirmed (formula) | `r3_predict_speed.py` |
| 16 | Video vs Wake landmarks: spawn `(1389.67, 737.15)`; `pacificfarm2` 11 m; `pacificfarm1` +30.5 m along +Z; enter ~1.0 s; hut leaves centre ~3.5 s; balance flips ~6.0 s | confirmed (geometry) / inferred (timing→speed) | `r3_wake_landmarks.py`, `r3_video_speed.py`, `/home/dylan/bf1942-tank-drive-shoot.mp4` |
| 17 | Retail measured: mean first-leg speed **~4.4 m/s**; second-leg **~12 m/s** if full farm spacing; from-rest accel **~3.5 m/s²** — adopt **a₀ = 3.5 ± 1.5 m/s²**, **v_cruise = 8 ± 4 m/s** | inferred | Landmark timing; FOV/turn ambiguity → wide bars |
| 18 | Prediction vs video: launch accel agrees (~4.4 vs ~3.5); **top-speed prediction from sphere drag does not** (~31 vs ~8) | confirmed disagreement | Body thrust + sphere drag insufficient; need box drag (PHY-4) and/or EngineGrip opposition above 2 m/s |
| 19 | Steering while moving: body thrust uses **undivided** throttle; yaw only splits wheel targets via TANK-2; capture shows clear yaw (L−R and optical flow) after ~3 s | confirmed / inferred | Thrust path reads `+0xa0` only; video |
| 20 | Hull: Sherman PCO/Complex/Hull and springs set `hasCollisionPhysics` + `hasResponsePhysics`; retail runs `ResponsePhysics::checkObjectVsObject` / `checkVsTerrain`. Viewer: vertical-ray suspension only, no hull sweep | confirmed | `.con` flags; lnxded symbols; `ground.js` open gaps |
| 21 | Stale doc: `ground-vehicles.md` still says `TrackedVehicle` not wired; `map.html` ~3660 selects `TrackedVehicle` for tanks | confirmed | `map.html` import/ensureDrive |
| 22 | Viewer `driveAccel` applies full `K*ratio` **per side** → ~**8.8 m/s²** total at yaw 0 before circle — not retail’s single body thrust | confirmed | `driveAccel` + `#step` loop in `ground.js` |

### Force law (symbols labelled)

**Body thrust** (confirmed — `0x0057bfb0` / `0x0824cbb0`):

\[
\rho = 1 - \mathrm{clamp}(y / H, 0, 1),\quad
e = \tau - \rho\,(v\cdot\hat f)/H_{\mathrm{fade}},\quad
K = 0.1|\tau| + e|e|,
\]
\[
\mathbf a_{\mathrm{thrust}} = \hat f\, K\, R
\]

- \(\tau\) = engine roll/throttle at `+0xa0` ∈ [−1,1] (confirmed)  
- \(R =\) `getCurrentRatio()` (Sherman 4.0, confirmed)  
- \(H_{\mathrm{fade}} =\) `setNoPropellerEffectAtSpeed` (default 100, confirmed)  
- Applied once at engine node; units acceleration (mass already inside)  
- Per call = per 1/30 s simulation step  

**Wheel target** (confirmed — EngineGrip in `addFriction`):

\[
v_{\mathrm{tgt}} = \bigl(1 - \tfrac12 b\bigr)\, R\, \mathrm{diffRPM}(\tau, \psi, s)
\]

- \(\mathrm{diffRPM}\): TANK-2 (confirmed)  
- \(b =\) engine `+0xb8`, default 1 → factor ½ (confirmed)  
- \(s\): wheel side sign (confirmed)  
- Friction pulls contact velocity toward \(v_{\mathrm{tgt}}\); result × 30 → accel (confirmed)  
- Exact Coulomb cap from `+0xa8` / material: **inferred/open**  

**What `driveAccel` stood in for:** the body-thrust \(K\cdot R\), wrongly evaluated per side and applied at wheels.

## What the viewer must change

**`viewer/ground.js` — `driveAccel` / `TrackedVehicle.#step`**

- Stop using per-side `driveAccel` as the longitudinal tyre force.  
- Apply **one** body acceleration `K * ratio` along hull forward from undivided throttle (same formula as `Aircraft.step` / `0x0057bfb0`), at the engine attachment (or CoM if engine node is not modelled).  
- At yaw 0 this is **4.4 m/s²** launch, not 8.8.  
- Keep `differentialRPM` only for (a) per-track visual spin and (b) optional contact-speed targets if implementing real friction.

**`TrackedVehicle.#step` longitudinal branch**

- Replace `fLong = accel/count` + `trackResistance` closure with: body thrust + friction toward \(v_{\mathrm{tgt}} = 0.5\,R\,\mathrm{diffRPM}\) (or full friction solve).  
- Drop fitted `TANK.trackResistance` (0.8) once top speed is closed by real opposition.  
- `TANK.mu` / `corneringStiffness` / `angularDamping` remain provisional until Coulomb magnitudes are finished.

**Throttle path (likely “barely moves” if thrust law is already “too strong” on paper)**

- Verify `s.surfaces` actually reaches ±1 for the engine roll axis (`setMaxSpeed 4` over ±1°). A stuck near-zero throttle yields near-zero \(K\) even with a correct formula.

**Collision / hull**

- Hull must participate in static contact (`sweepSphere` / mesh hull), not rays alone — retail springs + hull both have collision/response. Wheels catching without hull push-off can read as “barely moves”.

**Do not change:** gear table, `engineRatio`, `differentialRPM` algebra, `setTorque` usage.

**Stale docs:** note in `ground-vehicles.md` that `map.html` already selects `TrackedVehicle`.

### Sherman parameter table (implementer)

| Parameter | Value | Source |
|---|---|---|
| mass | 25000 | `Objects.con` |
| drag | 2 | `Objects.con` |
| differential | 4.0 | `Physics.con` |
| numberOfGears | 5 | `Physics.con` |
| torque (sound) | 4.0 | `Physics.con` |
| ratio (runtime) | 4.0 | TANK-3 |
| fadeSpeed | 100 (default) | EngineTemplate ctor |
| throttle/yaw span | ±1 | `setMin/MaxRotation` |
| axis rates | maxSpeed 4 / 10 | `Physics.con` |
| EngineGrip springs | 4 (L3×2, R3×2), strength 18, damping 4 | `Physics.con` |
| wheel radius | ≈0.255 m | mesh (TANK-6) |
| material (armor id) | 50 | `Objects.con` |

### Two numbers with error bars

| Quantity | Value |
|---|---|
| Standing-start accel (retail, Wake road) | **3.5 ± 1.5 m/s²** (video); formula predicts **4.4 m/s²** |
| Flat cruise / peak in clip | **8 ± 4 m/s** (video); sphere-drag formula predicts **~31 m/s** — **do not ship the 31** |

## Open

- Exact Coulomb force magnitude (`RP+0xa8`, material µ multiply on drive) — PHY-2 still open.  
- Whether vehicles use Advanced box drag (PHY-4); sphere law cannot explain video top speed.  
- Whether EngineGrip opposition above 2 m/s is the real governor (likely, not fully quantified).  
- Meaning of engine `+0xb4` nonzero branch (zeros desired velocity).  
- Flag bit 8 special case in `updatePhysics` (propeller path) — not set on `ShermanEngine`, but not fully named.  
- Load-bearing inference: video speeds from hut timing without FOV calibration.  
- Why the viewer “barely moves” if a correct body thrust would be brisk — suspect throttle/surfaces or hull snag (X1), not gear curve.

## Proposed ledger rows

| id | finding | status | evidence |
|---|---|---|---|
| TANK-7 | Tank propulsion is shared `PhysicsEngine::updatePhysics` body thrust `a = fwd·K·ratio` gated by `getFlags()&1` (`hasMobilePhysics`); not a tank-only integrator | verified | Client `0x0057bfb0`; lnxded `0x0824cbb0`; console `0x00511510`; Sherman `Physics.con` |
| TANK-8 | `SpinWheel` is visual-only (angle from speed/radius); does not contribute force | verified | lnxded `0x0825b440` |
| TANK-9 | EngineGrip sets `v_tgt = (1−0.5·eng[+0xb8])·ratio·diffRPM(side)` with default `+0xb8=1` → factor ½; friction ×30 Hz → accel | verified | `addFriction` `0x0825c252`…; ctor `0x0824c74c`; apply `0x0825bc67` |
| TANK-10 | Viewer `driveAccel` per-side application doubles yaw0 thrust vs retail; `trackResistance` is a fitted ceiling, not engine | verified | `ground.js` `driveAccel` / `#step`; contrast TANK-7 |
| TANK-11 | Retail Wake Sherman: a₀ ≈ 3.5±1.5 m/s², v ≈ 8±4 m/s; disagrees with sphere-drag asymptote ~31 m/s from TANK-7 alone | inferred (video) / verified (disagreement) | `r3_video_speed.py`, `r3_wake_landmarks.py`, `r3_predict_speed.py` |
| PHY-5 | `MaterialManager::getFrictionForMaterial` reads material `+0xc`; manager default friction field `+0x20=0.1`; not referenced by direct CALL from `addFriction`; no `materialFriction` in vanilla RFA `.con` | verified (API/default) / open (drive coupling) | `0x081751b0`; ctor; archive sweep |

---

### Scripts (full)

#### `r3_predict_speed.py`

```python
#!/usr/bin/env python3
"""Predict Sherman accel/top speed from the confirmed PhysicsEngine thrust law."""
import math

RATIO = 4.0          # TANK-3: differential*3.5/curve[20] with differential=4
FADE = 100.0         # setNoPropellerEffectAtSpeed default (TANK-5)
MASS = 25000.0
DRAG = 2.0
THROTTLE = 1.0

def step_sphere(r, seconds=10.0, dt=1.0/30.0):
    k_drag = math.pi * r * r * DRAG / MASS
    v = 0.0
    a0 = None
    t = 0.0
    while t < seconds:
        e = THROTTLE - v / FADE
        K = 0.1 * abs(THROTTLE) + e * abs(e)
        a = K * RATIO - k_drag * v
        if a0 is None:
            a0 = a
        v += a * dt
        t += dt
    return a0, v

for r in (1.5, 2.0, 3.0, 4.0):
    a0, v = step_sphere(r)
    print(f"sphere r={r:.1f}m  a0={a0:.2f} m/s^2  v@10s={v:.2f} m/s ({v*3.6:.1f} km/h)")

print(f"EngineGrip target (scale 0.5): {0.5 * RATIO * THROTTLE:.2f} m/s")
print(f"driveAccel per side at standstill: {(0.1 + 1.0) * RATIO:.2f} m/s^2")
print(f"viewer both-sides sum: {2 * (0.1 + 1.0) * RATIO:.2f} m/s^2")
```

#### `r3_sherman_params.py`

```python
#!/usr/bin/env python3
"""Dump Sherman Physics.con / Objects.con from the vanilla bf1942 RFA pool."""
import sys
sys.path.insert(0, "/home/dylan/projects/skandia/bfstats/tools/bf1942-models")
from pathlib import Path
from bf42.rfa import ArchivePool

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
pool = ArchivePool()
for rfa in sorted((MODS / "bf1942" / "Archives").glob("*.rfa")):
    try:
        pool.add(rfa, rfa.name)
    except Exception:
        pass

for key in (
    "Objects/Vehicles/Land/Sherman/Physics.con",
    "Objects/Vehicles/Land/Sherman/Objects.con",
):
    hit = next(n for n in pool.names() if n.replace("\\", "/") == key)
    print("====", hit)
    print(pool.read(hit).decode("latin-1", "replace"))
```

#### `r3_wake_landmarks.py`

```python
#!/usr/bin/env python3
"""Sherman spawn and nearby statics on Wake (Conquest)."""
import math
import re
import sys
sys.path.insert(0, "/home/dylan/projects/skandia/bfstats/tools/bf1942-models")
from pathlib import Path
from bf42.rfa import ArchivePool

wake = Path.home() / (
    ".wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/bf1942/levels/Wake.rfa"
)
pool = ArchivePool()
pool.add(wake, "Wake.rfa")

spawns = pool.read("bf1942/levels/Wake/Conquest/ObjectSpawns.con").decode("latin-1", "replace")
static = pool.read("bf1942/levels/Wake/StaticObjects.con").decode("latin-1", "replace")

print("---- tank spawners ----")
lines = spawns.splitlines()
for i, ln in enumerate(lines):
    if "heavytankspawner" in ln.lower() or "lighttankspawner" in ln.lower():
        print("\n".join(lines[max(0, i - 1) : i + 6]))
        print("---")

objs = []
cur = None
for ln in static.splitlines():
    ln = ln.strip()
    m = re.match(r"Object\.create\s+(\S+)", ln, re.I)
    if m:
        cur = {"t": m.group(1)}
    m = re.match(
        r"Object\.absolutePosition\s+([-\d.eE+]+)/([-\d.eE+]+)/([-\d.eE+]+)", ln
    )
    if m and cur:
        cur["p"] = (float(m.group(1)), float(m.group(2)), float(m.group(3)))
        objs.append(cur)
        cur = None

spawn = (1389.67, 737.147)
print(f"\nstatics near airfield Sherman spawn {spawn}:")
near = []
for o in objs:
    x, y, z = o["p"]
    d = math.hypot(x - spawn[0], z - spawn[1])
    if d < 100:
        near.append((d, o["t"], o["p"]))
near.sort()
for d, t, p in near[:25]:
    print(f"  {d:5.1f}m  {t:32s}  {p}")
```

#### `r3_video_speed.py`

```python
#!/usr/bin/env python3
"""
Estimate retail Sherman speed from bf1942-tank-drive-shoot.mp4 against Wake landmarks.

Method: frame-average left/right balance in the periscope crop marks when the
near hut (pacificfarm2, 11 m from spawn) leaves frame centre. A second window
covers travel toward pacificfarm1 (30 m further along +Z).
"""
from pathlib import Path
from PIL import Image

scratch = Path("/home/dylan/projects/skandia/bfstats/.agents/r3_scratch")
rows = []
for n in range(1, 28):
    p = scratch / f"r3_frame_{n:03d}.png"
    if not p.exists():
        continue
    im = Image.open(p).convert("RGB")
    w, h = im.size
    crop = im.crop((w // 4, h // 3, 3 * w // 4, 2 * h // 3))
    cw, ch = crop.size
    left = crop.crop((0, 0, cw // 3, ch))
    right = crop.crop((2 * cw // 3, 0, cw, ch))

    def avg(img):
        px = list(img.getdata())
        return sum(sum(c) for c in px) / (len(px) * 3)

    t = (n - 1) / 4.0
    rows.append((t, avg(left) - avg(right)))

for t, lr in rows:
    print(f"t={t:4.2f}s  L-R={lr:7.1f}")

d_spawn_farm2 = 11.0
d_farm2_farm1 = 30.5
t0, t1, t2 = 1.0, 3.5, 6.0
print(f"\nspawn->farm2 {d_spawn_farm2} m in {t1-t0:.1f}s -> {d_spawn_farm2/(t1-t0):.1f} m/s")
print(f"farm2->farm1 {d_farm2_farm1} m in {t2-t1:.1f}s -> {d_farm2_farm1/(t2-t1):.1f} m/s")
s, t = d_spawn_farm2, (t1 - t0)
a = 2 * s / (t * t)
print(f"if from rest over first leg: a={a:.2f} m/s^2")
```

Scratch copies live under `/home/dylan/projects/skandia/bfstats/.agents/r3_scratch/`. Frame extracts (`r3_frame_*.png`, etc.) are there too. Corpus untouched.
