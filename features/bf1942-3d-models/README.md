# BF1942 3D model extraction

Pulls vehicles out of the Refractor archives as textured glTF, and gives them a
viewer to be judged in. Tooling lives in [`tools/bf1942-models/`](../../tools/bf1942-models).

```bash
cd tools/bf1942-models
python3 extract_models.py --list
python3 extract_models.py Sherman Willy PanzerIV --out ./viewer/models
```

Then start the `model-viewer` launch config (serves `tools/bf1942-models/viewer`
on :5273), or render stills headlessly with `node shoot.mjs --views 3`.

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

Separately, and not yet used by the extractor: level archives carry textures, and
the engine resolves against the loaded level before the mod chain. Across the 53
vanilla level archives there are 2,763 texture entries — mostly `objectlightmaps/`
(1,605) and terrain `textures/` (879), but also 129 in `alttextures/` on
Kasserine_Pass and 77 in a plain `texture/` folder. That is the mechanism behind
theatre-specific vehicle skins, and FHSW leans on it heavily.

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

Vertices are stride 32 throughout vanilla: `position(3f) normal(3f) uv(2f)`,
indexed triangle lists. Refractor is left-handed with +Z forward, so the exporter
negates Z on positions, normals and translations, reverses winding, and flips the
sign of yaw and pitch but not roll.

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
  `Engine`, so keying off the kind spins that 1° lean forever; and because a tank's
  tracks and road wheels are children of its Engine, the entire running gear orbits
  the hull.

  Across the 68 engine axes in vanilla the two populations do not overlap and nothing
  falls between them:

  | Span | Population | Meaning |
  |---|---|---|
  | 2,250 – 15,000 | 39 axes: every aircraft and boat, plus wheeled land vehicles (Willy, Lynx, KettenKrad) | accumulator |
  | 2 | 29 axes: tracked and half-track hulls (Sherman, Tiger, T34, PanzerIV, Hanomag, Chi-ha) | ±1° lean |

  A threshold of 360° sits safely in that gap.

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

## Not yet used

Extraction stops at static geometry. Still on the table:

- **`animations.rfa`** — `.ske` skeletons and `.skn` skins referenced by
  `GeometryTemplate.setSkin`. Track belts are `AnimatedMesh`, and their scroll is
  `ObjectTemplate.setAnimatedTextureSpeed`, so tracks currently render static.
- **Collision meshes**, already located inside each `.sm` and skipped.
- **LOD chains** — every LOD is parsed; only index 0 is exported (`--lod`).
- **Wreck and interior variants** — `ShermanWreck`, and the `1P_*` cockpit meshes
  the LOD rule discards.
- **`treeMesh.rfa`** for vegetation, which is a different mesh format.
- **Per-level lightmaps** in `bf1942/levels/<map>/ObjectLightmaps/`, which is how
  static objects get their baked shading in-game.
