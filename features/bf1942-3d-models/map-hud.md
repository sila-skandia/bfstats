# Flags, spawn points and the map

What shipped from the investigation in [`spawn-points.md`](spawn-points.md) and
[`minimap-and-fullmap.md`](minimap-and-fullmap.md), against the plan in
[`map-hud-plan.md`](map-hud-plan.md).

What is new: control-point flags standing in the 3D scene — skinned, flapping
and audible — a HUD minimap at the top right, and a fullscreen map on `M`.

## The two findings that shaped it

**A flag is not an engine primitive.** Every control point is
`ObjectTemplate.geometry flagbase_m1` (the pole) plus
`ObjectTemplate.addTemplate AnimatedFlag` at `setPosition 0/8.2/0` (the cloth),
both named by the level's own `<mode>/ControlPointTemplates.con`. A map that
shows a bare capture zone is one whose author removed those names — there is no
engine-side switch. Four mechanisms do it, and all four had to be handled
separately or a different level breaks on each:

| mechanism | found in | handled by |
|---|---|---|
| the lines commented out | vanilla `Kasserine_Pass`, all five flags | `ControlPointTemplate.visible` — no `geometry` parsed |
| a blank argument | `FH/Pegasus` | `visible` — empty string, distinct from absent |
| an unresolvable name (`null`) | `DesertCombat/DC_Sea_Rigs` | `visible` — name blacklist |
| a real but empty mesh (53-byte `nothing.sm`) | Interstate 82 | the assembler returning no node; only it can see this |

A fifth case is not zone-only but breaks the same code path: vanilla
`Coral_Sea` ships no `ControlPointTemplates.con` at all, and no
`ControlPoints.con` either — it is carrier versus carrier, decided on ship
kills. It does ship 24 soldier spawns, so gameplay-mode discovery keys on
either file, not just control points.

**Team colour is a whole-mesh swap, never a texture swap.** All six vanilla
flags bind the same `texture/flags_o` atlas and differ only by the UV rect
baked into the `.sm`. The level says which mesh belongs to which side with
`setTeamGeometry <team> <mesh>`, and the mesh it names belongs to the
`AnimatedFlag` child — whose own geometry is the placeholder `flagso_m1`.
Before this was parsed, every flag on every map flew Soviet colours.

Neutral points get a bare pole. Vanilla neutral points declare team geometry
for 1 and 2 only, so falling through to the placeholder would fly a Soviet flag
over Midway. Mods that do declare `setTeamGeometry 0` get the neutral flag they
asked for (190 templates across the installed mods do).

## The projection, which the map-images skill had wrong

The map art frames the level's **active combat area**, not the world:

```
Game.setActiveCombatArea minX minZ sizeX sizeZ    (Init.con; absent -> 0 0 worldSize worldSize)
u = (x - minX) / sizeX
v = 1 - (z - minZ) / sizeZ
```

Declared as origin plus size, not two corners — Berlin's `1536 1536 512 512`
is only readable that way. `x / worldSize` looked right because most levels
declare no combat area, but **142 of the 1018 installed levels declare a
sub-world one** and every marker lands wrong on them. Berlin is a 4x error per
axis.

`scene.json` carries this as an affine so the viewer never re-derives it:

```
u = m[0]*x + m[1]*z + m[2]
v = m[3]*x + m[4]*z + m[5]
```

with `(x, z)` in glTF world metres. Note the `v` row carries two inversions
that **cancel** to a positive scale — the image's V runs down, and the exporter
has already negated Z. Getting one of them twice puts Wake's beach at `v =
1.349`, off the image entirely. `test_control_points.py` pins this.

This is a live bug in `scripts/extract_map_dossiers.py:744`, which still uses
the naive rule for the stats site's dossier markers. Not fixed here — it needs
a dossier re-run.

## What `scene.json` gained

Additive only. Every key is optional and a `scene.json` written before this
loads unchanged.

```jsonc
"gameplayMode": "Conquest",
"controlPoints": [{
  "name": "The_Airfield", "displayName": "The_Airfield",
  "position": [1383.75, 115.998, -775.193], "rotation": [0, 0, 0],
  "team": 2, "radius": 50.0, "areaValue": 20.0,
  "spawnGroupId": 2, "objectSpawnerId": 2, "unableToChangeTeam": false,
  "flagMesh": "flagus_m1", "flagHeight": 8.2,
  "visible": true            // false = the level meant this as a bare zone
}],
"soldierSpawns": [{
  "name": "AxisSpawnPoint_beach1", "position": [1189.44, 97.8155, -708.1],
  "rotation": [0, 0, 1.5e-05], "group": 1, "spawnId": 0,
  "team": 2                  // inherited from the flag whose spawnGroupId matches
}],
"minimap": {
  "image": "minimap/minimap.png", "pixels": [512, 512],
  "source": "bf1942/levels/Wake/Textures/InGameMap.dds",
  "worldToImage": [0.00048828125, 0, -0, 0, 0.00048828125, 1.0]
}
```

`objects.controlPoints`, `objects.soldierSpawns` and `objects.flagCloths` were
added to the existing counters, plus `objects.flagsUnskinned` listing any cloth
that could not be built. `maps.json` is untouched.

Soldier spawns are markers only. Zero of the 41,086 `SpawnPoint` templates
across the installed mods carry a `geometry` — there is nothing to render.

## Flags in the 3D scene

Baked into `scene.glb`, and flapping.

**The cloth is not a StandardMesh**, which is what the level's `addTemplate`
makes it look like and what the first cut of this treated it as.
`Objects/Items/Flag/Geometries.con` declares every flag as
`GeometryTemplate.create AnimatedMesh` with `setSkin animations/flag.skn`, and
`AnimatedFlag` adds `createSkeleton animations/flag.ske` and
`setAnimationState FlagBlow`. Exported from its raw `.sm` the cloth sits in its
authoring pose — a flat sheet centred on its own origin, bounds
`x -1.03..1.10, y -0.64..1.04` — so placed at the declared `0/8.2/0` it
straddles the top of an 8.52 m pole and reads upside down.

Posed through the skeleton it hangs where the engine draws it: entirely to one
side (`x 0.02..2.14`) and entirely below the attachment (`y -1.70..-0.03`).
Measured on Wake's airfield flag, the exported cloth spans `x 1383.77..1385.89`
against a pole centred at `1383.75`, and `y 122.59..124.16` under an attachment
at `124.20` and a pole top at `124.52`.

**The bind pose is chosen, not solved.** Every flag vertex carries exactly one
influence at weight 1.0, so a bone's bind *rotation* is unconstrained — which
is why `pose.refine_binds`, which recovers rotation from three points per bone,
returns an empty dict here and `remap_influences` maps everything to `None`.
Any consistent choice works. With `bind = (identity, rest - offset)` the
inverse bind takes a vertex to its bone-local offset, so glTF's
`jointWorld * inverseBind * v` reduces to `posed_world * offset` — exactly what
`pose.skinned_positions` computes.

Each flag gets its own joint hierarchy and its own `FlagBlow <name>` clip, 49
frames over 20 bones. `.baf` stores no frame rate, so playback is a viewer
choice; 30 fps puts a cycle at 1.63 s. The viewer starts each clip at a random
phase — without it five flags on one map beat as one object, and the engine
avoids the same thing in sound with `randomStartPitch`.

The node layout is forced by glTF: a skinned mesh node's own transform is
ignored, so the cloth mesh sits at the scene root and all placement lives in
the joints, which hang off an anchor parented to the control point. That in
turn breaks distance culling — `Box3.setFromObject` on a root-parented skinned
mesh boxes its bind-pose geometry around the world origin — so `tagCull` reads
a skinned mesh's extent from its bones' world positions instead.

Flag raise/lower on capture has no data representation anywhere — engine
internal. A static scene shows the flag at its declared height.

## Sound

`AnimatedFlag` carries `loadSoundScript Sounds/flag.ssc`: one looping
`flag.wav`, `minDistance 2`, `randomStartPitch 0.25`, and a distance-to-volume
`Ramp` with params `(4, 15, 1, -1)` — full at 4 m, gone by 15 m.

`scene.json` gets one `sounds.flags` entry: the sample, the ramp, and a
position per flag that actually flies a cloth (a neutral point's bare pole has
nothing to flap, and a zone-only point has no pole). The viewer feeds those to
the **existing** area-emitter pool as one-point emitters, which costs no new
audio code and inherits the behaviour that pool already has: emitters sharing a
file collapse to a single voice anchored at the nearest one. That is what keeps
five flags from phasing against each other, and it is the same reason the
shorelines do it.

## The viewer

| | |
|---|---|
| HUD minimap | top right; north-up with a rotating heading arrow, which is the game's own shipped default (`game.setStaticMinimap 1` in every stock profile). Shows a quarter of the art centred on the camera, plus a live grid reference. |
| Fullscreen map | `M` — the game's own `c_PIMap` binding in all five vanilla control maps. `N` (`c_PIZoomMap`) is left free for a zoom cycle. Whole art with flags, capture radii, spawn dots, labels and the combat-area outline. `Esc` closes it before it releases the pointer. |

Both surfaces are 2D canvases over the existing stage. Marker sizes are
specified in CSS pixels and multiplied by the canvas backing ratio, so a flag
is the same size on the 188 px widget as on the fullscreen map and stays put on
a hidpi display.

Zone-only control points still appear on the map, as dashed rings — the place
is capturable even though the level draws nothing there.

## Reproduce

```bash
cd tools/bf1942-models
python3 extract_map.py Wake --out ./viewer/maps
python3 -m unittest tests.test_control_points
```

`--skip-existing` on `extract_maps_all.py` is a resume, **not** a schema
upgrade. A partial run leaves maps on mixed schemas.

Six FHSW/FHSWEurope level archives fail to open at all
(`unpack requires a buffer of 4 bytes` out of the `RfaArchive` constructor).
Pre-existing and unrelated to any of this.

## Open

- Whether `setTeamGeometry` retargets the flag child or the ControlPoint's own
  geometry. Five independent data arguments point at the child and none at the
  parent, and the child reading produces correct flags on every level checked,
  but no engine code was read. See `spawn-points.md` §9.
- 55 mod control points carry `setTeamGeometry` with no `addTemplate`. They get
  a pole and no cloth here.
- Vehicle spawner icons (`setMinimapIcon`) are parsed by nothing yet; the full
  map does not draw vehicle markers.
