# The con reader: the console's spellings, the mesh scale, the camera's look (2026-10-07)

Status: built on `worktree-agent-afeb6e4077bf05be1` (Desert Combat parity round,
package `con-reader`; the census is `~/.cache/dc-sweep/reports/adv-conwords.md`,
findings CW1, CW5, CW13 and CW16). Code and tests are in; the re-extracts are
the lead's (section 6).

`bf42/con.py` read each console word under one spelling, so Desert Combat's 23
`ObjectTemplate.setGeometry` parts were drawn as nothing: the AH-64's gun mount,
nose sensors and Hydra pods, the Mi-24's chin turret, rocket pods, missile tray
and rear gear, the H-6 family's bodies and the AV-8's four nozzles. It also
ignored `GeometryTemplate.scale`, so the AC-130 came out at 80% of its size.
Both now read the way the engine reads them, and every Camera node says whether
its seat needs the mouse-look key and how its look turns.

## 1. The engine

| Row | What it settles |
|---|---|
| CON-15 | A console word is looked up as object + word with `strcasecmp`. On a miss, a word starting `get` or `set` is looked up again without those three letters, and the answer counts only if it is a property. A method answers only to its own name, and no `set` is ever added. lnxded `ConsoleObjects::getConsoleObject` `0x08359b10`, client `0x005ac750`. This settles HP-4's open compare |
| CON-16 | A Vec3 argument is read off a stream: float, one character, float, one character, float. A short one repeats its last component, so `GeometryTemplate.scale 1.25` is 1.25/1.25/1.25 |
| SM-13 | `GeometryTemplate.scale` scales a StandardMesh's drawing and the face side of its collision, in the mesh's own axes. It does not scale its child parts, the instance's bounding box, or a body's own vertex probes |

The type numbers bf42plus's `console.h` gives are wrong on one point: type 0 is
a method. 1 is a read-write property, 2 settable only and 3 readable only, which
is what the two strip branches test.

## 2. What was built

**The spellings** (`bf42/con.py`). `console_word(namespace, command)` runs once
per line, before the branches, and maps the other spelling of a property onto
the one the branch reads. The table `_OBJECT_TEMPLATE_PROPERTIES` lists the 160
ObjectTemplate words con.py reads that the console registers as a property, in
con.py's spelling. `_GEOMETRY_TEMPLATE_PROPERTIES` lists `file` and `scale`.
Each word was checked against lnxded's own registrations. The static
initialisers were harvested for every `ConsoleObject`, its name, type and
`executeObjectMethod` were read, and each handler was decompiled to see which
template it writes. The scripts are `~/.cache/dc-sweep/con-reader/registry.py`,
`classify.py`, `verdict.py` and `map_check.py`.

Three twins are left out because the engine registers them as two different
words:

| Pair | Why they are not the same word |
|---|---|
| `lodDistance` and `setLodDistance` | `GeometryTemplate.lodDistance` is a property of the terrain template |
| `objectTemplate` and `setObjectTemplate` | Two different ObjectSpawner words |
| `type` and `setType` | `type` is registered once per template class |

A word missing from the table is still read under its own spelling, so a word
another branch adds later loses only the second spelling, never the first.
`tests/test_con.py` `ConsoleSpellingTests` reads the branches' own literals
off the source and fails if a table entry is not one of them, or if an entry's
twin is.

**The scale.** `GeometryTemplate.scale` is read with `stream_vec3` onto
`GeometryTemplate.scale`. `bf42/assemble.py` `scale_standard_mesh` bakes it
into a StandardMesh's drawn levels (positions, and normals by the inverse,
renormalised) and its collision layers. That covers the drawn mesh with its
LOD rungs and the undrawn alternative's hull. A ladder's climb measure stays
the file's, because LADDER-3 reads the instance's bounding box, which SM-13
leaves unscaled. The mesh scales about its own origin, so the part's node, its child
parts and their placements are untouched. The node and its collision nodes
carry `extras.geometryScale`, and so do a gun's drawn round and tracer nodes
(review fix: DC's `projectile_40mm` is drawn at 0.6 on the OSA, the AC-130's
40 mm and the Mk19). A body's vertex probes read the file unscaled in
the engine (SM-13), and a consumer that wants that can divide the scale back
out.

`extract_collision_meshes.py` keeps the file's vertices, because two geometries
can share one file at two scales. DC's `AC-130_prp2` is `B17_prp1_M2` at 1.4.
The file's vertices are also what the engine's vertex side reads. It writes a
`"scales"` map, keyed by geometry template, beside `"geometries"` when any
reached geometry declares a scale. No viewer code reads `"scales"` yet (open,
section 8).

**The camera.** Every Camera node's `extras.cameraView` now carries two fields:

- `toggleMouseLook` (true or false, read from the word on the Camera template;
  the constructor's default is 0).
- `look`, the template's own `rig()`. For each bound axis it gives the input,
  min, max, free, maxSpeed, `direction` (the sign of `setAcceleration`) and
  acceleration.

A Camera node has no mesh and no children, so it never got `extras.rig`. Yet
the held look's sense on screen is the camera's own pitch gain times the
profile's invert box (MLK-13, GUN-2). That gain is `direction` times the sign
of `maxSpeed`, not `direction` alone: the servo ramps toward
`sign(acceleration) x input x maxSpeed` with `maxSpeed` signed
(`calculateAndClipAngle` lnxded `0x081d7866`, `fmul [tmpl+0x174+axis*4]`, no
`fabs`; `ObjectTemplate.maxSpeed`, ConsoleClass194 `0x081ce090`, stores the
Vec3 raw). Vanilla's BF109 (`setAcceleration 5000/5000/0`, `setMaxSpeed
90/-90/0`) and Spitfire (`-5000` with `90/90/0`) therefore look the same way.

## 3. How it was checked

- Unit tests:
  - `tests/test_con.py`: `ConsoleSpellingTests` (7 tests), `GeometryScaleTests` (2) and `ToggleMouseLookTests` (1).
  - `tests/test_assemble.py`: `GeometryScaleExportTests` (5) and `CameraToggleMouseLookExportTests` (2).
  - The whole suite: see section 8.
- The parsed libraries before and after, for vanilla, XPack1, XPack2, DC 0.7
  and DC Final (`libdump.py`/`libdiff.py`), and every level folder's own con
  files parsed by both readers (`level_scan.py`).
- Every model of the five trees extracted at the base commit and with the fix
  (`extract_all.py --level-all --configuration-all --cockpit --no-optimise`;
  `--own` for the two packs, as their trees are built), each glb reduced to its
  JSON chunk, and the pairs diffed (`glbdiff.py`). Section 4 has the result.
- The four parts the census named, from the fixed DC tree:

  | Part | Before | After |
  |---|---|---|
  | AH64 `AH64M230Base` | node with `geometry: null` | carries a mesh, 0.32 x 0.31 x 0.33 m |
  | Mi24D `Mi24DGGunTurret` | node with `geometry: null` | carries a mesh, 0.78 x 0.37 x 0.82 m |
  | AH-6 `AH6Parts` | node with `geometry: null` | carries a mesh, 3.51 x 1.23 x 2.03 m |
  | AV-8B `AV8FrontExhaust_L` | missing | carries a mesh |

  The AC-130 fuselage (`AC-130CockpitExternal`) measures 35.76 m long, against
  28.6 m before (x 1.25). The Pickup hull is 5.87 m, against 5.33 m.

## 4. Blast radius

Every model of each tree, before and after:

| Tree | glbs | identical | camera fields only | changed otherwise |
|---|---|---|---|---|
| vanilla | 396 | 241 | 147 | 8 |
| XPack1 (`--own`) | 118 | 99 | 19 | 0 |
| XPack2 (`--own`) | 225 | 174 | 45 | 6 |
| DC 0.7 | 640 | 395 | 164 | 81 |
| DC Final | 801 | 475 | 220 | 106 |

*Camera fields only* means the two new `cameraView` keys and nothing else.

**Vanilla, 8 files: Fletcher, Fletcher2, Hatsuzuki, Hatsuzuki2 and their Truk
skins.** Both changes are engine-correct:

- The `DepthChargeLauncher`'s projectile spec gains `hasPointPhysics: false`.
  Vanilla's `DepthCharge` writes the bare `hasPointPhysics 0`, which the engine
  takes (BOMB-10 says which physics path that picks). No viewer code reads the
  key yet.
- Its drawn projectile is now `DepthChargeLauncherDummy`, from the launcher's
  own `setVisibleDummyProjectileTemplate`. It is the same `depth_charge_m1`
  mesh, so it draws the same.

**What changed in the parse but reaches no vanilla glb:**

- The 534 bare `hasCollisionPhysics` templates. The exporter gates only
  TreeMesh hulls on the flag (TM-5), and none of the 534 is a TreeMesh: 342
  StandardMesh, 8 skeleton collision meshes, 184 meshless.
- `hasMobilePhysics` on five projectiles (the ExpPack, FloatingMine, both
  grenades and the landmine).
- `setTeam` on Battle of Britain's objective spawners. The level's spawns are
  read by `bf42/level.py`, not by this branch.

**XPack2, 6 files:**

| File | What changed |
|---|---|
| Flettner and its wreck, plus their Raid on Agheila skins | The three `FlettnerInvisibleWheel` springs (`setCreateInvisible 1`) are gone, the same way every `createInvisible` part already is |
| WasserfallRocket | The flying hull is drawn at 0.3/1/1. Its own comment says it was scaled up "to fool the physics engine" |
| K98RifleGrenade | Its projectile mesh is drawn at x2 |

The parse also picks up `GermanElite_RocketPack` `damping 0`, which reaches no
glb.

**DC 0.7, 81 files, and DC Final, 106:**

- The 23 `setGeometry` parts, on these models:
  - the AH-64;
  - the Mi-24D, and DC Final's Mi-8T, which mounts its S-5 pods;
  - the AH-6, OH-6, MH-6, MH-500 and DC Final's MD-500;
  - the AV-8B, C and H;
  - the carriers that hold them as statics: Nimitz and its static variants, Enterprise, Shokaku, and DC Final's Hornet.
- Every scaled geometry: the AC-130 (the brief's 35.8 m), its 40 mm,
  Pickup, Technical and Technical_Recoilless, the BRDM-2 family's wheels
  (including DC Final's SA-9), the M-109's front wheels, the M2A3 and DC Final's
  M6 wheels, the M1A1 and Ural MG holders, Mk19 and Recoilless mounts, the
  DPV, the SA-3 and DC Final's Patriot in-flight hulls, the OSA's propeller,
  the ParaAmmoCrate's base (x4), the Sandbag's base (an M15 mine mesh at
  x0.001), the Pantsyr's ladder (drawn at 0.65), DC Final's F-117A doors
  (x1.01), and the AC-130 sight that the Stryker's and DC Final AH-64's
  cockpits reuse.
- The same depth-charge change as vanilla.

The Pantsyr ladder's climb measure stays the file's (LADDER-3 reads the
unscaled bounding box), and the run caught that: a first version moved its
`isLadder`.

**Other trees and side files:**

| Item | Result |
|---|---|
| `_shared/effects.glb` | Only DC Final's moves: its bunker-buster craters (`BBCraterSand/Dirt/Paved_m1`, x0.85). Vanilla, both packs and DC 0.7 are identical |
| `_shared/collision-meshes.json` | Vanilla is byte-identical. DC gains the 9 `setGeometry` meshes that have collision (575 to 584) and a 25-entry `scales` map, and DC Final a 31-entry one. XPack2 gains a one-entry map (the Wasserfall) |
| `deployables.json` (DC, DC Final) | Identical |
| A pose (`XPack2 GermanSoldier K98RifleGrenade`) | Identical |
| XPack2 viewmodels | None exist |
| DC viewmodels | None carry a scaled weapon |

**Levels.** Every level bake places vehicles with cameras, so every level picks
up the two camera fields at its next full bake. These levels draw or behave
differently:

| Tree | Levels |
|---|---|
| vanilla | guadalcanal, invasion_of_the_philippines, midway, omaha_beach, truk, wake (the destroyers' depth-charge launcher) |
| XPack1 (inherited levels in the pack's tree) | the same six, plus husky |
| XPack2 | raid_on_agheila (the Flettner), plus the same six inherited levels |
| DC 0.7 | all 35 |
| DC Final | 47 of 48 (all but dc_bridge) |

Level-local templates: Operation Bragg's own `AC-130_Interior` (x1.25), and
Battle of Britain's Ju88A cameras, which gain only the camera fields. The
scripts are `level_hits.py` (live glb JSON, read only) and `level_scan.py`.

## 5. What the lead runs

From `tools/bf1942-models`, into scratch first.
`project_extract_models_clobbers_manifest` has the in-place install: hard
links, `models.json` with its `thumb` keys, and the backup. Then
`optimise_mesh.py` in place, and `publish-mesh-delta.py`.

**Models.** Nearly every vehicle glb changes, through its camera fields:

```
python3 extract_all.py --level-all --configuration-all --cockpit -j 8 --out <scratch>/models              # viewer/models
python3 extract_all.py --mod XPack1 --own --level-all --configuration-all --cockpit -j 8 --out <scratch>/xpack1
python3 extract_all.py --mod XPack2 --own --level-all --configuration-all --cockpit -j 8 --out <scratch>/xpack2
python3 extract_all.py --mod DesertCombat --level-all --configuration-all --cockpit -j 8 --out <scratch>/desertcombat
python3 extract_all.py --mod DC_Final --level-all --configuration-all --cockpit -j 8 --out <scratch>/dc_final
```

Re-shoot the thumbnails of the models whose drawing moved (section 4's DC and
DC Final lists, plus the Flettner, Wasserfall and K98RifleGrenade) with
`shoot.mjs --thumbs`.

**Side files:**

```
python3 extract_collision_meshes.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared
python3 extract_collision_meshes.py --mod DC_Final --out viewer/maps/mods/dc_final/_shared
python3 extract_collision_meshes.py --mod XPack2 --out viewer/maps/mods/xpack2/_shared
python3 extract_effects.py --mod DC_Final --out viewer/maps/mods/dc_final/_shared   # sounds as the tree was made
```

**Levels** (full bake; no layer patch covers a glb):

```
python3 extract_maps_all.py --levels guadalcanal invasion_of_the_philippines midway omaha_beach truk wake
python3 extract_maps_all.py --mod XPack1 --out viewer/maps/mods/xpack1 --levels guadalcanal husky invasion_of_the_philippines midway omaha_beach truk wake
python3 extract_maps_all.py --mod XPack2 --out viewer/maps/mods/xpack2 --levels raid_on_agheila guadalcanal invasion_of_the_philippines midway omaha_beach truk wake
python3 extract_maps_all.py --mod DesertCombat --out viewer/maps/mods/desertcombat --levels <its 35 levels>
python3 extract_maps_all.py --mod DC_Final --out viewer/maps/mods/dc_final --exclude dc_bridge --levels <its 47>
```

DC's and DC Final's level lists are the tree's own folders. Pass `--levels`,
or the run widens the tree with inherited levels
(`project_extract_maps_all_inherits_levels`). To carry the camera fields to
the other levels as well, run every level of every tree. The viewer change
below falls back on an older bake, so that can wait for the next full pass.

## 6. The viewer change for `air-input-2`

`mouse-look-key.js` and `local-look.js` are that agent's; nothing here edits
them. With the assets above:

1. **Which seats need the key** (`mouse-look-key.js` `seatNeedsMouseLookKey`).
   Read the seat camera's word, and keep today's rule only for an asset that
   predates it:

   ```js
   export function seatNeedsMouseLookKey(seat) {
     if (!seat) return false;
     if (typeof seat.toggleMouseLook === 'boolean') return seat.toggleMouseLook;
     return seat.rootKind === 'air' && seat.root === true;   // pre-2026-10-07 assets
   }
   ```

   In `local-look.js` `lookNeedsKey()`, pass `toggleMouseLook:
   seat.cameraNode?.()?.userData?.cameraView?.toggleMouseLook`.

   Five DC seats then need the key that today's rule misses:

   - the H-6 and SA-342 co-pilots;
   - the SA-342 and MH-6 passengers;
   - the Stryker passenger.

   The Stryker is a land hull, and the Land profile binds no `c_PIMouseLook`
   (MLK-2), so in retail that seat never looks around.

2. **The held look's sense** (`local-look.js`, the
   `const flip = page.held(MOUSE_LOOK_TRIGGER) && !mouseInput.invertFor('air') ? -1 : 1`
   line). Replace the assumed negative camera with the camera's own sign:

   ```js
   const look = page.occupancy?.cameraNode?.()?.userData?.cameraView?.look;
   const pitch = look?.axes?.pitch;
   // GUN-2: the servo's gain is sign(acceleration) x maxSpeed, maxSpeed signed.
   const sign = look ? (pitch?.acceleration ? pitch.direction * Math.sign(pitch.maxSpeed ?? 0) : 0) : -1;
   const flip = page.held(MOUSE_LOOK_TRIGGER) ? sign * (mouseInput.invertFor('air') ? -1 : 1) : 1;
   ```

   With `sign = -1` this is today's line exactly. A camera with no pitch
   binding, or a zero pitch acceleration (XPack2's C47), gets no vertical look
   (GUN-2).

   **Do not take `direction` alone as the sign.** Six vanilla pilot cameras
   (AichiVal, Aichival-T, B17_Camera, BF109, Mustang and Battle of Britain's
   level-local `Ju88A_Camera`) and the AC-130's declare a positive
   acceleration with a negative `maxSpeed` (`5000` with `-90`), which is the
   same gain as the Spitfire's `-5000` with `90`. Read that way, every key
   camera in vanilla, XPack1, XPack2 and DC 0.7 is negative, which is what
   `local-look.js` assumes today, so the change moves none of them. The only
   positive key cameras are DC Final's helicopters: AH64, H6Pilot, MH53Pilot,
   Mi8, SA342Pilot, UH-60 and UH-60Q (`maxSpeed 90`, `acceleration 5000`).
   XPack2's `C47Camera` has no pitch acceleration. (Review, 2026-10-07: the
   first version of this section used `direction` alone and listed the
   vanilla six and the AC-130 as positive, which would have inverted their
   held look.)

   The camera's own limits are `look.axes.yaw/pitch.min/max` (degrees, `null`
   when free) if the page clamps the held look anywhere.

## 7. Found on the way, for other packages

- `bf42/level.py` has its own `ObjectTemplate` readers for control points,
  spawners and placements, and they still read one spelling each. A control
  point written `ObjectTemplate.setTeam` would be missed there. No such line
  turned up in the five trees' level folders, but `console_word` is the call to
  use if one does.
- The other `add_con` branches have the same twins:
  - `weaponTemplate`'s 9 words (`burst`, `deviation`, `minRange` and the rest)
    are properties of `WeaponTemplateManager`'s active template.
  - `aiTemplatePlugIn`'s control and sensitivity words are type-1
    registrations, but their handlers were not attributed.

  No shipped line in the five trees writes either set under its other
  spelling, so they were left out of this package.
- `glow_tracer` (`GeometryTemplate.Scale 300`, DC's stationary weapons) moved
  no glb in either DC tree. Why was not chased.

## 8. Open

- The vertex side and the bounding box in SM-13 rest on one reading. Still
  unread: whether a LOD's distance compare uses the scaled radius, and how
  `PointPhysics` wheel contact uses a scaled wheel. DC's wheels at 0.9 to 0.95
  are drawn smaller than the probes that hold them up, which the viewer's
  measured wheel radius (`tracked-vehicle.js` `measureWheelRadius`) now
  follows.
- No viewer code reads `collision-meshes.json`'s `scales` yet. A face-side
  hull of a scaled geometry (the AC-130 fuselage, the Pickup hull) is still
  read unscaled by `hull-bodies.js`.
- The engine draws a scaled mesh scaled but measures it unscaled: the
  instance's bounding box and radius are the file's (SM-13; the template's
  `loadHeader` `0x083a6200` reads the box off the file and nothing but the
  instance ctor and `getScale` reads the template's scale), and so are the
  vertex probes. Baking the scale into the glb's positions makes every viewer
  measurement taken off the drawn mesh read the scaled size instead. None of
  these divide `geometryScale` back out yet (review, 2026-10-07):
  - `aircraft.js` takes a Spring's ground contact off its drawn wheel. The
    AC-130's main wheels (x1.15) now meet the ground 0.107 m lower and its
    nose wheels (x0.88) 0.085 m higher; the engine's probes are the file's
    B17 wheel at 0.688 m below the axle.
  - `tracked-vehicle.js` `measureWheelRadius` (the M-109's and M2A3's front
    wheels, x0.9 and x0.92): the spin rate, and the contact depth when the
    spring has no col0 probe. The engine's `SpinWheel` `0x0825b440` takes its
    radius off the wheel's collision interface (IID `0x492fe0fe`, vt `+0x1c`),
    which is unscaled.
  - `seat-camera.js` `chaseRadiusTree` (`getBoundingRadius`): the AC-130,
    Pickup and Technicals, and XPack2's Wasserfall (3.82 m file, 3.36 m drawn).
  - `gun-groups.js` `meshRadius`, a round's drag radius: DC's 40 mm rounds at
    0.6, inert today because none of them carries `mass` and `drag`.
  - `hand-fire.js`'s repair and heal reach (`getRadius() + repairDistance`).
- XPack2's Flettner loses its three `FlettnerInvisibleWheel` springs with
  their collision, because the assembler drops a `createInvisible` part
  whole. The engine only hides it. The real gear (y -2.3 to -2.35) still
  carries the hull on flat ground; the invisible ones sit higher (y -2.1) and
  wider (x +-1.3, z -2.5 and 3.0), so what goes is the outrigger that stops it
  tipping. The same rule already drops Elco's Willy wheels and some KettenKrad
  springs.
- `test_nav_baked` Bocage passes on the merge with current main (review,
  2026-10-07); the 306 failures were the branch base's.
