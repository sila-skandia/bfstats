# BF1942 3D model extraction

Pulls vehicles out of the Refractor archives as textured glTF, and gives them a
viewer to be judged in. Tooling lives in [`tools/bf1942-models/`](../../tools/bf1942-models).

```bash
cd tools/bf1942-models
python3 extract_models.py --list
python3 extract_models.py Sherman Willy PanzerIV Tiger Stuka Elco80 BritishSoldier \
    --out ./viewer/models \
    --texture-fallback WarFront \
    --texture-fallback FH \
    --level-all \
    --configuration-all
```

Then start the `model-viewer` launch config (serves `tools/bf1942-models/viewer`
on :5273). The inspector can switch each vehicle's Build and Skin without
re-extracting it. `map.html` on the same server is the level flythrough.

A level is the same pipeline pointed at a different archive. Tobruk's heightmap,
48 terrain tiles, 750 static objects, conquest vehicle spawners and the env
cubemap come out as one scene:

```bash
python3 extract_map.py Tobruk \
    --texture-fallback WarFront \
    --texture-fallback FH \
    --out ./viewer/maps
```

Open `http://127.0.0.1:5273/map.html`. Click the map (or the fly button) to capture
the pointer; the sidebar stays clickable. WASD flies along the look direction
(pitch included) at cruise speed, Shift slows down, and Q/E (or the mouse
wheel / trackpad scroll) change altitude. A strafes left, D right. Mouse and
trackpad look around; click-drag still looks if pointer lock is unavailable.
Vehicles start hidden
and the viewer only draws objects inside ~700 m unless **render entire map**
is on. Terrain tiles live in the level archive and face +Y after export, with
the sand `detail.dds` multiplied in. The sky is the level's `ENVMAP_G_.rcm`
cubemap. Object lightmaps (the per-instance `ObjectLightmaps/*.tga` bake) are
multiplied on meshes that carry a second UV set. Building and palm textures
that vanilla `texture.rfa` would have supplied are filled from sibling level
archives and from mods that still ship those basenames (`bf1918`, `bg42`,
`FinnWars`, plus the existing WarFront/FH fallbacks). Vegetation is TreeMesh;
buildings are the same StandardMesh assembler as the vehicles. Collision meshes
are omitted from the map scene. `coastline` is the one StaticObjects name that
has no template.

Render deterministic stills of the defaults, or every exported combination:

```bash
node shoot.mjs --views 3
node shoot.mjs --variants --views 3 --out shots-variants
node shoot.mjs --variants --rig --only Sherman --out shots-rig
node shoot.mjs --collision --only Sherman --views 3 --out shots-collision
```

Screenshot names include model, configuration and skin. `--rig` reloads the
model before each input position so one control cannot contaminate the next shot.
`--collision` enables the detailed hit mesh, requires a selectable face at the
centre of each view and records the selected-point marker.

## Review dimensions

The manifest keeps two independent dimensions so the viewer never has to stack
mutually exclusive geometry:

- **Build**: `Complex` is the complete external vehicle and `Wreck` is the
  destroyed root `LodObject` alternative.
- **Skin**: the base mod-chain textures or one theatre-specific level overlay.

The viewer uses the highest-detail mesh. The default remains Complex with whichever
skin has the fewest unresolved textures. `--configuration-all` exports Complex and
Wreck when both exist.

## Why earlier extractions came out broken

Two separate failures, with the same symptom of "the model looks wrong".

### A `.sm` is one part, not one vehicle

`standardMesh.rfa` holds 1,445 `.sm` files for vanilla, and a Sherman is 30-odd of
them: hull, turret, barrel, two track belts, twenty-two road wheels, hatch, the
commander's Browning and its mount. Nothing in the mesh file says they belong
together. `Objects/Vehicles/Land/<name>/Objects.con` does, as a flat replay of
stateful commands:

```con
ObjectTemplate.create Bundle ShermanComplex
ObjectTemplate.geometry Sherman_Hull_M1
ObjectTemplate.addTemplate ShermanTower
ObjectTemplate.setPosition 0/-0.8/0
```

**`setPosition` after an `addTemplate` places that child, not the template being
defined.** Read it as a property of the parent and every sub-part lands on the
origin, buried inside the hull — which reads as "the turret is missing".

Two more rules matter:

- `ObjectTemplate.geometry` names a *geometry template*, not a file.
  `Geometries.con` maps that to the actual `.sm` via `GeometryTemplate.file`, and
  in vanilla **438 of 1,436 geometry templates load a file under a different
  name** (Sherman's `Sherman_MGun_Mount_M1` loads `Tank_MGun_Mount_M1.sm`).
- A `LodObject` lists *alternatives* — `Complex`, `Simple`, `Wreck` — not parts.
  Draw all its children and you stack a burnt-out wreck inside a pristine hull.

### The white ghost mesh

Worth recording because it cost real time and had an innocuous cause. A multiline
regex over a `.con` file will match `renderer.endGlobalCluster`, then let the
whitespace run after the command name cross the blank line and swallow the *next*
line as its arguments. That next line is always a `GeometryTemplate.create`, so the
declaration is lost and the following `GeometryTemplate.file` lands on whichever
template was current — pointing a small sub-part at a whole-vehicle `*_Hull_L1`.

**52 of 1,436 vanilla geometry templates were wrong this way**, across nearly every
vehicle in the game. It renders as a smooth, untextured copy of the whole vehicle
(the LOD hull's texture is a separate `LOD_<name>_h` that mods do not carry) sitting
at the sub-part's position and rotation:

| Vehicle | Template | Was loading | Symptom |
|---|---|---|---|
| Sherman | `Sherman_Canon1_M1` | `Sherman_Hull_L1` | white hull enveloping the tank |
| Willy | `1P_Willy_str_M1` | `Willy_Hul_L1` | white jeep floating at the steering wheel, its LOD wheels at angles that do not line up |
| PanzerIV | `PanzerIV_Hull_Hatch_M1` | `PanzerIV_Hull_L1` | same, at the hatch |
| Stuka | `1P_Stuka_Driver_M1` | `Ju87_Fuselage_L1` | same, in the cockpit |

Parse `.con` a line at a time. See [`bf42/con.py`](../../tools/bf1942-models/bf42/con.py).

### The install has no vanilla `texture.rfa`

`Mods/bf1942/Archives/` holds `texture_001.rfa` (99 entries, a patch) and no base
`texture.rfa`. The ~170 MB base archive every vanilla model paints with is simply
not on disk, so those models cannot be textured from this install at all — no
amount of format work fixes it.

`--texture-fallback <mod>` borrows from another mod's texture archive to fill the
gap, and the viewer says so in a banner. It is a stopgap, not a fix: mods keep
their own art under vanilla names, so Sherman comes out plausible via WarFront
while PanzerIV stays white because no mod ships `texture/P4Main_f`.

### Why it is missing: an interrupted DataField42 sync

Not an install that was always incomplete. `DataField42.exe` at the game root
auto-syncs content from `files.bf1942.eu` on join (`DataField42/Synchronization
rules.txt` → `autoSync files.bf1942.eu`), and one of those runs died mid-transfer:

```
2026-09-07 08:40   93,820,442  bf1942/levels/Kasserine_Pass.rfa
2026-09-07 08:44   96,088,856  standardMesh.rfa
2026-09-07 08:46   63,728,303  bf1942/levels/Battle_of_Britain.rfa
   ... six more large archives, all complete ...
2026-09-07 09:09      720,896  bf1942/levels/Battle_of_the_Bulge.rfa   <- truncated
```

That last file is 704 KiB against a 6–12 MB norm for its siblings, and its entry
table cannot be read at all. Nothing was written after it.

`DataField42/ChecksumCache.yaml` is the sync tool's own manifest — 82 files, 2.06 GB.
Seven of those sizes match no file anywhere in the install, totalling ~364 MB:

| Size | |
|---|---|
| 133,991,686 | consistent with vanilla `texture.rfa`; nothing else that large is absent |
| 98,885,015 | |
| 43,545,765 / 43,385,438 / 40,426,408 | |
| 2,154,299 / 2,052,544 | |

**The fix is to re-run the sync**, not to rebuild the archive by hand — relaunch
through DataField42 and it re-fetches from `files.bf1942.eu`. Delete the truncated
`Battle_of_the_Bulge.rfa` first so it is re-fetched rather than trusted.

Failing that, `~/gaming/bf1942/data.bin` is the FreeArc payload of the anthology
installer (`bf1942-wwii-anthology-setup.exe`, an Inno Setup wrapper around
`unarc.dll`) and carries a pristine copy.

### Measured coverage

How many of the texture references in a mod's own `.rs` files can actually be
resolved from that mod's chain today:

| Mod | Refs | Resolved | |
|---|---|---|---|
| **bf1942** | 1,392 | 86 | **6.2%** |
| bg42 | 3,912 | 2,799 | 71.5% |
| FH | 3,610 | 2,293 | 63.5% |
| WarFront | 2,561 | 1,368 | 53.4% |
| GCMOD | 2,404 | 1,045 | 43.5% |
| FinnWars | 1,966 | 701 | 35.7% |

Vanilla at 6.2% cannot render a textured vehicle at all. Mods ship their own
`texture.rfa` and are unaffected, which is why the install still looks correct in
the mods it is mostly used for.

### Level archives are a texture source too

Level archives carry textures, and the engine resolves against the loaded level
before the mod chain. Across the 53 vanilla level archives there are 2,763 texture
entries — mostly `objectlightmaps/` (1,605) and terrain `textures/` (879), but also
129 in `alttextures/` on Kasserine_Pass and 77 in a plain `texture/` folder. That
is the mechanism behind theatre-specific vehicle skins, and FHSW leans on it
heavily.

The extractor now reproduces the vehicle-skin part of that lookup with `--level`
or `--level-all`. A level becomes a manifest variant only when it supplies at least
one texture referenced by that model and build, so the viewer's Skin selector does
not fill with unrelated maps or duplicate the base render. Level
`objectlightmaps/` remain excluded because they require a separate shader stage and
UV channel.

## How a mesh binds to a texture

A `.sm` stores material *names* only. The texture comes from a `.rs`, and Refractor
looks in two places, nearest first:

| Source | Syntax | Keyed by |
|---|---|---|
| `Objects/<object>/Art/<mesh>.rs` | `shader "Material4" { ... stage { texture "texture/sherBO_f"; } }` | bare suffix |
| `StandardMesh/<mesh>.rs` | `subshader "Sherman_Hull_M1_Material0" "StandardMesh/Default" { texture "texture/sherma_I"; }` | full material name |

Texture paths carry no extension — the engine probes `.dds` then `.tga`. Names are
matched case-insensitively throughout; the archives were authored on Windows and
`texture/sherma_I` is stored as `Texture/sherma_i.dds`.

Only the first stage becomes glTF `baseColorTexture`. Later stages are lightmap,
detail and environment passes with no PBR equivalent. `alphaTest`/`cullMode none`
map onto `alphaMode: MASK` and `doubleSided`.

## The `.sm` format

Reader in [`bf42/stdmesh.py`](../../tools/bf1942-models/bf42/stdmesh.py), following
BfMeshView's `modStdMesh.bas` — the only public description of the layout. All 1,445
vanilla meshes parse.

```
u32 version (9|10)   u32 pad   f32 boundsMin[3]   f32 boundsMax[3]
u8 qflag (version > 9 only)
u32 colCount     -- each a u32 size + that many bytes of collision geometry
u32 lodCount     -- 1 for a simple part, 6 for a full LOD chain
  u32 materialCount
    per material: u32 nameLen + name, 3x u32, u32 primitive, u32 flags,
                  u32 vertexStride, u32 vertexCount, u32 indexCount, u32
    then every material's vertex block, then its int16 index block
u32 cid   u32 csize + csize bytes
```

Vertices are stride 32 throughout vanilla: `position(3f) normal(3f) uv(2f)`.
Vehicle parts are indexed triangle lists (`primitive == 4`); soldier parts are
triangle strips (`primitive == 5`). Refractor is left-handed with +Z forward, so
the exporter negates Z on positions, normals and translations, reverses winding,
and flips the sign of yaw and pitch but not roll.

## How a soldier is assembled

A `BFSoldier` is still a template tree over StandardMesh `.sm` files — the body,
head and hands are separate parts, same as a tank's hull and turret. Three extra
rules keep those parts from stacking:

- **`setIsFirstPersonPart 1` is an alternative view, not an extra limb.** The 1P
  body and arms sit in the same bind pose as the 3P mesh; drawing both puts a
  second torso inside the first. Skip them for a third-person browse model.
- **`setRandomGeometries 3` on `BritSoldierComplexHead` means pick among
  `BritSoldierComplexHead1`..`3`.** The unsuffixed name is not a template. The
  extractor takes variant 1.
- **`setLodValue -0.01` on the simple head is the distant stand-in** for that
  close-up face. Negative lod values are skipped so the two heads do not occupy
  the same neck.

The 3P body and head already live in the same bind, so they stack at the origin
and the exporter only has to pitch the soldier root from Refractor +Z onto glTF
+Y — otherwise a browse camera sees a body lying on its back. That stack is
true for the idle body (arms at the sides) and the head (verts already on the
neck). It is **not** true for the hands. They are `SimpleObject` + `AnimatedMesh`
siblings with their own `GeometryTemplate.setSkin` (`BritLeftHand.skn` /
`BritRightHand.skn`); they are not `bindToSkeletonPart` objects. Each hand `.sm`
was exported in a different bind than the body, so a stack at the origin leaves
one hand at the hip and the other off the chest. Snapping the mesh centroid to
a sleeve vertex is the wrong fix — a waist band picks the coat hem, an
upper-body extreme picks the shoulder. The structural map is the shared forearm
bone: the `.skn` stores rest-pose positions identical to the `.sm` plus a
bone-local offset per influence, so `rest = R * offset + T` recovers each bone's
bind, and the rigid transform between the hand's `Bip01 L Forearm` and the
body's is what parents the hand onto the sleeve. The left supporting hand is
authored with the wrist cocked ~140 deg off that bone (weapon grip), so a
second rotation swings `Bip01 L Hand` onto the forearm's length axis — the
fingers continue out of the cuff instead of sitting perpendicular to it. The
right trigger hand is only ~40 deg off and is left as authored. Helmets are kit parts, not
children of the soldier, so the exported figure is bareheaded. `createSkeleton`
and `.baf` clips are still unused; this pass only applies the bind-pose rigid
align, not a full skin.

`--list` now includes the eight vanilla `objects/soldiers/` templates alongside
land, air and sea vehicles. Mods keep soldier textures under nested folders
(`Texture/ItalyBritts/britt1_r.dds`) rather than `texture/britt1_r`; the texture
pool fills that gap by basename after an exact path miss, which is how
`--texture-fallback` actually paints a British soldier from this install.

## How vehicles move

Almost none of it is animation data. A `RotationalBundle` declares an axis, a range
and a player input, and the engine drives it every frame:

```con
ObjectTemplate.create RotationalBundle WillyFrontWheelL
ObjectTemplate.setMinRotation -30/0/0        -- yaw/pitch/roll triple
ObjectTemplate.setMaxRotation  30/0/0
ObjectTemplate.setInputToYaw  c_PIYaw
ObjectTemplate.setAutomaticReset 1
```

The Willy has no animation file of its own. Four declarations do everything, and one
input drives three parts on two axes — both front wheels yaw ±30° while the steering
wheel rolls ±60° off the same `c_PIYaw`.

Three rules are easy to get wrong, and all three produced visible bugs here:

- **Absent limits mean unlimited, not zero.** A turret traverses a full circle and
  simply declares no `setMinRotation`. Requiring `min != max` before treating an axis
  as animated silently deletes every turret's traverse, leaving only elevation.
- **`setInputTo*` accepts the numeric enum id as readily as the symbolic name**, and
  vanilla mixes them: PanzerIV's MG mount says `setInputToPitch 5` where the Sherman's
  says `c_PIMouseLookY`. The numeric forms in use are 4 (`c_PIMouseLookX`) and 5
  (`c_PIMouseLookY`), fixed by their exact parallel to the 113 and 111 symbolic uses on
  the same axes. `c_PINone` binds nothing and must not yield an axis.
- **Inputs are scoped to a seat, not to the vehicle.** A tank's main gun and its
  commander's MG both bind `c_PIMouseLookY`, but the MG sits inside its own
  `PlayerControlObject` — two players, two mice. Keying on the bare input name welds
  them together so the MG tracks the turret, which neither tank does in game.
- **Rate versus pose is decided per axis by the declared span, never by the template
  kind.** `WillyEngine` declares roll ±5000° on `c_PIThrottle` — not an angle to
  interpolate to but a drivetrain accumulator, integrated over time. `ShermanEngine`
  declares yaw and roll of ±1°, which is a body lean and must be held. Both are
  `Engine`, so keying off the kind spins that 1° lean forever.
- **A rate-driven car Engine is a controller, not the visual rotation target.**
  Willy's four wheel `Spring` templates are descendants of `WillyEngine`. Rotating
  the Engine node moves all four translated wheel positions around the jeep. The
  viewer instead applies the shared accumulated rate to each Spring's local pitch,
  preserving the steering parent and every wheel's local position.

  Across the 68 engine axes in vanilla the two populations do not overlap and nothing
  falls between them:

  | Span | Population | Meaning |
  |---|---|---|
  | 2,250 – 15,000 | 39 axes: every aircraft and boat, plus wheeled land vehicles (Willy, Lynx, KettenKrad) | accumulator |
  | 2 | 29 axes: tracked and half-track hulls (Sherman, Tiger, T34, PanzerIV, Hanomag, Chi-ha) | ±1° lean |

  A threshold of 360° sits safely in that gap.

Boats reuse the same wheel Springs as a hidden drivetrain.
`ObjectTemplate.createInvisible 1` on Elco80's `PT_*Wheel` templates (and two
KettenKrad back springs) means the engine still steers them but does not draw
the mesh — the game shows a water effect instead. The exporter drops those
templates, and any parent left with nothing to draw. Steer and throttle also
have a High/Low `DistanceSelector` pair whose High child is a `1P_...`
cockpit mesh; a browse model takes the Low (third-person) helm and levers
instead. Those remaining RotationalBundles are not put on the Rig panel when
the vehicle has no visible Springs left to drive — otherwise the sliders
would pose a tiny helm with no running gear. Aircraft Engines keep throttle
anyway (that is the propeller). A Willy still has visible wheels, so its
steering wheel stays bound to Steer.

The other three mechanisms, in descending order of how much they matter:

| Mechanism | Used for | Willy | Sherman |
|---|---|---|---|
| `RotationalBundle` | steering, turrets, elevation | yes | yes |
| `.ske` + `.skn` skinned mesh | track belts flexing over road wheels | no | yes |
| `setAnimatedTextureSpeed` | scrolling the tread texture | no | `-0.006/0` (implemented) |
| `.baf` clips | soldiers only — all 1,154 of them | driver poses | driver poses |

`addSkeletonIK Bip01_R_Hand ...` is the join between the two worlds: the vehicle
animates itself, the soldier is animated by clips, and IK pins their hands to the
wheel wherever it rotates.

### Scrolling the tread

`setAnimatedTextureSpeed -0.006/0` slides a mesh's UVs along U. It is why a moving
Sherman's tread appears to run: the belt geometry is rigid, only the texture crawls
over it. Reproducing it in a viewer needs three things that are each easy to miss:

- **The declaration and the materials are never on the same object.** A part with
  several materials arrives from a glTF loader as a Group of Meshes, and the node
  extras land on the Group. Look for the speed on a mesh and you find nothing.
- **A part's children are not its primitives.** The Sherman's eleven left road
  wheels hang off `ShermanTrackL`, so walking the carrier's whole subtree makes the
  entire running gear's texture crawl. Only the node's own primitives may scroll —
  the exporter stamps `templateKind` on every real part node to tell them apart.
- **Materials and textures are shared.** Both the exporter's material cache and the
  loader's dedupe them, so offsetting one in place scrolls every part that happens
  to use the same image. Clone the material *and* the texture per animated node.

One trap on top of those: `Material.clone()` deep-copies `userData` through JSON, so
a Texture parked there returns as a plain object and the renderer dies reaching for
its matrix. Keep that bookkeeping in a `WeakMap` instead.

**The scroll direction is part of the handedness conversion.** The exporter mirrors
Z to get from left-handed Refractor to glTF, and a track belt runs along the
vehicle's Z. Mirroring moves the vertex that carried `U=0` from the front of the
hull to the back without touching its UV, so U now increases the other way down the
belt — and the declared speed has to be negated or the tread runs backwards under
forward throttle. It belongs next to the other conversions (positions, normals,
winding, yaw and pitch), not as a fudge in the viewer. Every animated texture in
vanilla is a track declared as `<u>/0`, so only U needs it.

The declared figure is in UV units per engine tick, which no viewer has, so it is
scaled to per-second at 60 Hz and multiplied by throttle — a stationary tank has a
stationary tread. Nothing in the `.rs` marks *which* material animates, so all three
of the track node's materials scroll, bogies included.

## Collision and armour inspection

A StandardMesh collision block is not opaque. BfMeshView's `modStdMesh.bas` and
the BF1942 Damage System tutorial agree on the useful front of the block:

```text
u32 blockSize
u32 unknown[2]
u32 vertexCount
vertexCount * (f32 x, y, z, unknown)
u32 faceCount
faceCount * (i16 vertex[3], u8 material, u8 flags)
```

The block continues with acceleration data that the inspector does not need.
The exporter reads the vertices and faces, preserves each face's material and
skips only that trailing data. Empty placeholder triangles are discarded.

BF1942 normally tests a projectile against a coarse collision mesh and then a
more detailed one. The parser retains both for research, but the exporter and
viewer expose only the final non-empty detailed layer; the coarse engine
optimization adds no useful feedback. Collision nodes remain children of their
original object-template node, so a turret or wheel hit mesh follows the same
placement and input-driven rotation as the visible part.

The face material is the location-specific defence lookup. For example, the
Sherman hull's detailed layer uses materials 50, 51 and 52. The official tutorial
identifies 50 as the Sherman's rear armour and says the tank range 50–54 generally
increases in protection or represents less vital regions. The root
`ObjectTemplate.material 50` has a different role: it is the general defence
material used for splash damage, not the material of every direct hit.

Direct projectile damage includes an angle term:

```text
damage = MaterialDamage * DamageMod * cos(impact angle) * DistanceMod
```

That is documented Refractor engine behaviour, not an assumption based on real
armour and not a value inferred from vehicle physics. The angle is measured from
the struck collision face's normal: a square hit is 0 degrees and keeps a factor
of 1; a grazing hit approaches 90 degrees and 0. `ObjectTemplate.angleMod` is a
separate control used by physical object-on-object collision damage.

Enable **show armour regions** in the viewer. With no weapon selected the legend
ranks the model's known defence materials from red (inferred most vulnerable)
through yellow and green to blue (inferred most protected) by the documented id
ranges; ids outside those ranges are neutral grey and labelled unclassified.
Select a material id in the legend to paint only that region; select it again to
restore all regions.

Pick a **Weapon** and the colours stop being inferred. Each region is ranked by
the head-on hit points that round actually does to it, read from the
MaterialManager tables (below), and the chip shows the number. A face the weapon
has no table entry for, or is tabled at zero against, is grey and marked immune.
The model's own guns are listed first; the rest are grouped by category.

Clicking a coloured face selects the object part and starts with a square 0-degree
shot. Without a weapon the reading is the angular share of head-on damage, 100% at
0 degrees falling with `cos(angle)`. With a weapon it is hit points against the
vehicle's `hitpoints`, with **shots to destroy** and **shots to critical** from the
root `Objects.con` health and `criticalDamage`, the splash figure at the blast
centre against the vehicle's splash material, and a **Range** slider for the few
weapons that declare distance fall-off. The formula line spells out every factor.

The orange shot arrow points into the selected face and the white arrow is its
surface normal. Drag the orange handle directly or use the angle slider to
approach a grazing hit. Source geometry, collision material, def group and — with
a weapon — projectile, att material and muzzle velocity are under **Technical
details**.

**Compare** is separate from armour inspection. Opponent parks a ghosted second
vehicle to the right and opens a Street Fighter-style VS column between the
hulls. Each side picks its own gun (defaults to that vehicle's heaviest); a
vertical spine of plates (rear / side / nose / front / glacis) grows a tug-of-war
bar from the centre. Fill is head-on damage over the target's HP — a one-shot
fills the lane — and the number is shots-to-kill. The sidebar **Weapon** control
is left alone, so inspecting a face still uses the orange shot arrow and the
selected inspect weapon. Tiger is in the default extract set for the Panzer
matchup (125 HP, plates 51/53/54 against the Panzer's 100 HP and 50/51/52).

## Where the game rules live

The extractor had been looking for `Game.rfa` in `Mods/bf1942/Archives/` beside
`objects.rfa`, not finding it, and treating the damage tables as unresolved. The
archive is there, one folder down:

```
Mods/bf1942/Archives/bf1942/Game.rfa          106,635 bytes, Jan 2004 (patch 1.6)
Mods/bf1942/Archives/bf1942/levels/*.rfa
```

Refractor mounts an archive at the directory its internal paths start with.
`objects.rfa` holds `Objects/...` so it sits at the top; `Game.rfa` holds
`Bf1942/Game/...` and every level holds `bf1942/levels/<map>/...`, so both live
under `Archives/bf1942/`. The folder is called `bf1942` in every mod — `FHSW`,
`DC_Final`, `XPack1` all use it — because it is the content prefix, not the mod's
name. `BF1942.exe` confirms the layout: its hard-coded archive list reads
`menu.rfa`, `Bf1942/game.rfa`, `standardMesh.rfa`, `texture.rfa`, `objects.rfa`...
and it also names `Bf1942/Game/MaterialManagerSettings.con` and
`Bf1942/Game/Init.con` directly, which is why no `.con` anywhere references the
settings file: the engine runs it itself.

Vanilla `Game.rfa` has 70 entries. The ones that matter here:

| Path | Role |
|---|---|
| `Game/materialManagerdefine.con` | 158 `MaterialManager.material N` blocks: `materialAttGroup`, `materialDefGroup`, `materialDamage` |
| `Game/materialManagerSettings.con` | `Run`s the define file, 1,076 terrain modifiers, then `run damage_system/<weapon>` x 50 and `run Collision_Armor/*` x 5 |
| `Game/damage_system/*.con` | per weapon: `attGroup A` / `defGroup D` / `damageMod X` / `setEffectTemplate` |
| `Game/collision_Armor/*.con` | the same shape for object-on-object collision damage |

Ten of the fifty `run damage_system/...` lines name files that are not in vanilla
`Game.rfa` — `GrenadeAxis`, `BF110`, `Carro_Armato_Gun`, `Grant_Gun`,
`Sturmgeschutz`, `Bayonet` and four more. They ship in `XPack1` and `XPack2`
(`Mods/XPack1/Archives/Bf1942/Game.rfa` is 14 entries, eleven of them damage
files). The 1.6 settings file is shared across base game and expansions and the
engine silently skips a `run` it cannot resolve. The loader does the same and
records them as `missingScripts`.

The third piece is in `Objects.rfa`. Every `Projectile` template carries its
attack material, and the template that fires it is the name a player knows:

```con
ObjectTemplate.create FireArms ShermanGunBarrel
ObjectTemplate.projectileTemplate ShermanProjectile

ObjectTemplate.create Projectile ShermanProjectile
ObjectTemplate.material 236        -- direct hit: attGroup 236, "ALLIED LIGHT TANK"
ObjectTemplate.material2 206       -- splash
```

Vanilla has 73 projectiles and 100 launchers. The join is by
`projectileTemplate`; rifle and pistol bullets are all declared in
`Objects/HandWeapons/Common/Weapons.con`, so a bullet's owner is the folder of
the gun that fires it, not the file it was declared in.

### The formula, with the numbers filled in

From the Damage System tutorial in the Mod Development Toolkit, which the
archive contents match line for line:

```text
direct = materialDamage(att) * damageMod(att, def) * cos(angle) * distanceMod
splash = materialDamage(att2) * damageMod(att2, splashMaterial) * (1 - d / radius)
```

`att` is the projectile's `material`, `def` the struck collision face's material,
both mapped through their groups (every vanilla definition sets group = id). A
pair with no `damageMod` line does nothing. `distanceMod` is 1 for every weapon
except pistols and submachine guns, which declare `minDamage 0.5` between
`distToStartLoseDamage` and `distToMinDamage` (20–40 m for the Colt and P38,
40–80 m or 50–100 m for the SMGs); tank and AT rounds have no range term at all.

The Sherman's hull collision faces are materials 50, 51, 52 (plus 46 on the
wheels), and its `Objects.con` says `hitpoints 100`, `criticalDamage 12`:

| Weapon | att, base | vs 50 rear | vs 51 side | vs 52 front | vs 46 wheels |
|---|---|---|---|---|---|
| Sherman gun | 236, 10 | 10 x 10 = **100** | 5 x 10 = 50 | 4 x 10 = 40 | 35 |
| Tiger gun | 239, 11 | 12 x 11 = **132** | 7 x 11 = 77 | 4 x 11 = 44 | 88 |
| Bazooka | 226, 10 | **100** | 35 | 26 | 50 |
| Browning MG | 224, 7 | 0 | 0 | 0 | 2.4 |

A rear shot from any tank gun is a one-shot kill; a Tiger two-shots a Sherman
from the side and three-shots it from the front. That is how the game plays, so
the chain is right. Tank-shell splash (`material2 206`) has entries only against
infantry, scout cars and aircraft — it does nothing to another tank, which the
viewer reports as "no splash entry against material 50".

One more thing the tables settled: the Sherman's fifth collision material, 178,
is a single stray face on each of four road wheels. It appears on 22 vanilla
meshes (bullets, bombs, a hut door), is not defined in the define file and has
no `defGroup 178` line anywhere, so a hit on it does nothing. It is an export
artefact, not armour.

### What the extractor writes

`build_pools` now registers `Archives/bf1942/Game.rfa` for every mod in the
chain (patch archives first, as with the others), and level discovery uses the
same `bf1942/` rule instead of assuming the mod's own name, which was wrong for
FHSW and DC_Final. Each run writes `damage.json` beside `models.json`:
materials, `modifiers[attGroup][defGroup]`, the scripts replayed, the `run`
targets that were absent, and the 100 weapons with projectile, owner, category,
materials, radius, `damageType`, fall-off and rate of fire. Each manifest entry
also lists the launcher templates in its own tree (`Sherman`: `ShermanGunBarrel`,
`Coaxial_browning`, `Browning`). The viewer loads `damage.json` if it exists and
falls back to the inferred ranking if it does not. Reader in
[`bf42/damage.py`](../../tools/bf1942-models/bf42/damage.py).

Not modelled: collision damage (`Collision_Armor/*`, which has a velocity term),
`damageType 4` proximity fuses, splash line-of-sight blocking for soldiers, and
repair rates.

## Verification

The parser regression suite is installation-independent. It covers the line-scoped
command parser, child placement, geometry aliases, input scoping and numeric ids,
rate-versus-pose classification, soldier first-person / random-head selection,
`createInvisible` physics parts, `.skn` bind recovery and forearm hand alignment,
first-person High/Low distance LOD fallback,
both shader forms, collision geometry and face-material export, the
MaterialManager `run` chain with absent targets recorded, material group
aliasing, the direct/splash/distance formulas, the projectile-to-launcher join
and the `Archives/bf1942/` layout rule, triangle-strip
soldier meshes, basename texture fallback, multi-LOD StandardMesh parsing,
heightmap scale, terrain tile origin (including negative `texOffsetY`),
terrain facing +Y, spawn-template team lookup, cubemap Z remap, StandardMesh
lightmap UVs (stride 40), object-lightmap filename keys, paletted TGA
lightmaps, mod-prefix texture fallback, and
TreeMesh collision sentinels:

```bash
python3 -m unittest discover -s tools/bf1942-models/tests -v
./scripts/verify.sh --skip-e2e
```

For visual review, run the extraction command at the top, start `model-viewer`, and
capture the matrix with `node shoot.mjs --variants --views 3`. The filenames make
the Build and Skin comparison explicit.

## Not yet used

- **`animations.rfa`** — `.skn` skins referenced by `GeometryTemplate.setSkin`
  are parsed for soldier hands: shared forearm bones align each hand mesh into
  the body's bind. `.ske` skeletons and `.baf` clips are still unused, so track
  belts stay rigid and the figure does not play idle animation.
- **`.baf` soldier clips and vehicle IK**, which animate occupants rather than the
  vehicle assembly. Helmets and other kit parts are also still separate objects.
- **The coastline mesh**, which some levels name in `StaticObjects.con` without
  an object template.

The next vehicle milestone is still `.ske/.skn`. Map work after that is still
the coastline mesh and restoring a real vanilla `texture.rfa` so palms and
houses do not have to borrow from other mods.

## Requires deep dive

- **Collision damage.** `Collision_Armor/*.con` is parsed into the same tables but
  the viewer does not apply it: the documented formula adds a velocity-squared
  term and a height term for falling soldiers, and needs a relative speed the
  inspector has no source for.
