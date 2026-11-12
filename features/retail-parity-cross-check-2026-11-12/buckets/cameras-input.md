# cameras-input

## Summary

- MATCH: 31 citation groups (about 120 individual addresses and constants; listed below)
- CODE-WRONG: 1 (low)
- LEDGER-WRONG: 1 (low, the same fact as the CODE-WRONG: CTL-3 / features docs)
- DELIBERATE: 4 (one with a wrong retail description in its comment)
- INCONCLUSIVE: 1
- Comment-only drift (low, folded into F5/F6): 3 stale comments

Every gameplay-visible number in the mouse path was re-read on our binaries and agrees: the
device rate law, the sensitivity scale, the wire pack and unpack, the soldier yaw and pitch
gains, the zoom factor's field, the seat twist scale, the chase and fly-by constants, the MLK
thresholds, and the ControlMap rise/fall seeds and slot resolution.

Not reached (time, and they are low value): touch-controls `0x00500628`-`0x0050067a`
(jump-bit gate; the block read is a stance/zoom switch and does not obviously show the
crouch/prone test, see F7); controls.js joystick POV fold `0x0066e8c9`/`0x0066ea28`;
controls-edit SaveAllControls / setKey write rules `0x006c6040`/`0x006c6410` (not re-read
beyond the call sites); page-input console/menu gates `0x004466D0`, `0x00448e41`,
`0x006D42A0`; camera-pivot `T(pivot)*R*bundle` order (only the `+0x168` field read);
the `soldierYawStep` "inside the clamp" condition (only the clamp compares read; the law was
measured on the live server, 2026-10-16/22).

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [low] Grave in DEFINE KEY unbinds the waiting box in retail, as Escape does; the page only cancels
- Code: tools/bf1942-models/viewer/play/controls-screen.js:1175-1180 — `if (!CAPTURE_CODES.has(event.code)) { // Grave is the console's (retail refuses scancode 0x29, 0x006c7678) ... cancelCapture(false); say('unmappable'); return; }`. Escape is handled at :1165 with `unbind()` (`edits().clear(...)`).
- Ledger: CTL-3 "DEFINE KEY takes any key but Grave, which shows `THIS KEY IS NOT MAPPABLE!`; Escape unbinds the box (`setKey("")`) rather than cancelling".
- Third-party: not consulted (our binary settles it directly).
- Our binary: `handleControlsInput` 0x006c67d0: `0x6c67f9 push 0x29; call [edx+0x28]; jne 0x6c7678` (Grave down). Escape: `0x6c680b push 0x1 ... 0x6c6816 push 0; string(0x8c3846 = ""); string(0x8d5710 = ""); call 0x6c6040 (setKey)`. Grave at 0x6c7678 runs the identical sequence: `push 0; string(0x8c3846); string(0x8d5710); 0x6c769c call 0x6c6040`, and only then `push 0x9226c4` (`CONFIRMATION_ILLEGAL_BUTTON_ERROR`) and `call 0x6a74f0` (the popup). Both strings are empty (readmem: `00 00 ..` at both).
- Verdict reasoning: retail Grave = Escape's `setKey("","")` (the box is unbound) plus the "not mappable" popup. The page keeps the old binding.
- Fix: in `takeKey`, for `event.code === 'Backquote'` call `unbind()` and then `say('unmappable')` (instead of `cancelCapture(false)`). Leave other non-CAPTURE_CODES keys as they are (retail's handling of keys with no scancode name was not read). Ledger CTL-3 and features/browser-play-feedback-2026-11-06/README.md:330 / viewer-profile-controls README:420 should say "Grave unbinds the box (the same `setKey("")` Escape makes) and shows `THIS KEY IS NOT MAPPABLE!`".

### F2 [LEDGER-WRONG] [low] CTL-3 says Grave is "refused"; it is unbound-and-refused
- Code: as F1 (code follows the ledger).
- Ledger: CTL-3 (features/bf1942-engine-reference/ledger.md:2276).
- Third-party: none.
- Our binary: as F1, 0x006c7678-0x006c76b9.
- Fix: reword CTL-3 as in F1.

### F3 [DELIBERATE] [low] Controls-screen mouse-axis capture is a 40 px distance; retail is a per-read RATE past +-0.2, and the comment misdescribes it
- Code: tools/bf1942-models/viewer/play/controls-screen.js:130-132 — `/** ... (retail: past 0.2 of its range in one read). */ const MOUSE_AXIS_PX = 40;` used at :1344 on accumulated `movementX/Y` after a 150 ms guard.
- Ledger: CTL-3 "the mouse past +/-0.2 as `Mouse_IDAxis_0/1`" (correct as far as it goes).
- Third-party: not needed.
- Our binary: 0x006c76d5-0x006c76fe `push 1 (relative); push axis; call [eax+0x2c]` = `getAxisValue(axis, relative=1)` (device vtable 0x0091aba0+0x2c = 0x0066ffa0), i.e. the register `0.001 x counts x axisScale / dt` written by `update` 0x0066ffe0. Compared at 0x6c780f `fcomp [0x8eaf50]` (= 0.2f) and 0x6c7820 `fcomp [0x9226c0]` (= -0.2f).
- Verdict reasoning: retail takes the axis when one pump's rate exceeds 0.2 (about 200/scale counts a second: a few counts in one 1/30 s pump), not when a distance is travelled. 0.2 is not "0.2 of its range". The page's 40 px distance with a click-jitter guard is a reasonable browser adaptation, but undocumented as such.
- Fix: keep the behaviour; correct the comment to "retail: `getAxisValue(axis, relative)` past +-0.2 in one read (a rate, 0.001 x counts/s x scale, 0x006c780f/0x006c7820); a travelled distance here is the page's choice".

### F4 [DELIBERATE] [low] floatToFixed: NaN, and float32 intermediates
- Code: tools/bf1942-models/viewer/mouse-input.js:216-223 — `if (!(x === x)) x = 0; // the engine's fucom treats NaN as "<"`; computation in doubles. `fixedToFloat` :245-249 likewise in doubles.
- Ledger: GUN-2b (the wire format).
- Our binary: lnxded 0x08113494-0x081134b2: both clamp compares `fucom; test ah,0x45; jne <keep x>` take the keep branch on unordered, so a NaN is KEPT, multiplied, and `fistpll` 0x08113501 stores the integer-indefinite 0x8000000000000000, whose low dword (returned in eax) is 0: a NaN packs to code 0 = -16.0, not to the centred 2047 the page's `x = 0` gives. Also `0x081134c3 fstps -0x14c / flds` rounds `(x+1)*0.5` to float32 before the `x steps` multiply, and `PlayerAction::get` 0x0815c60b/0x0815c617 rounds `v` and `100 v` to float32 before `frndint`.
- Verdict reasoning: the NaN arm is unreachable from a mouse (and centring is the safer choice for a browser); the float32 roundings can move a value by one code only at boundaries the 0.01 snap absorbs. Neither changes play. The comment's NaN claim is wrong.
- Fix: keep the logic; change the comment to "retail keeps a NaN and packs it to code 0 (-16); the page centres it instead".

### F5 [DELIBERATE] [low] Catch-up cap: local-look.js says the page owns "the same law" as retail; it does not
- Code: tools/bf1942-models/viewer/local-look.js:48-50 — "The engine's backlog collapse was that page clock's rule too (`GameClient::update` 0x0048fca8 `cmp ebx,0x9; jle; mov ebx,1`); the world owns the same law as its FixedStep's MAX_CATCH_UP_TICKS cap." fixed-step.js:40 `MAX_CATCH_UP_TICKS = 12` and `advance` clamps n to 12 (drops the excess).
- Ledger: LOOP-1 (client: `InputManager::update` backlog >10 -> 1; `GameClient::update` clamps >9 -> 1).
- Our binary: 0x0048fca8 `cmp ebx,0x9; jle 0x48fcb6; mov ebx,0x1` (>9 -> 1 tick); 0x0049cfb3 `cmp esi,0xa; jle; mov [esp+0x10],1` and the clock re-based (>10 -> 1, and the pump then gets 1 x tickDt).
- Verdict reasoning: retail collapses a backlog to ONE tick (and pumps the mouse with 1/30, so a long frame's counts become one big rate that can hit the +-16 ceiling), the page clamps to TWELVE. fixed-step.js documents "the cap here is twelve, not nine" as a choice; only local-look's "same law" is wrong.
- Fix: keep; reword local-look.js:49-50 to "retail collapses more than nine to one; the world's FixedStep clamps to twelve instead (fixed-step.js)".

### F6 [DELIBERATE] [low] Stale gain wording in two comments (code is right)
- mouse-input.js:673 "does not inherit the 3:1 asymmetry" — since 2026-10-17 (VIEW-14) the asymmetry is 3 : 2.5 (yaw x3, view pitch 2.5 per register degree); `SOLDIER_PITCH_GAIN` already says so.
- local-look.js:102-105 "turns the view by `input` degrees -- with a x3.0 on the yaw axis alone ... and none on the pitch (0x08274537)": the register has no gain, but the VIEW pitches 2.5 per register degree (`handleUpdate` setRotateXDeg(-2.5 x +0x284); lnxded `ds:0x86d2700` = -2.5 read). world-soldier-tick.js uses `SOLDIER_PITCH_GAIN` = 2.5, so behaviour is right.
- Fix: comments only.

### F7 [INCONCLUSIVE] [low] touch-controls jump gate citation
- Code: touch-controls.js:1448-1449 "the engine sets the jump bit only when neither the crouch nor the prone flag is set (client `0x00500628`-`0x0050067a`)".
- Our binary: the bytes at 0x00500620 do not decode on an instruction boundary from there; 0x0050062f-0x0050067f reads `cmpw $0,[esp+0x2c]`, `call 0x4f5c60; cmp eax,4`, a float compare of `[esp+0x6c]` against 0 and `or eax,0x80` — the 0x80 bit set is consistent with a jump bit, but the crouch/prone tests were not identified in the window read.
- What would settle it: decode from the function start (recorpus on the containing function is not in client-functions.txt) and name `0x4f5c60` (returns a stance enum compared with 4).

## MATCH list

Mouse device and rate law (mouse-input.js, local-look.js)
- DX8 mouse ctor 0x006701f0: axisScale[0..3] = 1.0f at +0x40..+0x4c (0x0067022a), invert bytes +0x50..+0x53 = 0.
- Device vtable 0x0091aba0: +0x2c = 0x0066ffa0 getAxisValue, +0x30 = 0x0066ff20 setInvertAxis, +0x38 = 0x0066ff60 setAxisScale (readmem of the vtable).
- getAxisValue 0x0066ffa0: relative +0x18 / absolute +0x28, `fchs` when invert byte set; no arithmetic.
- update 0x0066ffe0: GetDeviceState(0x14) 0x0066fffe; gate 0x00670028-0x00670037 `fcomp 0.0; test ah,0x41; jne` = skip unless dt > 0; 0x00670039.. `0.001 x lX x scale x (1/dt)` into +0x18; constants 0x8d5bc4 = 0.001f, 0x8c53c8 = 1.0f, 0x8c41ac = 0.0f.
- applyMouseSensitivity 0x006c55f0: setInvertAxis(1, invert) 0x006c561c; `5.0 x s + 0.1` (0x8d646c = 5.0, 0x8c53cc = 0.1); setAxisScale(0) 0x006c566b, (1) 0x006c568a. Sibling 0x006c5580 sets scale 1.0 on both axes (and also resets invert(1) to 0).
- ControlSettings::setSensitivity 0x006eb1a0: bare store + -1.0 sentinel seed, no clamp.
- InputManager::update 0x0049ce70: no-tick frame skips (0x0049cf46 jnp), pump `fild nTicks; fmul tickDt` 0x0049cff7, later ticks pump with ebx (0) 0x0049d02f; backlog >10 -> 1 (0x0049cfb3).
- Wire: PlayerAction::set 0x081128c3 push 16.0f, 0x081128c8 push 12; floatToFixed 0x08113480 (divide, clamp +-1 with 0x86b05ec = -1.0, +1, x0.5 (0x86be450 double 0.5), x((1<<bits)-1), truncating fldcw, 32-bit arm -1); PlayerAction::get 0x0815c5de-0x0815c632 (4095.0 at 0x86c0cf0, 16.0 at 0x86c0cf8, x100 at 0x86b01ac, frndint, /100). (See F4 for NaN/float32 nuances.)
- BFSoldier::handlePlayerInput 0x08273c70: yaw `[ebp-0x29c] x dt x 30` (0x082742fc-0x0827431a, 0x8716b5c = 30.0) into twist +0x288; pitch `[ebp-0x2a4] x dt x 30` fsubr +0x284 (0x0827451d-0x0827453d), clamp against template +0x18c/+0x190; yaw x3.0 at 0x0827457d (0x86c08c8 = 3.0) -> yaw<float> 0x08061db0 -> setTransformation 0x08061690; turn factors loop 0x0827449b-0x082744df (+0xcc on the yaw delta, first machine only); fold -3.0 (0x86d26fc); handleUpdate -2.5 (0x86d2700).
- Seat twist scale: 0x082742aa-0x082742c8 `x 0.6` (0x86c4f68 = 0.6) when the parent is not a SeatObject, seat path 0x082754ba; on foot the scaling block is skipped (0x0827429d je 0x8275508).
- Zoom: 0x08275bdf call [eax+0x114], 0x08275bf2-0x08275c11 both look axes x template +0x270; makeScript 0x0828f0e2 pushes 0x86d313b = "ObjectTemplate.zoomFov ", 0x0828f0b0 pushes 0x86d35e0 = "ObjectTemplate.SoldierZoomFov" (+0x274). setZoom 0x082881b7 refuses while +0x270 < 0. Client 0x0050095f reads [[w+0x4c]+0x3dc] = zoomFov (VIEW-10's +4 subobject note checked: client makeScript 0x0053a62a/0x0053a665 writes zoomFov from +0x3d8 and SoldierZoomFov from +0x3dc of its `this`, and client setZoom 0x005391b7 tests +0x3dc of the template pointer and reads useScope as the byte +0x3d8 — consistent). NB the xref.py note on 0x0053a110 lists makeScript-`this` offsets, which read 4 lower than the template pointer the gameplay code uses.
- Recoil 0x08275c5f-0x08275c8a: yawRecoil/pitchRecoil added to the look axes, +0x544 decremented once per tick (one queued count a tick).
- PlayerInput names (lnxded 0x086c86a5): 0 Yaw, 1 Pitch, 2 Roll, 3 Throttle, 4 MouseLookX, 5 MouseLookY, 6 CameraX, 7 CameraY, 8 Fire, 9 Action, 10 Use, 11 MouseLook.
- VehicleCategory parsing and PCO ctor default 0 — not re-read (ledger MLK-14 verified); profileFor follows it.

Mouse-look key (mouse-look-key.js)
- CameraTemplate ctor 0x081acc20 (and twin 0x081acd0d): +0x1bc/+0x1bd/+0x1be/+0x1c1 = 1, +0x1bf/+0x1c0 = 0, +0x1c2 toggleMouseLook = 0 (MLK-1, CAM-1).
- Trigger threshold 0.5 (lnxded 0x86b05e8, client 0x008c4220); release ease 0.75 per tick (lnxded 0x86ba8cc, client 0x008d1e28) (MLK-2, MLK-3).

Cameras (chase-camera.js, soldier-camera.js, camera-dof.js, camera-pivot.js, soldier-view.js)
- Chase: 1.2 (lnxded 0x86c4f64, client 0x008fb7d0), 0.3 (0x86c030c / 0x008d6434), 0.6 s (0x86c4f68 / 0x008eb33c), -2.0 into expf (0x86c4f6c / 0x008ea538), floor `fld1; faddp` after the terrain call 0x081ac233-0x081ac238 (CVM-2).
- Fly-by: 0.4 (0x86c4f70 / 0x008eb264), 60.0 (0x86c08b8 / 0x008dba44), K = 8.0 at Camera+0x198 (`mov $0x41000000,0x198(%eax)` 0x081a9d9e) (CVM-5).
- BFSoldier::nextCamera 0x0827f7c0 is empty (push ebp; mov; pop; ret) (CAM-1).
- fireInCameraDof: FireArms::Fire tests template +0x264 at 0x0828a1c1; ctor clears it 0x0828d686 (XHIT-12).
- Camera pivot: RotationalBundle::setState 0x081d8110 reads template +0x168/+0x16c/+0x170 (0x081d8289-0x081d82ac) (GUN-3).

Controls and input plumbing (controls.js, controls-edit.js, world-input.js, page-input.js, input-pace.js)
- ControlMap ctor 0x083f0540: `mov $0x3a83126f` (0.001f) into +0x28 and +0x2c (0x083f05e3/0x083f05ea) (MLK-10).
- ControlMap::update client 0x0061bf53-0x0061bf7a: `|primary|` vs `|secondary|` `fcompp; test ah,5; jp keep` — the secondary wins only when strictly larger, primary on a tie (MLK-9).
- clearPlayerActions 0x0815bb90: `ActionBuffer::size > 4` trims (0x0815bbeb/0x0815bc06) (world-input "trims to FOUR").
- Chat open, 0x00446ED0: saves channels 4-7 (mouse-look and camera axes) under their mask bits, `rep stosl` 0x37 dwords to zero every channel value, writes throttle (id 3) from Setup+0x150 (stored at 0x00448c64 from `0x4465d0(3)`), restores 4-7 — page-input.js:280-285's description is right.
- DEFINE KEY thresholds 0.2/-0.2 (0x008eaf50, 0x009226c0) and Escape -> setKey("") (0x006c6816-0x006c683f) (CTL-3; see F1/F3).
- GameClient::update 0x0048fca8 (>9 -> 1) and InputManager::update (>10 -> 1) as input-pace.js:14-16 states (see F5 for local-look's comment).

## F7 settled (fix phase)

SETTLED, MATCH: client 0x00500628 `testb $0x60, 0x50(%esp)` where `[esp+0x50]` is the lower-body
machine's `getCurrentStateFlags` (0x005001f7 `call 0x613440` on `ebp+0x2c0`, stored at 0x005001ff);
0x60 = `c_AsmIsCrouching` 0x20 | `c_AsmIsLying` 0x40 (ANIM-18). Then `[esp+0x2c] != 0`,
`getSoundTrigger` 0x004f5c60 `!= 4` (0x0050063e), the Action float `[esp+0x6c] != 0.0`
(0x00500654-0x00500663), `[ebp+0x140] != 0`, and only then `or eax,0x80` (0x0050067a); every other
path `and 0xffffff7f` (0x0050068c). The citation was right; the comment now names the state
flags rather than "the crouch/prone flag".

## Ledger edits

CTL-3, replace the claim column with:

> **DEFINE KEY takes any key but Grave; Escape unbinds the box (`setKey("")`) rather than
> cancelling, and Grave unbinds it the same way and then shows `THIS KEY IS NOT MAPPABLE!`;
> mouse buttons (left through `PrimaryMouseButton`), the wheel as `MWheelUp`/`MWheelDown`, the
> mouse past +/-0.2 as `Mouse_IDAxis_0/1` (a rate: `getAxisValue(axis, relative)`, one read),
> joystick buttons 0-31 and axes 0-3 past 0.2 from a rest snapshot**

and append to its evidence column:

> Grave (corrected 2026-11-12): scancode 0x29 `jne 0x006c7678`, which pushes the same two empty
> strings (0x008c3846, 0x008d5710) and calls `setKey` 0x006c6040 at 0x006c769c exactly as the
> Escape arm does at 0x006c6816-0x006c683f, then `CONFIRMATION_ILLEGAL_BUTTON_ERROR` (0x009226c4)
> through 0x006a74f0. The mouse test reads `getAxisValue(axis, 1)` at 0x006c76dd/0x006c76ec and
> compares at 0x006c780f (0x008eaf50 = 0.2) and 0x006c7820 (0x009226c0 = -0.2). The page takes
> a 40 px travel instead (a browser choice, controls-screen.js `MOUSE_AXIS_PX`).

Optional, symbols.json note on 0x0053a110 (`FireArmsTemplate::makeScript`): add "offsets are of
makeScript's `this`, an interface subobject at template+4; gameplay code reads them 4 higher
(zoomFov +0x3dc, SoldierZoomFov +0x3e0, VIEW-10)".

## Fixes applied

- F1: tools/bf1942-models/viewer/play/controls-screen.js `takeKey` (~:1175): `Backquote` now
  calls `unbind()` then `say('unmappable')`; other unnamed keys keep the old cancel. Header
  comment :29 reworded. Test tools/bf1942-models/tests/test_controls_rebind.py
  `test_grave_unbinds_the_box_and_is_not_mappable`: expectation `reload` changed from
  `["R", ""]` to `["", ""]` (it encoded the old keep-binding behaviour).
- F2: tools/bf1942-models/viewer/controls.js:100-104 comment; features/viewer-profile-controls/README.md
  section 8 table (Grave row split from the unnamed-keys row);
  features/browser-play-feedback-2026-11-06/README.md row 1 and the Capture bullet. CTL-3 text above.
- F3: controls-screen.js `MOUSE_AXIS_PX` comment: retail's rate test vs the page's distance, on purpose.
- F4: mouse-input.js `floatToFixed`: NaN comment (retail packs code 0 = -16; ours centres on purpose; float32 note).
- F5: local-look.js:48-55: retail >9 -> 1 (and InputManager >10 -> 1) vs FixedStep's documented 12 clamp.
- F6: mouse-input.js:673 (3 : 2.5, VIEW-14); local-look.js:102-107 (register vs view pitch).
- F7: touch-controls.js:1447-1452 comment (state flags 0x60, ANIM-18, PHY-1).
- Tests: `python3 -m unittest tests.test_controls_rebind tests.test_controls` 71 OK (1 skipped);
  `tests.test_mouse_input tests.test_mouse_look_key tests.test_touch_controls` 104 OK.
  `node --check` clean on all five edited JS files. No behaviour change except F1.
