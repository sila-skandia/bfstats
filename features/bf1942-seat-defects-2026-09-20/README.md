# Seat defects, 2026-09-20

Five things the owner reported after driving a Sherman on Liberation of Caen,
with two screenshots: tanks standing at a list, a first-person view with no
interior, no crosshair anywhere, a silent machine gun, and a tank you can
barely hear. Each one is below with what it actually was, not what it looked
like.

Two of the five were fixed in a second session running in the same checkout at
the same time (the `_N` suffix and the machine gun); they are recorded here for
completeness because the audio numbers below were measured with those changes
in place.

---

## 1. Tanks spawn on a 13-degree list

**What it was.** Not a tilt at all: a tank with no suspension, resting on the
corners of its own hull.

`ObjectSpawner` positions are level, and so are the placed rotations — the
Shermans on Caen carry a bare yaw and nothing else. The list came from
`settlePlacedVehicles`, the pass in `map.html` that drops every placed vehicle
onto its springs once at load. A Sherman had **no spring parts at all**, so
that pass had nothing holding it up: the hull's own col0 vertices took the
ground, each contact posted an off-centre angular impulse, and the body rolled
over until something else touched. It never went to sleep either, so it was
still being integrated, and still jittering, for as long as the level was open.

The springs were missing because of a **cull two steps upstream**. A wheel's
ground probe in this engine is a deliberate three-vertex triangle about a
millimetre across — `collision-response.md` §5.5, "n = vertex count; if n < 4:
n = 1". `Sherman_Whe3L_M1`'s is 0.8 mm on a side, which is a cross product
squared of 6.4e-13, and both readers of a `.sm`'s collision block threw away any
face under **1e-12**:

| | |
|---|---|
| `bf42/assemble.py::_collision_mesh_indices` | dropped the layer, so the level glb got no `ShermanWheelL3 collision 0` node |
| `extract_collision_meshes.py::build_collision_meshes` | dropped the mesh, so `collision-meshes.json` had no `sherman_whe3l_m1` to resolve one against |

A census of every collision face in vanilla (66,476 of them) puts **no face at
zero** and only 98 under the old bar. The seven layers it emptied outright were
`Sherman_Whe3L/Le/R/Re` — the suspension of the Sherman, and of the Priest and
the M10, which alias those meshes — and the three `Tlight` tracer meshes.

**The fix.**

- One constant, `bf42/stdmesh.py::DEGENERATE_CROSS_SQ`, now **1e-20** (|cross| =
  1e-10, a triangle about 10 µm across), imported by both readers so they
  cannot drift apart again.
- `build_collision_meshes` keeps a mesh whose layers have **vertices**, whether
  or not any face survived: `checkVsTerrain` drops col0 *vertices* onto the
  heightfield and never looks at a face (§7), so a layer with no faces left is
  still a usable ground probe.
- `viewer/vehicle-bodies.js::describeVehicleParts` resolves a `Spring` that
  carries no collision node through its **own `geometry`** instead. That is
  where `PhysicsSpring` reads it from in the engine anyway, and it is what lets
  an asset tree published before this fix stand up without being re-extracted.

**Evidence.** Every placed vehicle of all 23 vanilla levels settled on flat
ground under the real `body-world.js`, before and after:

| vehicle | before | after |
|---|---|---|
| Sherman | 13.84°, **never sleeps**, 0 springs | 0.14°, asleep at tick 111, 12 springs |
| M10 | 1.22°, **never sleeps**, 0 springs | 0.14°, asleep, 12 springs |
| Priest | 0.93°, **never sleeps**, 0 springs | 0.14°, asleep, 12 springs |
| the other 28 | — | **bit for bit unchanged** |

Live on Caen, the five Shermans read 14.11°, 11.41°, 10.99°, 13.00° and 11.05°
before and 4.21°, 1.83°, 1.40°, 0.15° and 3.12° after — the same few degrees the
Lynx and M3A1 parked beside them have always had, which is the ground.

Two things this did **not** fix and which were already true: the KettenKrad
settles at 7.5° and never sleeps (11 springs, unchanged by any of this), and
every taildragger sits nose-high at 9-14°, which is correct.

---

## 2. The first-person vehicle view has no interior

**What it was.** The near plane, and only the near plane.

`enterVehicle` gave the seat camera the free-fly camera's `near = 0.5`.
`1P_Sherman_Gunner_M1` — the box a tank commander looks out of, 633 triangles
over seven textures — spans **0.089 m to 0.40 m** in front of `ShermanCamera`.
Every triangle of it was inside the near plane and clipped. What was left was
the tank's own hull at 0.63-0.71 m (the dark band along the bottom) and the gun
barrel at 0.57-1.0 m, seen from inside and stretched across the right of the
screen: the "green wedge" in the report is `ShermanGunBarrel`, and it was only
ever visible because the thing that should have been in front of it was gone.

**The fix.** `SEAT_NEAR = 0.1` — the engine's own render-view near plane
(`Renderer_drawView` 0x004662c0, quoted at the viewmodel near pass in
`frame()`), which nothing in the engine moves. The free-fly camera keeps its
0.5 and a soldier keeps his 0.2 (that one is deliberate: it clears his capsule
so a wall he is pressed against is drawn rather than clipped through).

**Evidence.** With `near` at 0.1 the frame draws, and it occludes the barrel —
which is what the wedge always was. Checked in the page: `__camera.near` reads
0.1 in a seat, and the seven `1P_Sherman_Gunner_M1` primitives measure 0.089 to
0.400 in view space against it.

### 2b. …and then it was black (found on the owner's re-test)

The frame drew and still read as "just looking direct at the world", because
it was rendering at **rgb(1,1,0)**.

This page draws the whole level with `MeshBasicMaterial`: BF1942 bakes its
light into the textures and the per-object lightmaps, so a shaded material
would be a second opinion about a surface that already carries one. The
cockpit glb is the one thing in the scene that does not come from the level —
it is the MODEL BROWSER's export (`extract_models.py --cockpit`), and that page
lights what it shows, so the interior arrived as `MeshStandardMaterial` and was
the only surface a level's hemisphere and sun actually touched.

Inside a tank that is fatal. The camera-facing vertices of
`1P_Sherman_Gunner_M1` have a mean `N·L` of **0.01** against the sun and a mean
`N.y` of **−0.04**, so the sun gives them nothing and the hemisphere gives them
its horizon. `1p_TankA_Gunner*_I.dds` have a mean of rgb(56,54,48) and a
maximum of rgb(106,101,98); on screen they measured rgb(1,1,0) to rgb(3,3,2).

`map.html`'s `unlitCockpit` converts a grafted interior to the same unlit
material the rest of the level uses, preserving the `userData.additive` mark a
gunsight glow needs. The same pixels now measure **rgb(21,22,16) to
rgb(26,29,24)**, and the frame, its bevels, its corner screws and its top latch
read the way they do in a retail capture. The aperture was never the problem:
it spans 0.215–0.57 of the width and 0.289–0.778 of the height against the
retail Sherman's 0.20–0.83 and 0.258–0.782 (our right edge is the gun barrel,
not the frame).

---

## 3. No crosshair on a tank, and a bare dot on the anti-tank

**What it was.** Two halves.

`setCrossHairType` is declared per HandFireArms **and per
PlayerControlObject** — vanilla spreads 150 templates across `CHTCrossHair`
(the four bars: every rifle and SMG, and the Sherman, PanzerIV, Tiger, T34,
Chi-ha and every hull and stationary MG), `CHTIcon` (the bazooka, the K98, the
Defgun, the Priest, the Sexton and every aircraft) and `CHTNone` (passengers,
ships, the Willy). The viewer asked only the hand weapon, and only while on
foot, so:

- a tank drew **nothing**, because a seat was never asked; and
- a `CHTIcon` weapon drew **the centre dot alone**, because its art was
  described as "not extracted yet".

It is extracted. `maps/_shared/hud/hk.png` is a 32×32 RGBA file with 80 opaque
pixels in it, and it is exactly the four-bar reticle the game draws. No vanilla
template overrides `CrossHair/CrossHairIcon`, so it is the icon for all 49 of
them — which is what "every weapon that can fire has the same crosshair" means.

**The fix.**

- `bf42/assemble.py` carries `crossHairType` in each PCO's own `hud` block,
  beside the vehicle icon and the ammo bars it already carried. Re-extracted for
  all 23 vanilla levels.
- `map.html`'s `crosshairAim()` reads the word from the occupied seat
  (`occupancy.activeHud()`) or, on foot, from the weapon in hand, and
  `updateCrosshair()` runs every frame instead of only from `footFire`.
- A `CHTIcon` crosshair draws `hk.png` at the rect `menu/InGame` gives it
  (20×20 at 390,290 in the layout's 800×600 virtual screen), stretched per axis
  the way `hud.js` stretches everything else. The dot survives as the fallback
  for a pack with no `hk` in it.

The four-bar `CHTCrossHair` shape stays in the DOM overlay where it was: its
geometry is measured off retail footage, and the layout's own `BfCrosshairNode`
has never been traced.

---

## 4. The tank machine gun is silent

Fixed in the concurrent session. In short: `scene.glb` is one document, so the
second node of a given name is renamed — a level with a stationary `Browning`
on it renames the Sherman's hull gun to `Browning_1`, and the fourth Sherman's
coaxial to `Coaxial_browning_3`. The sound specs key on the template's bare
name. `weaponAudioFor` stripped the suffix; `updateAudio`'s gain gate did not,
so `hasLoops && !group?.firing` held those buses at zero for good — and a
Browning's patch is nothing but loops. `bareFireArmsName`/`fireArmsNode`/
`firingGroupFor` in `map.html` now strip it everywhere.

---

## 5. The tank is too quiet

**What it was.** A divisor fitted to one aeroplane.

`BUS_HEADROOM = 0.28` was the worst-case concurrent layer sum of a Corsair at
full throttle heard from its own cockpit (1.0 + 0.5 + 1.0 + 0.8 × 0.8 ≈ 3.8),
applied to every engine patch there is, on the reasoning that a Web Audio graph
summing into the destination clips flat. Two things were wrong with it: worst
case is not what arrives, because layers that are not in phase do not add in
phase; and one divisor cannot both leave an idling engine audible and hold a
20-layer cannon under full scale. Measured on the Sherman, inside, idling,
master at 0.7, at the listener's own input:

| | peak | RMS |
|---|---|---|
| the tank's engine | 0.089 | 0.0295 |
| the map's wind, on foot | — | 0.0156 |
| the BAR, firing | 0.596 | 0.185 |
| the tank's cannon | **1.75** | 0.313 |

A tank you are sitting in was twice as loud as the weather, and the cannon
clipped anyway.

**The fix.** The clipping goes where it belongs — a limiter on the listener
itself (`ensureListener`: threshold −1 dBFS, knee 0, ratio 20, 3 ms attack,
150 ms release, so nothing under −1 dBFS is touched at all) — and the engine
bus plays the `.ssc` mix at the volumes it writes (`BUS_HEADROOM = 1`). The gun
bus keeps its own 0.75, which measurement says is already where it should be.

**Evidence**, same scene, same master:

| | before | after |
|---|---|---|
| engine, idling | peak 0.089 / RMS 0.0295 | **peak 0.359 / RMS 0.104** |
| coaxial Browning, held | peak 0.654 / RMS 0.189 | peak 0.852 / RMS 0.216 |
| cannon | peak 1.75, clipped | peak 1.78 into the limiter, **5.7 dB taken off**, ~0.92 out |

The limiter reads −0.0001 dB at idle, so it is doing nothing until a gun goes
off.

---

## What changed

| File | Why |
|---|---|
| `bf42/stdmesh.py` | `DEGENERATE_CROSS_SQ`, one bar for both readers |
| `bf42/assemble.py` | uses it; carries `crossHairType` per PCO |
| `extract_collision_meshes.py` | uses it; keeps a layer for its vertices |
| `viewer/vehicle-bodies.js` | a `Spring` with no collision node probes its own geometry |
| `viewer/engine-audio.js` | the engine bus plays the authored mix |
| `viewer/map.html` | `SEAT_NEAR`; the crosshair; the master limiter |

Data regenerated: `collision-meshes.json` for bf1942, XPack1, XPack2 and EoD
(purely additive — `sherman_whe3l_m1`, `sherman_whe3r_m1`, `tlight_m1`), and all
23 vanilla `scene.glb` for the wheel probes and `crossHairType`. **The mods'
levels have not been re-extracted**: they get the tilt fix through the viewer's
own Spring fallback, but their seats carry no `crossHairType` yet and so draw no
crosshair. Re-extracting them is the remaining work.

Tests: `test_extract_collision_meshes.py` (the millimetre probe survives, a
collapsed face is still culled, one bar for both readers), `test_vehicle_bodies`
(the Spring fallback, and that it does not double-count), `test_assemble.py`
(`crossHairType` per PCO, absent when undeclared), `test_engine_audio_default.mjs`
(the bus carries no divisor of its own; an explicit one still wins).
