# Flag cloth posing and the ship chase camera (2026-10-10)

Status: built, patched in place in the vanilla, XPack1, XPack2 and EoD trees
(local); not yet published. Two defects reported on Eve of Destruction's Black
Water, on the Tango landing craft's flag and the PBR's front view.

## 1. A flag on a vehicle or a static hung upside down

### Cause

Every flag cloth (`flagus_m1`, `flagge_m1`, `flagjp_m1`, `flaguk_m1`,
`flagso_m1`, `flagcan_m1`) is an `AnimatedMesh` skinned to `animations/flag.skn`
and posed by `animations/flag.ske`. Its `.sm` and `.skn` hold the authoring
pose: a flat sheet centred on its origin, hoist at +x, with V rising with y, so
the image's top row is at the bottom.

The skeleton's root `Bone01` is `diag(1, -1, -1)` and the chain runs along +x.
Posed at `FlagBlow` frame 0 the hoist is at the bone's origin, the sheet runs
2.14 m out along +x and hangs 1.7 m below, and the image's top row is the
highest. Drawn from the raw `.sm`, the cloth straddles its mast with the image
upside down.

`extract_map._build_flag_cloth` has known this for a control point's cloth
since 2026-09. The flags that ride a vehicle or a static (`AnimatedUsFlag` on
the Tango's mast, a destroyer's ensign, the Type 38's flag) are `AnimatedBundle`
templates that went through the ordinary mesh path and were drawn raw:
1,374 nodes in 434 glbs across the trees (US 623, Japanese 516, German 130,
British 78, Soviet 17, Canadian 5). The viewer's CTF page carried a half-turn
about x of its own to compensate for the standalone cloth glbs.

### Fix

| file | change |
|---|---|
| `bf42/flagcloth.py` | new: the cloth at frame 0 of `FlagBlow`, positions and normals, from the mod's own `.skn`/`.ske`/`.baf` |
| `bf42/assemble.py` | `_mesh_index` poses a mesh whose geometry skin is `animations/flag.skn` (`_pose_flag_cloth`) |
| `patch_flag_cloth.py` | new: the same, in place, for glbs already on disk. Touches only POSITION and NORMAL data and the position bounds; refuses a mesh that is not in its authored pose, so a second run changes nothing; rewrites through the file's inode and refreshes `.glb.gz` |
| `viewer/ctf-page.js` | the half-turn and shift around the models tree's cloth is gone: the cloth glb is posed |

The patched `EoD_Tango.glb` equals a fresh `extract_models.py --mod EoD
EoD_Tango` flag, vertex for vertex (0.0 difference in positions and normals).

The posed cloth is rigid. The wave is still a level-bake clip on control
points only; a vehicle's flag does not wave. That needs the skin and clip
shipped on those nodes the way `_build_flag_cloth` does, and a viewer mixer
that plays them.

### Applying

```bash
cd tools/bf1942-models
python3 patch_flag_cloth.py --mod bf1942 --mod xpack1 --mod xpack2 --mod eod
```

Tree names are the viewer's: `bf1942` is the vanilla tree. DC, DC Final, FH,
FHSW, GCMOD, Pirates and Interstate hold flags too and take `--mod <name>` the
same way (FHSW's scenes are 6 GB to publish). GCMOD ships a different
`flag.skn`/`.ske`/`.baf` from vanilla; the script reads each mod's own.

## 2. The PBR's front view sat under the water

### Cause

`chaseLawFor` gave the engine's law only to a seat whose Camera rides an aim
axis. A driver's does not, so the PBR driver ran the viewer's own framing
(`vehicle-camera.js`: `back`/`up` from the hull's origin). A ship's origin is
its keel. The PBR's floaters sit 2.6 m up its frame, so on Black Water (water
level 75) the node is at y 73.3 and the front view's eye was 1.6 m above that,
at 74.9, a hand under the surface, aimed past the pilot. That framing also
had no floor at all, so it would put the eye under any terrain.

### Fix

- `chase-camera.js` `chaseLawFor(option, ridesTurret, floats)`: a floating
  hull (`occupancy.rootKind === 'ship'`) takes the engine law, anchored on the
  seat's Camera with the 1 m floor over `groundHeight` (`max(terrain, sea)`).
- `vehicle-camera.js`: the legacy chase and front framing keeps the same 1 m
  floor, so no vehicle's external eye goes under the ground or the sea.

Measured on Black Water, in the PBR: the front eye is 6.8 m above the water,
15 m ahead of the hull and looking at the Camera on the bridge.

## What else was checked

| candidate | result |
|---|---|
| Parachute canopy (`Parachute.skn`/`.ske`) | its own skeleton and `open` clip, drawn through the soldier's parachute path; extents agree between bind and rest. Not affected |
| Track belts (thousands of nodes) | bind and `.ske` rest differ by 0.1 to 0.6 m on average, because the engine drives belt bones from the road wheels (`useAsBone`) and not from the rest pose. A known gap (rigid belts), `vehicle-chase-and-tracks` section 2 |
| IS-2 belts | `.skn` and `.ske` rest differ by 2.7 m on average (max 4.6), well out of line with every other tank. Not investigated; look at the skin's bone naming first |
| Soldier bodies, hands, heads | pose through `pose.py` with their clips; not affected |

## Tests

`tests/test_flagcloth.py` (cloth pose, normals, idempotence, the glb patcher),
`tests/test_chase_camera.py` (the floating-hull law), `tests/test_flight.py`
(the legacy floor).
