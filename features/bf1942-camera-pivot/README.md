# Seat camera `setPivotPosition` (2026-09-26)

## The report

Wake, the US M3A1 half-track's gunner seat (the ring-mount Browning). Retail's
first-person view looks along the gun from behind the receiver: the olive
"200 CARTRIDGES" ammo box lower left, the receiver up the middle, the wooden
spade grip to the right, and the crosshair just above the barrel tip. The
viewer put the eye inside the barrel, with the flash hider filling the top of
the screen.

## What retail does

There is no dedicated 1P gun mesh. The seat draws the same third-person meshes
every other seat sees (`M3A1_Browning_console_M1`, `tank_MGun_mount_M1`,
`RiBro_Body_m1`). The difference is where the eye is, and that comes from the
Camera template's `setPivotPosition`.

`Objects.rfa`, `Objects/Vehicles/Land/m3a1/Objects.con`:

```
rem *** M3A1_Browning_console ***
ObjectTemplate.addTemplate browning
ObjectTemplate.setPosition 0/0/-0.349
ObjectTemplate.setRotation -179.999/0/0
ObjectTemplate.addTemplate M3A1Camera2
ObjectTemplate.setPosition 0/0/-0.499
ObjectTemplate.setRotation -179.999/0/0

rem *** M3A1Camera2 ***
ObjectTemplate.create Camera M3A1Camera2
ObjectTemplate.setPivotPosition 0/0.3/-1
ObjectTemplate.setMaxSpeed 0/0/0
```

The Camera node sits 0.15 m up the barrel from the gun's own origin. The pivot
moves the eye 0.3 m up and 1 m back along the gun.

The engine (lnxded, decompiled with `features/bf1942-engine-reference/lnxded/decompile.sh`):

- `Camera::handleUpdate` `0x081aa940`. On the camera's first update, and before
  the `maxSpeed == 0` early return that every gunner camera takes, it sets the
  camera's transform to `T(template+0x168 pivotPosition) * R(angles) *
  getBundleTransformation()`. It is the same product as
  `RotationalBundle::setState` `0x081d8110` (GUN-3).
- Refractor multiplies row vectors. The camera origin therefore lands at the
  bundle's `setPosition` plus the pivot turned by the bundle's `setRotation`.
  The pivot is the eye's offset in the camera's own frame. It is not a hinge.
- `Camera::getTransformation` `0x081aaf90`, in view mode 3 (inside), builds the
  view from that camera's own transform (`vt+0x40`), after camera shake and,
  for the nose cam, `OutsideHudOffset`.

## Who declares one

Vanilla, XPack1 and XPack2 have 13 non-zero declarations:

| pivot | cameras |
|---|---|
| `0/0.3/-1` | `M3A1Camera2` (bf1942), `M3GMCCamera2` (XPack1): the half-tracks' ring-mount MG |
| `0/0.25/0.3` | Willy, Kubelwagen, BlackMedal, Lynx (driver and passenger), XA42, R75, Schwimmwagen |
| `0/0.25/0.2` | `Katyusha_Camera`, `Katyusha_Camera_PcoId1`, `Wasserfall_Camera_PcoId1` |

The Sherman's pintle Browning gets the same view with no pivot. `ShermanCamera2`
is authored at `0/0.3/0.5` behind the gun, so its node already sits at the eye.
The Hanomag, T34 and Tiger MG seats declare no pivot either, so this change
does not affect them.

## The fix

The exporter already shipped the pivot as `extras.physics.pivotPosition` on
every Camera node (`bf42/con.py` `_pivot()`, Refractor frame, z forward), in the
level bakes and in the model trees. Nothing read it. No re-extraction was needed.

`viewer/camera-pivot.js` `applyCameraPivot(node)` adds `quaternion * (x, y, -z)`
to the Camera node's local position. It runs once per node: it stamps
`userData.pivotApplied`, and clones inherit both the stamp and the moved
position. It is called where a vehicle's Camera nodes are discovered:

- `seat-survey.js`: every seat, on foot entry, bots and netcode;
- `vehicle-base.js` `collect()`: the drivetrain's cockpit camera;
- `model-seat-cams.js`: the model browser's seat views.

`vehicle-camera.js` reads the same offset for the look swing below.

Every reader of the node's world pose now gets retail's eye point: the inside
view, the chase anchor, the manned-seat fallback, and `fireInCameraDof` rounds
(the Browning declares `fireInCameraDof 1`).

The jeep and motorbike drivers move too, 0.25 m up and 0.2-0.3 m forward. The
same engine code puts them there.

The look swing is modelled too. Under `R(angles)` the pivot turns with the
camera's own look angles. The half-track MG and the Katyusha's second camera
are `setMaxSpeed 0/0/0`, so their angles stay at zero. The jeep, Lynx and
first Katyusha cameras free-look with `c_PIMouseLookX/Y`. `VehicleCamera`'s
inside view (`vehicle-camera.js`) therefore swaps the node's unturned pivot for
the pivot turned by the head. A Willy driver looking 90 degrees left moves his
eye 0.424 m (`0.3 * sqrt 2`), and it comes back exactly when he looks ahead.

## Verification

Headless Wake with `?mod=bf1942`, M3A1 seat 1, same frame, pivot undone versus
applied. Before: the eye is in the barrel and the flash hider fills the view.
After: the ammo box ("CARTRIDGES" stencil) sits lower left, the receiver runs
up the centre, the spade grip is on the right, and the crosshair is above the
barrel tip. It has the same layout as the Sherman pintle view, whose camera needs no pivot. A
burst from the fixed seat flew about 945 m to the sea. Test:
`tests/test_camera_pivot.py`.
