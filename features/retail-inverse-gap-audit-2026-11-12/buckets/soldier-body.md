# soldier-body

## Summary

30 ledger rows read, plus a sweep of `BFSoldier::` / `BFSoldierTemplate::` in lnxded and of every state
vanilla `animations.rfa` declares (`AnimationStates*.con`, dumped from the real archive).

| Class | Rows | From the sweep |
|---|---|---|
| BUILT | 26 | — |
| NOT-GAME | 1 (PHY-29) | — |
| PARTIAL | 2 (BODY-2, BODY-15 by the same gate) | 3 |
| MISSING | 0 | 5 |
| DIFFERENT | 0 | 0 |
| UNREAD | 1 (PARA-9) | 1 (swim speed) |

Top findings by impact:

1. **PARTIAL, high.** Outside a replay a third-person soldier never plays the jump, the backward run or the
   weapon draw. The clips are baked into every tree but only `followRecorded` enters them. Live bots, remote
   players and your own chase-view body jump stiff-legged, step forward while backing off, and swap weapons
   without drawing them.
2. **MISSING, medium.** No hand signals on a shout (`HandSign_Freeze/Come/Medic/Shout/Down/Roger/Negative`).
3. **MISSING, medium.** The M1 Garand's clip eject has no animation. `startedEjecting` sets
   `Ub_StandEjectClip<W>` / `Ub_LieEjectClip<W>`, and the weapon gets its own `WeaponEjectClipM1Garand`.
   We play only the ping.
4. **MISSING, low-medium.** No turning on the spot (`Lb_TurnLeft` / `Lb_TurnRight` on mouse-look X) and no
   third-person idle fidgets (`Ub_Idle<W>1..3`, `Ub_CrouchIdle<W>1..3`).
5. **PARTIAL, low-medium.** On a stance change, the torso gate keeps a reload or a draw but not the fire timer.
   So a bolt rifle's `Ub_Fire` is cut and its bolt cycle is lost when a bot crouches or drops prone right
   after a shot.
6. **MISSING, low.** Touching collision material 99 (the 275 kill faces inside vanilla's closed buildings)
   does not kill a soldier.
7. **MISSING, low.** No faces: no lip-sync visemes (`addSpeakConnectionSymbol`), no `Face*` states.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [PARTIAL] [impact: high] [effort: M] Jumps, the backward run and the weapon draw are played only in replays
- Retail: these states are entered from input on every soldier. `Lb_Stand` / `Lb_Walk*` / `Lb_Run*` carry
  `addTransitionOne c_PIAction 0.5 1 Lb_StandJump / Lb_RunJump`, and `c_PIThrottle -1 -0.5 Lb_RunBackward`
  (own clip `3PRunBackLower.baf` -1.6). `Lb_WalkBackward`, `Lb_CrouchBackward` and `Lb_LieBackward` play their
  forward clips at negative rates. The engine sets `Ub_StandRaiseWeapon<W>` by name when the held item changes
  (`soldier-locomotion-animation/README.md` sections 10 and 12; vanilla `AnimationStatesLower.con`).
- Ours: since 2026-10-29 the bundles bake `LOWER_ACTIONS` / `UPPER_ACTIONS` in every tree. But
  `soldier-actions.js` `followRecorded` and `RECORDED_STATES` enter them only from a recording's state, and
  `bot-visuals.js` (around line 1300) builds `recordedStates` only when `bot.recordedLower` is defined, which
  `replay-bodies.js` alone sets. A live body's gait is `botClipFamily(speed, stance)`, which by its own comment
  is "unable to say backward". `POSE_FLAG_JUMP` (`walking-body.js:1081`) drives no clip.
- A player notices: in any live match, Instant Battle or multiplayer, other soldiers jump with their legs
  planted, backpedal on forward-walking legs, and swap weapons without lowering and raising them. Your own body
  in the F10 chase view does the same.
- To build: feed `SoldierActions` live events: the jump (the body's `POSE_FLAG_JUMP` rising edge, run or stand
  by speed), the backward sign of the throttle (the bot's input, or the remote's ghost if it carries one), and
  an item change (`Ub_<Pose>RaiseWeapon` through the same `enter`). Files: `bot-visuals.js` (the
  `recordedStates` block), `soldier-actions.js` (a live counterpart of `followRecorded`), and `remote-gait.js`
  (a `reverse` for live gaits). For remotes it also needs `net-relay.js` / the server's soldier snapshot to
  carry the jump bit and the backward sign, if they do not already.

### [MISSING] [impact: medium] [effort: M] Hand signals on a shout
- Retail: on foot, a shout plays `BFSoldier::playVoice` and then the hand sign (client `0x004feb20`, RADIO-3).
  lnxded `BFSoldier::speakLine` `0x0826e220` and `speak` `0x0826e3e0` both name `HandSign_Freeze` (string
  `0x086d1dd8`, pushed at `0x0826e2bd` and `0x0826e406`), with a "handsign not found" fallback.
  `AnimationStatesFace.con` declares seven one-shots, `HandSign_{Freeze,Come,Medic,Shout,Down,Roger,Negative}`
  (`animations/3P_NoWeapon/Handsignals/3pHandSign_*.baf`, morph 2.5, then `StopDummyState`).
- Ours: `radio.js` carries a `sign` per message, and nothing plays it. `features/radio-and-chat-log/README.md`
  lists "Hand signs on a shout ... not played", and the 2026-09-19 parity round lists it as open. The clips are
  not baked (`git grep HandSign` finds no extractor).
- A player notices: a teammate who shouts "Follow me!" or "Medic!" near you does nothing with their arms. In
  retail they wave or point.
- To build: bake the seven `3pHandSign_*` clips into the gait bundles (`extract_pose.py`). Which machine
  carries them has to be read first: they sit in the face file and return to `StopDummyState`, so most likely a
  third machine laid over the arms. Then play the message's `sign` on the speaker's body from `comms.js`
  `receive`, on foot only.

### [MISSING] [impact: medium] [effort: M] The M1 Garand's clip eject has no animation
- Retail: lnxded `BFSoldier::handleMessage` `0x08277260` gates on a held hand weapon (`+0x268`) and
  `FireArms::startedEjecting` `0x0828f970`. It then sets `Ub_LieEjectClip` (string `0x086d206f`) when the
  current state has `c_AsmIsLying` (flag `0x40`), else `Ub_StandEjectClip` (`0x086d207f`), at `0x082775d8`. The
  weapon name is appended as for every upper state. `AnimationStatesEjectClip.con` gives
  `Ub_StandEjectClipM1Garand` the clip `1PEjectClipM1Garand.baf`
  (1P speed 4 in `1pAnimationsTweaking.con`), `Ub_LieEjectClipM1Garand` the clip `1PLieEjectClipM1Garand.baf`,
  and the weapon channel `WeaponEjectClipM1Garand` the clip `M1GarandEjectClip.baf` (3P speed 2.2). All are
  in vanilla `animations.rfa`, with no 3P body clip. The Thompson states are declared and unused.
- Ours: `hand-fire.js` `stepDryMagazine` runs the eject timer and `playEject` plays the ping (FA-7,
  SND-35). No module names `EjectClip` (arms-rig, viewmodel-anim and extract_pose have no match), and the clip
  never visibly leaves the rifle.
- A player notices: every US rifleman, on every Pacific and Western Front map, fires an eighth round and
  hears the ping while the first-person rifle and hands stay still.
- To build: bake the 1P state and the weapon-channel clip into the Garand's arms rig, as the reload is
  (`arms-rig.js`, the viewmodel extractor). Play it from `stepDryMagazine` when it sets `hw.eject`, then return
  to the pose (`addTransitionWhenDone _POSE_`, morph 10000).

### [PARTIAL] [impact: medium] [effort: S] (BODY-2, BODY-15) The torso's stance-change gate ignores the fire timer
- Retail: BODY-2. The upper transition is set only while `HandFireArms::isReadyToUse` (vt+0x120) answers true,
  and it answers false while the reload, eject or overheat timer runs, **while the fire timer runs**, with a
  pending `fireDelay`, or with an empty magazine. BODY-15 records a grenade throw cut by a stance change, and
  says it is open which tick the gate passed on.
- Ours: `soldier-actions.js` `stanceChanged` keeps the torso for `action === 'reload'` and a recorded draw
  only. A `fire` one-shot is replaced by the stance's torso transition. For a bolt rifle, `Ub_FireNo4` (1.0 s)
  hands to `Ub_StandReloadNo4`, the bolt (ANIM-8). Cut it, and the bolt never plays.
- A player notices: a bot with a K98 or No4 that crouches or drops prone within a second of a shot loses the
  bolt cycle in third person. Bots do this often through their variable poses (BODY-6, BODY-12).
- To build: in `stanceChanged`, also keep the torso while the weapon's fire timer (`hand-fire.js` cooldown) or
  eject timer runs. The body needs a `ready()` callback from the hand weapon. Pin it with the existing
  harness, and check it against BODY-15's recording (`8t224pppqe`, rows 166.99-167.70) so the throw case is
  not broken.

### [MISSING] [impact: low-medium] [effort: S] Turning on the spot, the standing relax and the third-person idle fidgets
- Retail: `Lb_Stand`, `Lb_StandRelax` and the others take `addTransitionOne c_PIMouseLookX -1 -0.01 Lb_TurnLeft`
  / `0.01 1 Lb_TurnRight` (`3PTurnLower.baf`, rates 2.0 / -2.0). Turning while standing shuffles the feet.
  `Lb_Stand` has `addIdle Lb_StandRelax`. The aim states carry `addIdle Ub_Idle<W>1..3`
  (`3pIdle1Thompson.baf` and on, copied to every weapon), and the crouch adds `Ub_CrouchIdle<W>1..3`
  (`AnimationStatesCrouching.con:170-172`). The dwell is ANIM-6's.
- Ours: the first-person fidget is built (`arms-rig.js`, `hand-weapon.js` `fidgetTimer`). The third-person
  body has no idle and no turn: `soldier-locomotion.js:581` folds `Lb_StandRelax` into `Lb_Stand`, and no
  module names `Lb_Turn*`. The torso twist (`setTurnLeftRightAngle`, `mouse-input.js`) is built.
- A player notices: a soldier standing still stays frozen in the aim pose indefinitely and turns on planted
  feet. In retail they fidget with the weapon and step round.
- To build: bake `Lb_TurnLeft/Right`, `Lb_StandRelax` and the per-grip `Ub_Idle<W>n` / `Ub_CrouchIdle<W>n`
  (`extract_pose.py`, `bf42/animstates.py` already parses `addIdle`). Drive them in `soldier-actions.js` from
  yaw rate and from idle time with ANIM-6's dwell.

### [MISSING] [impact: low] [effort: S] Collision material 99 does not kill a soldier
- Retail: lnxded `BFSoldier::handleCollision` `0x0827d3b0` tests `cmpl $0x63, 0x20(%ebp)` (the other side's
  material) at `0x0827d3c8`. At `0x0827dd60` it calls the damage interface's vt+0xf4 with `0x501502f9` =
  1e10 (decoded with `readmem.py - 0x501502f9 hexf`) and returns. collision-response.md section 9.1 counts 275
  vanilla faces, the insides of closed buildings.
- Ours: `crash-damage.js` `classifyContact` returns `'kill'` for hulls, but the soldier's static resolve
  (`soldier-resolve.js`, `body-statics.js` divergence 1) is two-sided. It pushes a soldier out of a face from
  inside and never reads the face's material for damage.
- A player notices: rarely. A soldier who ends up inside a closed building (out of a vehicle against a wall, a
  spawn or a glitch) gets pushed or stuck instead of dying as retail kills them.
- To build: when the soldier's capsule resolve takes a static face of material 99 (the face materials are
  already exported: `nav-map.js` reads them), give the soldier 1e10 through the ordinary damage path. Settle
  first that the one-sided rule (COL-23) puts a soldier on those faces only from inside.

### [MISSING] [impact: low] [effort: L] Faces and lip-sync
- Retail: `BFSoldier::handleFrameUpdate` `0x08271140` calls `AnimationStateMachine::getSpeakConnectionState`
  `0x083274c0` and `playFaceAnimation` (`0x0826e160` / `0x0826e1c0`). `AnimationStatesFace.con` declares about
  30 `Face*` states (`FaceDead1/2`, `FaceHit`, `FaceAim`, `FaceFire1`, `FaceBlink`, `FaceScream`, ...) and the
  speak visemes `Face_normal_{i,e,o,m}` / `Face_angry_*`, mapped to symbols by `addSpeakConnectionSymbol ; _ i e
  ...`.
- Ours: `bf42/animstates.py:101` drops `c_AsmFaceState` states, and nothing plays a face.
- A player notices: almost never. Faces are a few pixels at play distance, and only a close third-person
  look at a speaking or dying soldier shows it.
- To build: needs face bones on the exported soldier skin and a face machine. Leave it for last.

### [UNREAD] [impact: low] [effort: S] (PARA-9) The free-fall look-steering cap is a viewer number
- Retail: four passes read the term as uncapped horizontally (`0x082726a8`-`0x082727cb`). That would fling a
  falling soldier to 165 m/s in 5 s, which retail does not appear to do.
- Ours: `parachute.js` `FREE_FALL_TRACK_SPEED` caps the push at the canopy's terminal glide, 12.28 m/s,
  labelled "A viewer decision".
- What would settle it: a lab recording (skill `bf1942-server-lab`) of a bail-out from altitude with the
  chute held closed, looking level for 5 s, with horizontal speed read from the soldier's samples.

### [UNREAD] [impact: low] [effort: S] Swim speed is a viewer cap
- Retail: unsettled. The box law gives about 2.6 m/s and the point-node law 9-38 m/s (viewer-swimming
  section 22). No recording holds a sustained swim.
- Ours: `swim.js` `SWIM_SPEED_CEILING_FACTOR` caps it at about 2.0 m/s, labelled a viewer number.
- What would settle it: a lab recording of a player swimming a straight line with forward held for several
  seconds.

### [PARTIAL] [impact: low] [effort: S] DIE-8: the upper death state's weapon gate
- Retail: `handleDamage`'s tail skips the upper death state while `+0x268` is set and the held FireArms'
  animation is not ready (DIE-8, open). The same byte and gate as BODY-2.
- Ours: not modelled (`features/soldier-death-animations/README.md`, "Stand-ins and open items").
- A player notices: a man killed mid-reload in retail keeps the reload torso over a dying lower body. Rare
  and brief.
- To build: the same `ready()` callback as the BODY-2 fix, read in `soldier-death.js`.

## From the sweep: retail behaviour with no ledger row

- **Eject-clip body state** (`handleMessage` `0x082775d8`, `FireArms::startedEjecting` `0x0828f970`). See
  above. No ledger row. FA-7 covers only the timer and the sound.
- **Hand-sign trigger on lnxded** (`speakLine` / `speak` push `HandSign_Freeze` `0x086d1dd8`). RADIO-3 cites
  only the client. A row naming the state machine and the fallback string would help whoever builds it.
- **Lower turn states on mouse-look X** (`Lb_TurnLeft/Right`, `3PTurnLower.baf` +-2.0) and the 3P idle
  fidgets (`Ub_Idle<W>n`, `Ub_CrouchIdle<W>n`, `Lb_StandRelax`). These are script data with no row.
- **`BFSoldier::handleCollision` material 99 on a soldier** (`0x0827d3c8` -> `0x0827dd60`, 1e10). The
  subsystem note has it. No row cites the soldier's own branch.
- **Standing on a moving object** (`handleCollision` writes `+0x588`, mac naming; lnxded `+0x55c` is the
  one-second timer): a contact over 0.1 up with a parent hull moving faster than sqrt(0.1) m/s records the
  object. Its readers are `BFSoldierNetworkable::init` / `updateStateMask`, so this is netcode (a ghost
  relative to the hull), not the body's physics. It belongs to the netcode bucket and is not judged here.
- Lower hit states `Lb_Hit{Chest,Back}{Stand,Crouch}` are cached by `BFSoldierTemplate::init` (string
  `0x086d2391` at `0x0827b15f`). `handleDamage` sets the upper alone, and `soldier-actions.js` `hit` matches
  that. Nothing to build.

## BUILT and NOT-GAME, one line each

- BODY-3 BUILT -> `extract_pose.py` `clip_timeline` (backward one-shots at phase 1.0), `soldier-actions.js` `resolve` (clipless states).
- BODY-6 BUILT -> `bot-pose.js` `computeCurrentPose` (Scout and TakeCover components, the water clause).
- BODY-8 BUILT -> `soldier-actions.js` never enters `Ub_FireEnd` / `Ub_LieFireEnd`; an automatic returns to `_POSE_`.
- BODY-9 BUILT -> `soldier-actions.js` `resolve` walks clipless torso transitions; `gaits.json` `stateMachine.clipless`.
- BODY-12 BUILT -> `bot-pose.js` (move 1+14 rand / 10 s, MoveToDirection 1.0 / 5 s), `bot-plans.js` (`createFirePlan`, 0.9 maxRange).
- BODY-14 BUILT -> `bot-pose.js` `POSE_CHANGE_GATE` 10 s, `soldier-actions.js` `stanceChanged` keyed on `bodyPose`.
- BODY-15 BUILT for the replay (`replay-viewmodel.js` `armsTrack`); the live torso gate is the PARTIAL above.
- PHY-11 BUILT -> `swim.js` `SWIM_ENTER_DEPTH` / `SWIM_LEAVE_DEPTH` / `SWIM_FLOAT_DRAFT` over the origin, the camera arm (`eyeUnder`).
- PHY-44 BUILT -> `swim.js` `SwimState.update` (`depth < SWIM_LEAVE_DEPTH`).
- PHY-19 BUILT -> `aircraft.js` water gate, `amphibious.js` `DRY_SCREW_REVS` (a vehicle row, filed here).
- PHY-29 NOT-GAME -> identical for every flown airframe; `aircraftSpec` root-relative gives the same number.
- PARA-3 BUILT -> `parachute.js` (camera forward row, y clamped above 0).
- PARA-7 BUILT -> `parachute.js` sound schedule (`soprupp` at 11.5 s, `fallparachute` at 3.3, `para1..3`; the chute landing silent).
- PARA-9 BUILT as read, with a viewer cap (the UNREAD above).
- PARA-11 BUILT -> `parachute.js` `freeFallBarred`, `kit.py` `overrides_air_movement`.
- ANIM-8 BUILT -> `soldier-actions.js` bolt cycle (`Ub_Fire` -> `Ub_StandReload`), `arms-rig.js`.
- ANIM-10 BUILT -> `arms-rig.js` (per-stance per-weapon 1P upper states).
- ANIM-11 BUILT -> `arms-rig.js` / `viewmodel-anim.js` (crouch = stand-aim clip at its rate; prone's own four).
- ANIM-19 BUILT -> `viewmodel-anim.js` `chainRunning` (1P); see BODY-2 for 3P.
- IK-1 BUILT -> `bf42/con.py` `addskeletonik` (target child = latest added child, -1 the node).
- IK-2 BUILT -> `seat-ik.js` (Y-X'-Z'' degrees through `quat_from_ypr`).
- IK-3 BUILT -> `seat-ik.js` (two-bone reach on i-1/i-2, then the hand's rotation overridden).
- IK-4 BUILT -> `bf42/con.py` (a repeat line rewrites position and rotation, keeps the first target child).
- DIE-1 BUILT -> `soldier-death.js` `pickDeath` order (seat, canopy, swim, free fall, pose).
- DIE-2 BUILT -> `extract_pose.py` `DIE_STATES`.
- DIE-4 BUILT -> `soldier-death.js` (`DieHead` by the head capsule, 1 in 4 `DieSlow`, standing only).
- DIE-5 BUILT -> `armor.js` `lastHit` (the latest collision, not cleared by the blow).
- DIE-7 BUILT -> `swim.js` `SWIM_STATE_FLAGS` (`Lb_DieSwim` hides the weapon, locks free look).
- KNOCK-3 BUILT -> `replay-recording.js` (bit `0x2000` = free fall).
