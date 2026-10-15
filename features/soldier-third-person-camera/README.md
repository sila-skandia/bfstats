# The soldier's third-person camera on foot

Status: built 2026-10-15. Checked headlessly on Wake (vanilla) and
Doomed_Budapest (FHSWEurope).

The owner asked for it on 2026-10-15: retail lets you put the camera behind
your own soldier, and it is a good feature. He also described a retail bug:
start a reload while the camera is outside the man, and the gun never
reloads. This page copies the view and does not copy the bug.

## Keys

| key | trigger | on foot |
|---|---|---|
| F10 | `c_PICameraMode2` (CHASE REAR) | the chase view |
| F9 | `c_PICameraMode1` (INSIDE) | first person, exactly as before |
| F11, F12 | `c_PICameraMode3`, `4` | nothing |
| C | `c_PIToggleCameraMode` | nothing |
| VIEW (touch) | | toggles first person and chase (a phone has no F keys) |

Under an open canopy nothing changes: C and F9 to F11 still walk inside,
chase and front ([viewer-soldier-camera](../viewer-soldier-camera/README.md)).

C toggles first person and the chase view on foot: the owner reports that
retail's C does exactly that (2026-10-15). F10 and F9 still go straight to
each. F11 stays dead on foot on purpose. From 2026-09-23 to 2026-09-26 a
standing soldier had all three canopy views on C and F9 to F12, and the front
view kept taking the owner out of first person mid-stride. That cycle was
withdrawn ([viewer-foot-first-person](../viewer-foot-first-person/README.md));
the foot cycle is two views, so C can only ever land in first person or the
chase view.

`?no-soldier3p=1` puts a soldier back on the engine's one view everywhere.

## What the engine says, and why this is a departure

- **CAM-1 (confirmed, dedicated server):** the shipped `SoldierCamera` writes
  `CVMInside 1` and `CVMChase 0`. `Camera::setViewMode` (lnxded `0x081ac7c0`)
  refuses any mode whose `CVM*` byte is zero, and `BFSoldier::nextCamera` is
  empty. Read alone, that gives a soldier one view.
- **CAM-2 (open):** the server never toggles a view mode, and nobody has found
  the client's camera-key handler. So whether the client reaches past the
  `CVM` gate for a soldier is unread.
- The owner plays the retail client and reports a third-person view on foot.
  That report is shipped behaviour, the same kind of evidence that settled the
  canopy's views. The view is built as a **viewer departure from CAM-1**, and
  it is labelled that way in `soldier-camera.js` (`FOOT_VIEW_CYCLE`). The
  client handler stays the open question that would settle it: start from the
  client's `Camera::getTransformation` at `0x005659b0`, look for a
  `setViewMode` sibling near it, and read that sibling's callers.

## The camera, number by number

| quantity | value | source |
|---|---|---|
| offset | `(-forward + 0.3 up) * 1.2 R`, in the soldier's yaw frame, world up | CVM-2, `chase-camera.js` `chaseTarget` (lnxded `0x081aaf90`, client `0x005659b0`, constants `0x86c030c` 0.3, `0x86c4f64` 1.2) |
| ease | `rel += (want - rel - 0.6 v)(1 - exp(-2 dt))` | CVM-2, `chaseStep` (`0x86c4f68` 0.6, `0x86c4f6c` -2.0) |
| floor | eye at least 1 m over the terrain or sea | CVM-2, `chaseEye` (lnxded `0x081ac233`) |
| anchor | the soldier's interpolated eye | CVM-2 (`camM.position`, the soldier camera) |
| swoop out | `rel` is 0 while inside, so F10 eases out of the man over about a second | CVM-2 (the engine stores `rel` from its output in every mode) |
| R | **2.5 m**, so the camera rests 3.0 m behind and 0.9 m above the eye | **INFERRED**, chosen on the frame. The engine's value is the soldier's `getBoundingRadius()`, and PARA-6 leaves that open (1.0 to 13.79) |
| shoulder | **0.5 m** to his right (`FOOT_CHASE_SHOULDER`) | **viewer choice** (review, 2026-10-15). The engine's offset has no sideways term. Straight behind him, his own shoulders hid the weapon he holds at the chest |
| where it looks | the point the aim line first meets, so the crosshair at screen centre covers the hit | **viewer choice**. The engine looks at the anchor, so its chase view never pitches with the mouse |
| aim reach | 300 m, near clamp 2 m | **INFERRED** (`FOOT_AIM_REACH`, `FOOT_AIM_NEAR`) |
| wall pull-in | 0.3 m in front of the first static between eye and camera, at least 0.5 m out | **INFERRED** (`FOOT_WALL_MARGIN`, `FOOT_WALL_MIN`). The engine's law has no wall test. The corpse cam uses the same pull-in |
| field of view | the soldier's 57.3 degrees, whatever the zoom | VIEW-8 for the angle. That zoom does not narrow the chase view is a viewer choice |
| camera shake | none in the chase view | CS-11: the shake rides the soldier's own camera, and the near-pass gate already drops it outside the man |

## Aim, fire and reload

- **Rounds leave the soldier's eye, not the chase camera.** Every armed hand
  weapon declares `fireInCameraDof 1` (XHIT-12), so the round starts at the
  player's camera. In the chase view that means the soldier's eye
  (`soldier-view.js` `footAimEye`, a camera placed at the eye with his view
  yaw and pitch). `hand-weapon.js` `eyeCamera()` hands that eye to the fire
  loop, to `handAimRay` and to the hidden arms rig. The muzzle flash therefore
  sits at the man's gun, and it uses the outside flash (`guns.firstPerson`
  false) rather than the 0.4 m first-person sprite. Whether retail launches
  from the soldier camera or the render view in an outside view is unread.
  The eye is the reading of XHIT-12 that keeps the crosshair honest.
- **The crosshair stays true** because the camera looks at the aim point, and
  the aim point lies on the round's own line.
- **Reload completes.** The magazine change is the hand weapon's own clock
  (`hand-fire.js`, `hw.reload`). It never depended on the first-person rig, so
  it runs the same in every view. The R key starts it, it counts down, and the
  rounds and magazines are written when it ends. Retail's bug, as the owner
  describes it, is not modelled.
- **The body plays the fire and the reload.** `foot-body.js` gained `fires`
  (`Ub_Fire` and `Ub_LieFire` from the grip bundle, for a gun whose clip names
  no weapons) and `reloads` (`Ub_StandReload` and `Ub_LieReload`, the states
  `soldier-actions.js` plays on a bot). `hand-fire.js` asks for them on a
  round and on a reload. These are the same one-shot torso layers the bayonet
  thrust uses. The engine declares no crouched fire or reload state, so a
  crouched man plays the standing one.
- The body, kit, third-person weapon and gait families were already in place
  ([viewer-third-person-soldier](../viewer-third-person-soldier/README.md)).
  The body draws whenever the view is not `CVMInside`, and the first-person
  rig and its shake are gated on the same flag.

## Files

| file | change |
|---|---|
| `viewer/soldier-camera.js` | `FOOT_VIEW_CYCLE`, `FOOT_CHASE_RADIUS`, `FOOT_AIM_*`, `FOOT_WALL_*`, `aimDistance`, `lookAngles`; `SoldierView` `toggles` and `cycle({force})` |
| `viewer/soldier-view.js` | the foot cycle in `syncFootView`, `footChase`, `footAimEye` and `placeAimEye`, `rel` zeroed inside |
| `viewer/hand-weapon.js` | `eyeCamera()` for the fire loop, the aim ray and the arms rig |
| `viewer/hand-fire.js` | `guns.firstPerson` from the view, the body's fire and reload torso |
| `viewer/foot-body.js` | `fires`, `reloads`, `stabFootBody('fire' / 'reload')` |
| `viewer/seat-camera.js`, `viewer/touch-controls.js` | `cycleView({force})` for the touch VIEW button |
| `viewer/test-hooks-soldier.js` | `__footView()` reports `toggles`, `aimDistance`, `aimEye`, `aimDir`; `__footBody()` reports `fires`, `reloads`, `stabKind`, `visible`, `weaponMeshes` (drawn, hidden, gap to the hand) |
| `viewer/map.html`, `viewer/page-input.js` | the bag wiring and a comment |
| `tests/soldier_camera_harness.mjs`, `tests/test_soldier_camera.py` | the foot cycle and its keys, the landing, the aim point, the look angles |

## Checked

Unit tests: `python3 -m unittest tests.test_soldier_camera tests.test_seat_view`
ran 38 tests, OK. The neighbouring suites (chase camera, hand fire, deviation,
grenade charge, damage parity, soldier body, player shot cone, weapon sounds,
features catalogue and others) ran 394 tests, OK, and
`test_gun_one_shots.mjs`, `test_hand_fire_patch_clock.mjs` and
`test_reload_sound.mjs` passed.

`./scripts/verify.sh --skip-e2e` ran the models suite: 6101 tests, three
failures, and none of them comes from this change. Two were node harnesses
that could not resolve `three` because the worktree had no
`tools/bf1942-models/node_modules` link. With the link in place,
`tests.test_gun_burst_edges` and `tests.test_spotter` pass. The third is
`test_viewmodel_rigs_on_disk` for the `fhsw` tree: ten kit items have no
exported first-person rig on disk. That is shared asset state, and no file
here touches it. The models section failed first, so the script never
reached the API tests. This change touches no C#.

Headless (Playwright, Vulkan, `map.html?...&shots=1&botCount=0`, real
`keydown` events for C, F11, F10, R and F9, frames stepped at 1/30 s):

| | Wake (Bar1918) | Doomed_Budapest (SVT40) |
|---|---|---|
| C, then F11, on foot | stays `inside` | stays `inside` |
| F10 | `chase`, body drawn, camera 3.0 m behind, 0.9 m above and 0.5 m right of the eye | the same |
| aim point in the drawn camera (NDC) | (0, 0) | (0, 0) |
| three rounds or one fired in chase | 20 to 17 | 10 to 9 |
| R in chase | `Ub_StandReload` on the body, `reloading` true | the same |
| reload done in chase | 20 rounds, 5 to 4 magazines | 10 rounds, 4 to 3 magazines |
| F9 | `inside`, camera back on the eye (gap 0), body hidden | the same |
| page errors | none | none |

The frames are named `<map>-01-first-person`, `02-third-person`,
`02b-side`, `03a-firing-3p`, `03-fired-3p`, `04-reload-mid-3p`,
`04b-side`, `05-reload-done-3p`, `06-switched-3p`, `06b-side` and
`07-back-first-person`. The `b` frames come from a camera of the driver's
own, beside the man, and show the weapon in his hands. On Wake the soldier
was turned to face the sea (`TURN=pi`), so the aim line runs out to the reach. The green cross is the screen centre, drawn onto the
capture because the page's crosshair is a DOM element. In `03` the round's
puff sits under the cross.

## Review: "the soldier is empty-handed" (2026-10-15)

The review read the first chase frames as a man with no weapon. The weapon
was there. `__footBody().weaponMeshes` reports every mesh under the welded
weapon node, and on Wake the BAR's five gun meshes all draw, 0.25 m from the
right hand. The four that do not draw are its muzzle-flash and shell
emitters, which are hidden until a round fires. A camera beside the man
(`02b`, `04b`, `06b` below) shows the BAR, the SVT40 and the Colt in his
hands. The stand-aim pose holds the gun forward at chest height, and from
straight behind his shoulders cover all of it but a sliver.

The fix is the shoulder offset above: the camera sits 0.5 m to his right and
still converges on the aim point. Measured by drawing the same frame with the
weapon node hidden (the control pass, nothing hidden, counts 0 or near it):

| frame | weapon pixels |
|---|---|
| Wake, chase view, BAR | 231 |
| Wake, after the reload, BAR | 229 |
| Wake, after switching to the Colt | 80 |
| Doomed_Budapest, chase view, SVT40 | 211 (control 32) |
| Doomed_Budapest, after the reload, SVT40 | 179 |

At 0.75 m the BAR's count went only from 231 to 270, because the gun points
away from the camera and so stays foreshortened. 0.5 m is the smaller change
to the engine's offset.

The body follows the weapon in hand the way it always has
(`hand-weapon.js` `loadHandWeapon` calls `ensureFootBody` on every switch).
In the chase view on Wake, slot 2 changed the body to the Colt and slot 3
changed it back to the BAR. The torso plays `Ub_Fire` on the first round
(`stabKind: fire`) and `Ub_StandReload` on R. Those are the clips the bots
play.

**FHSWEurope has no third-person poses for most kit items.** Its tree holds
`RussianSoldier__SVT40.pose.glb` but none for `SVT40Bay`,
`Knife_SVT40Bayonet_ID2` or `RDG33`, the other items of the Doomed_Budapest
kit. Raise one of them and the body cannot be rebuilt, so it keeps the
previous weapon (the run switched to `SVT40Bay` and the body stayed on
`SVT40`). This is a gap in the asset tree, not in the camera. The fix is the
mod pipeline's kit-pose step for FHSWEurope (`mod_pipeline.py`, skill
`bf1942-mod-pipeline`). Bots never switch weapons, so they never show the
gap.

**Closed 2026-10-15.** `extract_pose.py --kit-poses` posed one weapon per
(soldier, kit). The `poses_kit` step now passes `--kits --maps`, which poses
every item the exported levels' kits hand out (`kit_item_pairs`), and it poses
a weapon only a level declares through that level's load (203 Hill's
`Arisaka30`, whose Japanese bots had held the Colt). The guard is
`tests/test_kit_poses_on_disk.py`: every kit item with a first-person rig has
a third-person pose.

## Open

- The client's camera-key handler (CAM-2). Reading it would say whether
  retail's view on foot is this law, and where its rounds start.
- R is inferred. A retail capture of the chase view on foot, with the soldier
  standing on flat ground, would measure it. Measure the man's height in the
  frame against the 57.3 degree vertical field of view.
- The muzzle flash in the chase view was not caught on a frame. It is placed
  at the hidden rig's muzzle off the eye, which approximates the body's gun.
- An automatic's fire torso plays once per clip length rather than looping
  with the burst.
