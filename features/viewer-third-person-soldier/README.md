# The third-person soldier

Stream W6-B of the 2026-09-19 parity round. The largest visible miss in the
viewer: nothing drew a human body in the world. The local player was a
first-person arms rig parented to the camera and nothing else, so
`viewer/soldier-camera.js`'s chase and front-chase views — built, reviewed and
merged as `67c12cb` — framed an empty point in space, and were gated off behind
`?soldier3p=1` because a grey void is worse than a key that does nothing.

There is a man there now.

Branch: `worktree-agent-af3de668a9c59003b`. Commits:

| commit | what |
|---|---|
| `ad4ef06` | the pipeline: parachute body clips, the canopy, stance timelines, the one-shot keyframe layout, `--shared-assets` / `--parachute`, a merging `gaits.json` |
| `4d2fe98` | the viewer: `soldier-body.js`, `map.html`'s body and canopy, `?soldier3p=1` off |
| `74544d6` | the canopy's framing, measured on the first frame ever taken of one |
| `5904a7b` | the revert flag really reverts; the death cam keeps its nothing |

---

## 1. What the state machine actually says

The 18 `3PParachute*.baf` clips are real and the briefing's frame counts hold up.
What the **states** name is not what the file names suggest, and the gaps matter.

`python3 extract_pose.py --parachute --out <scratch>` prints the resolution; the
survey behind it is `bf42.animstates` over vanilla's `animations.rfa`.

| baked clip (= the engine's state name) | `.baf` | frames | speed | period | loop | `returnTo` |
|---|---|---|---|---|---|---|
| `Lb_ParachuteFall` | `DieHit/LowerBody/3pExplosionFlyLower` | 22 | 1.0 | 1.000 s | yes | — |
| `Ub_ParachuteFall` | `DieHit/3p/EmptyHands/3pExplosionFlyUpper` | 22 | 1.0 | 1.000 s | yes | — |
| `Lb_ParachuteOpen` | `3P_NoWeapon/3PParachuteOpenLower` | 41 | 0.6 | 1.667 s | **no** | `Lb_ParachuteIdle` |
| `Ub_ParachuteOpen` | `3P_NoWeapon/3PParachuteOpenUpper` | 41 | 0.6 | 1.667 s | **no** | **`Ub_StandAim`** |
| `Lb_ParachuteIdle` | `3P_NoWeapon/3PParachuteGlideLower` | 12 | 1.0 | 1.000 s | yes | — |
| `Lb_ParachuteHitGround` | `3P_NoWeapon/3PParachuteGroundLower` | 6 | 2.0 | 0.500 s | **no** | `Lb_Stand` |
| `Ub_ParachuteHitGround` | `3P_NoWeapon/3PParachuteGroundUpper` | 6 | 2.0 | 0.500 s | **no** | `Ub_StandAim` |
| `Lb_ParachuteDie` | `3P_NoWeapon/3PParachuteDieLower` | 16 | 0.9 | 1.111 s | **no** | — |
| `Ub_ParachuteDie` | `3P_NoWeapon/3PParachuteDieUpper` | 16 | 0.9 | 1.111 s | **no** | — |
| `Lb_ParachuteDeadHitGround` | `3P_NoWeapon/3PParachuteGroundDieLower` | 10 | 1.0 | 1.000 s | **no** | — |
| `Ub_ParachuteDeadHitGround` | `3P_NoWeapon/3PParachuteGroundDieUpper` | 10 | 1.0 | 1.000 s | **no** | — |

Eleven clips, not twelve. The canopy's own two, on its own skeleton:

| clip | state | `.baf` | frames | speed | period | loop | `returnTo` |
|---|---|---|---|---|---|---|---|
| `open` | `OpenParachute` | `Vehicle/Parachute/ParachuteOpen` | 21 | 0.4 | 2.500 s | no | `IdleParachute` |
| `idle` | `IdleParachute` | `Vehicle/Parachute/ParachuteIdle` | 21 | 0.5 | 2.000 s | yes | — |

## 2. Absences — where the data did not have what was expected

Reported the way W5-A reported its 56 `proneReload` absences: as data.

- **There is no `Ub_ParachuteIdle` state.** The glide has no upper-body state at
  all. `Ub_ParachuteOpen` declares `addTransitionWhenDone Ub_StandAim`, so as
  the canopy finishes opening the engine hands the torso back to the weapon's
  ordinary aim — which is exactly why a man under a chute can aim and fire, and
  it is already written down in `viewer/parachute.js`'s `PARA_CLIPS.glide`
  (`{lower: 'Lb_ParachuteIdle', upper: 'Ub_StandAim'}`). The exporter lists
  `Ub_ParachuteIdle` in `PARACHUTE_STATES` **on purpose** so the absence lands
  in the bundle's own `extras.absent` block instead of being assumed away:

  ```
  absent: Ub_ParachuteIdle: no such animation state
  ```

- **`3PParachuteGlideUpper.baf` ships and nothing names it.** 12 frames, 44
  bones, present in `animations.rfa`, reachable by no state. It is the orphan of
  the absence above.

- **`Lb_ParachuteFall` is not `3PParachuteFallLower.baf`.** The free-fall state
  names the *explosion-fly* clips (`3pExplosionFlyLower` / `3pExplosionFlyUpper`,
  22 frames) — a man blown off his feet, reused for a man falling off a wing.
  `3PParachuteFallLower.baf` and `3PParachuteFallUpper.baf` exist, 12 frames
  each, named by nothing.

- **Six more orphans in the same folder**, all present and all unreachable:
  `3PParachuteJump{Lower,Upper}` (12 frames), `3PParachuteSplat{Lower,Upper}`
  (10), `3PParachuteGlideDie{Lower,Upper}` (2). Eighteen `3PParachute*.baf`
  files ship; **eight** of them are named by a state.

- **The three stance clips were never stills.** `Lb_Stand` /
  `Ub_StandAim<W>` is `3PStandLower.baf` / `3PStandAimUpper<W>.baf`, **18
  frames at 0.8** — a 1.25 s breathing loop. `Lb_Crouch` is
  `3PCrouchBreathLower.baf`, 18 at 0.8. `Lb_Lie` is `3PLieBreathLower.baf`, 17
  at 1.0. The pose files bake frame 0 of each as a *constant* clip, so a
  third-person soldier standing still was a statue. The clip names say
  `Breath`; nothing read them.

- **`PARACHUTE_VIEW_RADIUS = 3.0`'s own note was wrong**, and only a frame could
  show it. It says 3.0 "is the distance that frames a man and an open canopy".
  Measured off the drawn canopy's bounding box, a parachutist is **13.303 m**
  tall, and at 3.0 the soldier hangs in the middle of the picture with his
  canopy entirely above the top edge (frame `05-canopy-glide.png`, first run).
  See §5.

## 3. What the pipeline now emits

Two new shared sidecars and three new clips in each of the twenty-four existing
ones. All of it is weapon- and soldier-independent except the `.upper` halves,
which vary only by grip.

| file | clips | bytes |
|---|---|---|
| `poses/gaits/parachute.gait.glb` | the 11 above, named by engine state | 360,012 |
| `poses/gaits/parachute.canopy.glb` | `open`, `idle`; 204 tris, 2 materials, 2 textures, 5 skinned joints, 0 missing textures | 185,028 |
| `poses/gaits/lower.gait.glb` | was 4 (`run/walk/crouchwalk/crawl`.lower), now **7** (`+ stand/crouch/lie`.lower) | 69,088 → 108,540 |
| `poses/gaits/<Grip>.gait.glb` × 23 | the same 7 as `.upper` | 227,408 → 384,116 (Thompson) |

`gaits/gaits.json` gains `parachute`, `canopy` and `canopyAttach`
(`[0.0, 0.3, 0.0]`, read off a soldier's own `addTemplate Parachute` /
`setPosition`, not typed in).

**Directory total: 5,302,423 → 9,505,203 bytes, +4,202,780 (+4.01 MiB).**

Three pipeline facts worth keeping:

- **A one-shot is no longer baked with a loop's keyframe layout.**
  `timeline_tracks` now reads the state's own `c_AsmPlayOnce`
  (`animstates.ClipRef.loops`) and drops the wrap key: N frames span N−1
  intervals rather than N. Without it the canopy's last opening frame sits one
  1/21 step from its stowed first frame and the chute snaps shut at the end of
  every pass. Four parachute body states and the canopy's `open` are one-shots.
- **The canopy is the geometry `assemble.is_foreign_skeleton_part` drops.** Its
  docstring asked for exactly this: "A parachute feature wants this geometry
  back, on its own skeleton and hidden until the soldier is falling." It is an
  `AnimatedBundle` on `animations/Parachute.ske`, six bones, and unlike the
  soldier it is **already Y-up** (`Bone06` rests at (−0.029, 13.676, 0.0), the
  mesh spans y 0 → 13.486), so the bundle carries no pitch node.
- **`gaits.json` is merged, not overwritten.** A `--parachute` run knows nothing
  about the 23 grips; `write_gaits_manifest` merges its two keys in. This is the
  `models.json` lesson — a subset `extract_models.py` run once rewrote the browse
  manifest to only the entries it touched and dropped every thumbnail — applied
  before it could happen again. Tested
  (`test_parachute_assets.GaitsManifestMergeTests`).

## 4. What the viewer now draws

`viewer/soldier-body.js` is the selection: free of `three` and of the DOM, run
under node by `tests/test_soldier_body.py` through
`tests/soldier_body_harness.mjs`, which asserts against
`viewer/parachute.js`'s own `PARA_CLIPS` so there is one table and not two.

Thirteen families, every one a lower/upper pair because the engine runs two
state machines over disjoint bone sets (11 lower, 44 upper) and two three.js
actions at full weight over disjoint channels compose rather than fight:

```
stand walk run crouch crouchwalk prone crawl
parachuteFall parachuteOpen parachuteGlide
parachuteLanded parachuteDie parachuteDeadLanded
```

Two selection rules, both the engine's:

- **The parachute outranks the gait.** `setIsParachuting` sets both halves
  (PARA-5), so a parachute state replaces the locomotion pair rather than
  layering over it. A man under a canopy is not also running.
- **A stationary crouched man is read off `soldier.stance`.** `#gaitFor`
  answers `'stand'` for *anyone* not moving — it exists to pick a row of the
  view-bob table, only consulted while moving — and `'crouch'` / `'prone'` for
  the *moving* gaits of those stances, so neither value alone is the posture.
  This is the same trap `stance-clips.js` documents for the arms rig and the one
  that made a prone remote stand up before W5-A.

`map.html`'s share is one contiguous block plus five small hooks
(`loadHandWeapon`, `ensureHandWeapon`, the render loop, the tick-boundary
capture, the debug hooks). The body is the player's own
`<Soldier>__<Weapon>.pose.glb` with the weapon welded into its hand, so raising
the knife changes the body and not just the arms.

Three placement facts, read rather than chosen:

- `soldier.y` is the **feet** (`Soldier.spawn`: "place the soldier's feet") and
  so is the pose rig's root.
- the position is interpolated between the last two tick boundaries by the same
  `presentAlpha` the drawn eye uses (new `footFeetPrev`/`footFeetCur` beside
  `footEyePrev`/`footEyeCur`). Drawing the rig at raw tick state under an
  interpolated camera is a man juddering inside his own chase view.
- the yaw is the **drawn view yaw and nothing else**. `netcode-render.js`
  multiplies a remote's quaternion by a baked half turn (`SOLDIER_YAW_FLIP`)
  and this path must not: with the flip in, the first frame taken of the chase
  view showed the man's **face** — the camera sits behind him and he had been
  turned to meet it. Caught on a frame, not in review.

The canopy hangs at the soldier template's own `0/0.3/0` and is drawn for
exactly the states in which the chute carries him (`parachuteOpen` →
clip `open`, glide/landed/die/deadLanded → `idle`); in free fall the pack is
still on his back and nothing is drawn.

## 5. Measured

Served from this worktree on `localhost:5361` with the regenerated sidecars
overlaid on the shared poses tree by symlink; driven headlessly through
`__renderOnce`, `__footBody()` and `canvas.toDataURL()` (never a page
screenshot). Drivers in the stream's scratch directory (`shots.mjs`,
`chute.mjs`). Pixel evidence is a **differential**: the same box read twice, once
with the body drawn and once with `__footBodyHide(true)`, with the sim frozen at
`dt = 0` between the two reads for the parachute frames so the only thing that
changed is the body.

### The body is drawn

```
01-stand-chase.png   a Japanese soldier with a Type 99, from behind, standing
standBody  box [0.44,0.44]-[0.58,0.94]  34,875 px
           23,818 of them change when the body is hidden (68.3%)
           maxDelta 658, meanDelta 167.6
```

### It is animated, not a mesh slid along the ground

```
breathing  the same box, two frames 0.4 s apart, standing still, nothing else
           moving: 657 of 34,875 px move (1.88%)
```

A constant clip moves zero. That 1.88% is `Lb_Stand` + `Ub_StandAim<W>` —
18 frames at 0.8, the 1.25 s breath the pose files had been sampling one frame
of.

### The stance and gait selection is the engine's

```
family run          {want: run,        gait: run,   stance: stand}
family walk         {want: walk,       gait: walk,  stance: stand}
family standStill   {want: stand,      gait: stand, stance: stand}
family crouchStill  {want: crouch,     gait: stand, stance: crouch}   <- the trap
family crouchwalk   {want: crouchwalk, gait: crouch, stance: crouch}
```

with frames `02-run.png` (mid-stride), `02-standStill.png`,
`02-crouchStill.png` (knees bent, lowered), `02-crouchwalk.png`.

### Under the canopy

```
bodyFalling  want parachuteFall,  canopy hidden,  y 1382 m
bodyOpening  want parachuteOpen,  canopy clip "open",  visible
bodyGliding  want parachuteGlide, canopy clip "idle",  visible
```

and on frames: `03-freefall-chase.png` (a tumbling man, arms up, in
`3pExplosionFly*`), `04-canopy-opening.png` (a canopy part-inflated over him),
`05-canopy-glide.png` (canopy and man both in shot),
`06-canopy-front.png` (the front-chase view: the soldier in his harness with his
rifle, risers above him).

```
glideBody  the whole 900x560 frame, sim frozen: 87,299 of 504,000 px are the
           body and its canopy (17.3%), maxDelta 582
```

### The framing had to change, and this is the one thing I re-litigated

`PARACHUTE_VIEW_RADIUS = 3.0` frames a man. The first frame ever taken of an
actual canopy showed it does not frame a parachutist: the soldier hung in the
middle with his chute entirely above the top edge. `canopySpan()` now measures
the drawn subject off the canopy's own bounding box — **13.32 m** on Wake, the
data's number and not a typed one, so a mod with a different chute gets its own — and
the external view fits that at `FOOT_FOV` while anchoring the look-at on the
subject's centre rather than on the man's eye. `CANOPY_VIEW_MARGIN = 1.35` is
headroom over the exact fit, and it is a **viewer number chosen on a frame**,
marked as such beside `PARACHUTE_VIEW_RADIUS`, which is what it is: the engine
lifts the eye 0.3 R above the anchor and looks back down, so an exact fit still
clips the top.

After the change, on `07-canopy-glide-wide.png` and `05-canopy-glide.png`
(third run): the canopy, the risers and the man are all inside the frame with
headroom, the eye 18.96 m out and 7.55 m up, and the full-frame differential
counts **87,299 of 504,000 pixels (17.3%)** as body-and-canopy.

Nothing else in `chase-camera.js` or `soldier-camera.js`'s law was touched.

One more thing a frame showed and an argument would not: at the **instant** the
chute opens the camera is still carrying 0.6 s of free-fall velocity, so
`04-canopy-opening.png` frames the new canopy from sixty metres. It has caught
up by the glide. That is `CHASE_SPEED_LAG` doing exactly what it is for.

## 6. The flag

**`?soldier3p=1` is off.** The external views are the default; `?no-soldier3p=1`
puts them back behind a flag, which is the one-line revert asked for. Checked on
the page rather than asserted — with `?no-soldier3p=1&foot3p=1` set together:

```
revertView {"mode":"inside","modeId":3,"modes":["inside"],"firstPerson":true}
revertBody {"want":"stand","visible":false}
```

The first version of that revert missed `?foot3p=1`, so the two together still
gave external views. Fixed and re-checked (`5904a7b`).

**Honest judgement: yes, this is good enough to be the default.** The chase and
front-chase views under a canopy show a soldier in a harness under an inflated
chute, textured, lit like the rest of the level and animated from the game's own
clips; there is no grey void anywhere in the sequence. Two caveats, neither of
which argues for putting the flag back:

- In **free fall** the chase view frames a very distant man — 259 of 156,524
  pixels in the centre box. That is `chase-camera.js`'s own velocity lag (0.6 s
  of trailing velocity, and PARA-9's free fall runs to 100 m/s+), so the camera
  sits sixty metres behind him. It is the engine's law doing what the engine's
  law does with a speed the engine arguably should not allow; PARA-9 is the row
  to close, not this one.
- The soldier is **bare-headed**. `dressSeatOccupant` hangs the deploy kit's
  helmet on a *seated* occupant's bones and nothing does it for the man on foot;
  its own comment says the call is "the same call in three more places once
  someone wants it". See §8.

And one thing that was built and **taken back out on the frame it produced**:
the death cam. It is an external view of the local soldier — parked a couple of
metres behind and above the corpse, pitched down onto it — so the body belongs
there, and wiring it in took one clause. `08-death-cam.png` says otherwise:
there is no death family in `soldier-body.js`, so the dead man plays `stand`,
and the near pass still paints the first-person arms rig over the top because it
gates on `footView3p.firstPerson`, which stays true while dead. A standing man
under a death cam is the same kind of wrong that gated `?soldier3p=1` in the
first place, so the clause is out and the reason is written where the next
person will look. It wants the `Lb_Die*` families, which this stream did not
survey.

## 7. Remote players

They already had a body and still do. `netcode-render.js` loads the same pose
pairs and the same gait bundles, and W5-A fixed the family selection there
(`0b9337a`); `remote-gait.js` — the module that names the clips — is untouched
by this stream, and so is `netcode-render.js` itself, which belongs to W6-G this
round. The new `stand/crouch/lie` timelines are **added** to the shared bundles
and the pose files keep their constant `stand`/`crouch`/`lie` clips, which are
the names `FAMILY_CLIPS` asks for, so nothing a remote plays changed.

Two browsers **were** put in a real room (a room server on a free port, the
static proxy from `tests/p2_two_browser_smoke.mjs`, `map.html?room=w6b`), A
deployed and walked, B deployed and read its renderer:

```
remotes on B [{ slot: 1, team: 2, visible: true, want: "stand", speed: 0,
                bound: ["stand","crouch","prone","walk","run","crouchwalk","crawl"],
                standIn: false }]
```

`standIn: false` is the load-bearing field: B built a real pose-pair rig for A
and did **not** fall back to the plain unanimated body model. All seven
locomotion families bound.

**But I never got the two of them into one frame**, so the pixels are unproven.
They spawned 108 m apart at the same flag; `__teleport` does not survive in a
room (the server owns the position and puts B straight back, byte-identical),
and the walk-B-to-A loop I wrote overshot and did not converge —
`__lookDelta`'s sign and scale were a guess and the aim ran while W was still
held. The bug is in my driver, not in the renderer. `room.mjs` is in the
stream's scratch directory for whoever picks this up. Until then: treat the
remote's pixels as **open**, and note that this stream changed nothing on that
path.

## 8. Still open

| Item | Where it stands |
|---|---|
| **A frame of a remote's body** | §7. The state readout is there and the picture is not. `room.mjs` is written and its walk loop needs fixing |
| **The man on foot is bare-headed** | The kit's helmet is grafted onto a seated occupant only (`dressSeatOccupant`). The same call, on `footBody.scene`, dresses the man on foot and the spawn-pad figures |
| ~~**The death cam draws nobody**~~ | Closed 2026-09-24: the corpse plays the engine's death, see [`soldier-death-animations`](../soldier-death-animations/README.md) |
| **Free fall frames a distant man** | §6. The chase law's velocity lag against PARA-9's runaway free-fall speed |
| **The landing clips are never seen** | `Lb_ParachuteHitGround` and the two `Dead*` families are baked, bound and selected by `soldier-body.js`, and `parachute.js` emits the states — but no headless run in this stream reached a touchdown under a canopy with an external view up, so **`parachuteLanded`, `parachuteDie` and `parachuteDeadLanded` have not been seen on a frame**. They are in the report's `bound` list and nowhere in its pictures |
| **Eight of the eighteen parachute clips are named by a state** | §2. `3PParachuteFall*`, `3PParachuteJump*`, `3PParachuteSplat*`, `3PParachuteGlideDie*` and `3PParachuteGlideUpper` are shipped and unreachable. A jump and a splat are obviously *something*; what the engine ever did with them was not chased |
| **The directional clips** | `{Crouch,Lie,}{Backward,StrafeLeft,StrafeRight,Turn*}` all exist per weapon, and the body plays the forward clip for every direction in every stance — the same gap `extract_viewmodel.py` names for the arms rig |
| **`?foot3p=1` is a departure** | C outside a standing soldier, off by default. CAM-1 is that the engine authorises one view mode for a soldier and `BFSoldier::nextCamera` is an empty function. It exists because outside a canopy or a death cam there is nowhere to look at the body from, and it is labelled in `soldier-camera.js` as a choice, not a reading. **Withdrawn 2026-09-26**: the flag, the `soldierExternalViews` switch and `FOOT_VIEW_CYCLE` are deleted, because F11 beside the walk keys was taking the owner out of first person mid-stride. See [`viewer-foot-first-person`](../viewer-foot-first-person/README.md) |

## 9. What the real shared tree needs

The pose `.glb` files do **not** change; only the shared sidecars do. So the
re-extraction is the narrow one, and it never touches `models.json`:

```bash
cd tools/bf1942-models
python3 extract_pose.py --shared-assets --out ./viewer/models/poses
```

About 1.4 s. It rewrites `poses/gaits/lower.gait.glb`, the 23
`poses/gaits/<Grip>.gait.glb`, `poses/gaits/parachute.gait.glb`,
`poses/gaits/parachute.canopy.glb`, and merges four keys into
`poses/gaits/gaits.json`. **Expected size delta: `poses/gaits/` goes
5,302,423 → 9,505,203 bytes, +4.01 MiB.** Nothing outside `poses/gaits/` is
written.

`python3 extract_pose.py --parachute --out ./viewer/models/poses` is the even
narrower one: the two new files only, merged into the manifest, leaving the
grip bundles as they are. Use it if the stance timelines are not wanted.

A mod tree wants `--mod <name>` on the same command.
