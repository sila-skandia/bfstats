# What C does to a soldier

Stream W5-E of the 2026-09-19 parity round, item 2. The owner: *"when you're in
a parachute you can change the view using C, to rotate the view of the falling
soldier."* This is what the engine says about that, and what the viewer now
does.

**The binary.** `/home/dylan/projects/public/bf42plus/bf1942_lnxded.static`
(md5 `59bc08cae90239eef86830db180ed100`), the Linux dedicated server, not
stripped. Decompiles through
`features/bf1942-engine-reference/lnxded/decompile.sh`. The client
(`BF1942.exe`) was consulted through the GhidraMCP bridge for the two string
lookups noted below and nothing else.

**The data.** `~/.wine/drive_c/EA Games/Battlefield 1942/`.

---

## 1. The key is real, and it reaches infantry

`c_PIToggleCameraMode` is **input channel 26**. Decoded by walking the
`addConstantHelper(std::string const&, unsigned int)` calls (`0x083f7f40`)
inside `dice::ref2::io::Module::init()` (`0x083f8870`) and pairing each
pushed string with its pushed index — the same sweep AI-2 did, re-run here as a
check. The 55 channels come out in this order, and three of them matter:

| index | channel |
|---|---|
| 22 | `c_PIMenuSelect9` — PARA-4's ripcord bit, which is how the sweep is known to be aligned |
| 26 | `c_PIToggleCameraMode` |
| 27 | `c_PIToggleCamera` |
| 30-33 | `c_PICameraMode1`..`4` |

The shipped control maps bind 26 to C in every context:

```
Mods/bf1942/Settings/Default/Controls/{Infantry,Land,Air,Common,Common_Japanese}.con
ControlMap.addKeyToTriggerMapping c_PIToggleCameraMode IDFKeyboard IDKey_C c_CMNonRepetive
```

`grep -n 'IDKey_C\b'` over that directory returns those five lines and nothing
else, so C is bound to one trigger and it is this one. `Infantry.con` is the
set that matters: the key does reach a soldier.

`c_PICameraMode1`..`4` are F9-F12 in the same files — the free-camera /
cinematic modes, not this.

---

## 2. What a soldier's camera is allowed to be

`Camera::setViewMode(CameraViewMode, IObject*, bool)` (`0x081ac7c0`) is a
switch over the mode id in which **every arm is gated on one byte of the
camera's template** and returns 0 — refusing the change — when that byte is
zero:

| mode | template byte | notes |
|---|---|---|
| `3` | `+0x1bc` | also calls `BFSoldier::setFirstPerson(true)`; `0` is folded into `3` at the switch head |
| `0xc` | `+0x1bd` | `CVMChase`; W4-C read the offsets this mode flies in `Camera::getTransformation` |
| `0xd` | `+0x1c1` | `CVMFrontChase` |
| `0xe` | `+0x1be` | fly-by |
| `0x10` | `+0x1bf` | plants the eye 20 m along the object's own forward |
| `0x11` | `+0x1c0` | uses the externally supplied transform at `Camera+0x8c`/`+0x90` (`setExternCameraTrans` `0x081ada50`) |
| default | — | `return 0` |

On success it writes the new mode to `Camera+0x14c` and the old one to
`Camera+0x250`, which is what `getViewMode` (`0x081acc10`) and `prevViewMode`
(`0x081ad9c0`) read.

`CameraTemplate::CameraTemplate()` (`0x081acc20`) seeds `+0x1bc`, `+0x1bd`,
`+0x1be` and `+0x1c1` to **1** and `+0x1bf`, `+0x1c0` to **0**. So a camera that
authors no `CVM*` word at all allows inside, chase, front-chase and fly-by and
refuses the two trace modes — which is why the only vanilla templates that say
anything are ten artillery pieces asking for `ObjectTemplate.CVMExternTrace 1`,
and the soldier.

Which of `+0x1bf` / `+0x1c0` is `CVMTrace` and which `CVMExternTrace` is
**inferred** from case `0x11` being the arm that reads the externally set
transform, not read from a registration. Nothing depends on it.

`Objects/Soldiers/Common/Objects.con` is the only place in vanilla that writes
all six:

```
ObjectTemplate.create Camera SoldierCamera
ObjectTemplate.setPivotPosition 0/0/0
ObjectTemplate.setMaxSpeed 0/0/0
ObjectTemplate.setHasTarget 0
ObjectTemplate.CVMInside 1
ObjectTemplate.CVMChase 0
ObjectTemplate.CVMFrontChase 0
ObjectTemplate.CVMFlyBy 0
ObjectTemplate.CVMTrace 0
ObjectTemplate.CVMExternTrace 0
```

A sweep of every `.con`/`.inc`/`.tweak` in vanilla's archives for `CVM` and for
`create Camera` finds exactly one soldier camera and these six lines.

`CommonSoldierData.inc` hangs one of them on every soldier
(`ObjectTemplate.addTemplate SoldierCamera`, `setIsFirstPersonPart 2`).
`BFSoldier::getCameras()` (`0x0827f7a0`) returns the `std::list<ICameraObject*>`
sentinel at `BFSoldier+0x3f0` — the same one PARA-3 identified as the free-fall
steering axis, one element. And **`BFSoldier::nextCamera()` (`0x0827f7c0`) is an
empty function**: `PlayerControlObject::nextCamera()` (`0x083186b0`) is the one
that really walks a camera list and wraps, and a soldier does not inherit it.

Nothing in the parachute path touches any of this. `setIsParachuting`
(`0x08276f90`) swaps the drag, sets the state bit, drives the `Parachute`
child's animation and sets four animation states; `handleUpdate`'s two
parachute arms add an acceleration; `handleMessage`'s message 18 calls
`setIsParachuting`. No camera, no camera template, no view mode.

**So the engine's own set for a soldier — standing, falling or under a canopy —
is one view, and `setViewMode` refuses the rest.**

---

## 3. Why that is not the last word, and what UNVERIFIED means here

The dedicated server is not the authority for a camera toggle. **No instruction
anywhere in `bf1942_lnxded.static` reads input channel 26**: the whole image
contains a single `shr reg,0x1a`, and that one is in
`dice::ref2::io::System::cpu_Has_SSE2` (`0x08418e60`). A headless server has no
camera to toggle, which is also the likeliest reason `BFSoldier::nextCamera` is
empty there while `PlayerControlObject::nextCamera` is not.

The consumer is in the client. This stream confirmed the client carries the same
`CVMInside` / `CVMChase` console words (strings at `0x008ef69c` / `0x008ef70c`,
each with one `DATA` xref, to the `ConsoleClass` constructors `FUN_0051a9a0` /
`FUN_0051ab50`) and therefore the same authored `SoldierCamera`, but **did not
find the client's channel-26 handler**. So it is UNVERIFIED whether the client
reaches past `setViewMode`'s CVM gate for a parachutist. Two readings remain
open:

- §2 is the whole story and C does nothing to a soldier in retail either; or
- the client has a parachute-specific path this stream did not locate.

The owner played it and reports the first. That is the same kind of evidence —
shipped behaviour — that bounds PARA-6, and it is treated the same way.

---

## 4. What the viewer does

`tools/bf1942-models/viewer/soldier-camera.js`, framework-free, no imports, so
`tests/soldier_camera_harness.mjs` runs it under node.

- `SOLDIER_CAMERA_CVM` carries `SoldierCamera`'s six words verbatim.
- `SOLDIER_VIEW_CYCLE` is derived from them by `setViewMode`'s own rule — the
  modes whose word is non-zero. It comes out `['inside']`, and that is the
  default a `SoldierView` starts on. **On foot C is a no-op**, which is the
  engine.
- `PARACHUTE_VIEW_CYCLE` is `['inside', 'chase', 'front']`, mode ids 3, 12, 13.
  It is a **viewer choice made to the owner's play, not an engine reading**,
  marked in those words in the module, and `map.html` swaps it in only while
  `soldier.parachuteState === 'open'`.
- `PARACHUTE_VIEW_RADIUS = 3.0` is a viewer number too. `chase-camera.js` takes
  the root's `getBoundingRadius()`, and for a soldier that is exactly the
  quantity PARA-6 cannot pin (1.0 with the `Parachute` child contributing
  nothing, 13.79 with its mesh in full); 3.0 is the distance that frames a man
  and a canopy.

The placement itself is the engine's: `chase-camera.js`'s `chaseTarget`,
`chaseStep` and `chaseEye`, which W4-C read out of
`Camera::getTransformation` (`0x081aaf90`, client `0x005659b0`) — the
`R * (-/+ forward + 0.3 * up)` offset, the 0.6 s velocity lag, the
`1 - exp(-2 dt)` ease and the one-metre floor clearance. The frame is the
soldier's facing, the anchor his drawn eye, and the look-at is the anchor, as
the engine's `lookAt(eye, camM.position, worldUp)` does it.

`map.html`'s share is four small edits:

| where | what |
|---|---|
| the import block (`~975`) | `soldier-camera.js` |
| the `KeyC` branch in `keydown` (`~2416`) | an `else if` for the on-foot case; the vehicle branch is byte-identical |
| beside `footEye` (`~8288`) | the `SoldierView`, six scratch arrays, and `syncFootView()` |
| `onFootCamera` (`~8155`, `~8235`) | one call to `syncFootView()`, and an external branch before the first-person one |
| the near pass (`~13650`) | `&& footView3p.firstPerson`, so the arms rig is not drawn over a chase view |
| the debug hooks (`~14176`) | `__footView()` |

A landing drops the cycle back to the engine's set, and `setCycle` sends a mode
the new cycle cannot reach back to `inside` — so touching down always returns
the page to first person however C left it, and the carried offset is zeroed
with it.

---

## 5. Measured

`localhost:5344`, `map.html?mod=bf1942&map=wake&shots`, a 200 m bail-out,
stepped through `__renderOnce` in batches of ten at `dt = 0.1`:

```
on foot, before any bail-out: {"mode":"inside","modeId":3,"modes":["inside"],"firstPerson":true}
C on foot (engine set of one): {"mode":"inside","modeId":3,"modes":["inside"],"firstPerson":true}
ripcord at t=2.20 y=276.3
  views available under canopy: ["inside","chase","front"]
  C -> {"mode":"chase","modeId":12,...,"firstPerson":false}
  C -> {"mode":"front","modeId":13,...,"firstPerson":false}
  C -> {"mode":"inside","modeId":3,...,"firstPerson":true}
landed t=25.20 state=none hp=30
after landing: view={"mode":"inside","modeId":3,"modes":["inside"],"firstPerson":true}
```

---

## 6. Not done

- **There is no third-person soldier or canopy mesh on the page.** The local
  soldier is drawn as a first-person arms rig parented to the camera and
  nothing else, and `map.html` has no parachute visual at all (the bail-out
  events are logged, not played). So the external views currently frame an
  empty point in the sky. The camera is right; the thing it is pointed at has
  to be built.
- **The client's channel-26 handler was not found**, so §3's question is open.
  The route that looked most likely and ran out of budget: the client's
  `Camera::getTransformation` is known to be at `0x005659b0` (W4-C), so its
  `setViewMode` sibling is nearby, and its callers are the toggle.
- `c_PIToggleCamera` (channel 27) was not chased past
  `BFSoldier::nextCamera()` being empty. On a vehicle it is
  `PlayerControlObject::nextCamera()`, which cycles seats' cameras; the viewer
  does not bind it.
