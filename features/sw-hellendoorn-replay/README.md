# Secret Weapons Hellendoorn replay defects

## Kits at the hotel

Report: three jet pack kits on the hotel's third floor at the Hellendoorn flag, two expected.

Verdict: in the data and drawn twice (viewer bug). Not an exporter or recorder fault.

- The level has two `JetPackSpawner` objectSpawns on the flag (osId 3), and the recording
  has exactly two `createObject` rows for `GermanElite_JetPack` at those points (netIds 614
  and 628, t 120.85). The human took 614 at t 126.67, so from then on one kit lies there;
  the pad's respawn (676) stands at 276.5. The data agrees with the scene: two at most.
- The page's own kit pads (`deployables-page.js` `tickPads`, which stand the level's
  `objectSpawns` kits through `kitDrops.placeKit`) kept running under the replay. At t 130 the
  probe found two pad kits plus the recorded 628: three.
- Fix: while a replay is active the pads lay nothing (`page.replayActive`, passed from
  `map.html`); the level's baked copies are still removed and the recording's createObject
  rows are the only source. Probe after the fix: t 123 two kits, t 130 one (614 taken), t 280
  two (628, respawn 676).
- Any level with a control-point-owned kit pad (vanilla and mods) had the same doubling in a
  replay; the fix is general. Live play (no recording) is unchanged: one kit per spawner.
- Files: `tools/bf1942-models/viewer/deployables-page.js`, `viewer/map.html`; test
  `tests/test_deployables.py` (`test_a_recording_lays_no_pad_kits_beside_its_own`, via
  `tests/kit_pads_harness.mjs`). `python3 -m unittest tests.test_deployables`: 13 OK.
- Nothing re-baked or published (scene.json and glb were correct).

## Sounds

Recording `5txd9vj8ap` (xpack2 Hellendoorn, pid 0). Five reports; the footsteps, the depot heal,
the knife throw and the SMG burst were viewer faults and are fixed, the reload report was not
one. Probes are headless Chromium over `?shots` with the recording routed in (the page's own
`window.replay`, `ownHandSound`, `__worldFire`, `__soldierSounds`, a patched
`AudioBufferSourceNode.start`).

### 1. Reloads of the Bren, FG42, Gewehr 43, Sten and Shotgun: drawn fine (mis-report)

Not missing sounds, and not xpack2 inheriting vanilla's. `models/mods/xpack2/sounds/weapons.json`
carries all 25 hand weapons with a Reload slot (BrenLMG 13 loads, Gewehr42 12, Gewehr43_zf4 8,
Stengun 13, Shotgun 11), every one of the 598 files it names answers 200 on mesh.bfstats.io, and
vanilla's 454 do too (`livecheck`: HEAD of every `file` in both manifests). Every xpack2 kit weapon
has an entry; Binoculars is the one quiet item.

In the replay the reload is called for each of them (`reloading` from the torso's `Ub_StandReload*`
state, the weapon from the kit's item), and in
the followed soldier's first person it plays on the hand bus: 13/12/8/11 loads start (Bren 557.4,
FG42 351.1, G43 421.4, Shotgun 607.5, Sten 730.0 s). From the chase
or orbit camera it is a bystander's reload through the script's own `Volume <- Distance` ramp (1 m,
all 239 vanilla loads, SND-17), so it is inaudible there for every weapon, K98 and Walther too;
that is the owner's rule of 2026-11-28 (`features/hand-weapon-sound-edges`, "The followed
soldier's reload is his own, in his eyes"). Nothing changed in the viewer for this item. Re-checked after the coordinator's challenge
(2026-11-28), looking at the audio itself rather than at starts:

- Codec and decode: every reload pick of the five and of the working K98, WalterP38 and Mp40 is
  44.1 kHz mp3 with a non-zero duration (ffprobe of the live files; the five differ only in having
  stereo loads where K98/P38 have mono, which the own-sound path plays the same way). The fire
  samples that `fetchHandFireSound` decodes first (BrenLMG.mp3 0.110 s, Gewehr42 0.112,
  Gewehr43_zf4 0.925, Stengun 0.111, Shotgun 1.016) decode too.
- Trigger: every reload episode of the recording (Ub_StandReload at 178.7, 207.6, 212.5, 296.2,
  302.6, 351.1, 421.4, 445.3, 557.4, 581.3, 607.4, 622.9, 730.0) calls the followed soldier's
  reload with the right weapon in first person; the generic `Ub_StandReload` is followed 30 ms later
  by `Ub_StandReload<Weapon>` for all of them, so the state name is not a difference.
- Output: an AnalyserNode on the master tap in first person, through real playback, local and
  against play.bfstats.io itself. Peak at the output after the reload starts, against 0.03 to 0.13
  before it: Bren 0.75 (local) and 0.74 (live), Sten 0.80 and 0.79, Gewehr43 0.75, Shotgun 0.54,
  FG42 0.77, K98RifleGrenade 0.84, Mp40/K98 0.59 to 0.61 in the direct call. The five are as loud as
  the ones that work.
- From the chase or orbit camera the world path plays every weapon's reload through the 1 m
  ramp, and none starts a load (K98 included).

So the five do not differ from the others in anything the page can control; the report is a
view-mode report. The reload is heard in the followed soldier's first person and in no other view.

The 513 "named samples not on disk" in `test_weapon_sounds_on_disk` (xpack2) were a hole in the
local tree, not in the extraction: the local `models/mods/xpack2/sounds` held 101 files from a
partial earlier run, its `weapons.json` was right. `extract_weapon_sounds.py --mod xpack2` gives a
manifest identical to the live one (38 weapons, 616 named files, all produced), and the files the
local tree already had are byte-identical to the live ones. The missing files were written into
the local tree (613 now) and the test passes; nothing needed publishing.

### 2. Medic locker and med box: fixed

Recorded: `e heal` rows with `kind depot`, `to` the patient (60.767-62.252, 221.057-224.06,
623.256-627.257), and `kind repair` (an engineer's wrench on a hull). The page parsed them (visit
rows, the support table) but played nothing for a patient.

In the game any negative damage to a soldier whose hit points are under the maximum raises
`c_SstHealedByMedic` (`SoldierHealedByMedic.ssc`, `medkit.wav` at 0.6, full inside 2 m, gone at
6 m) in `BFSoldier::handleDamage`, whoever healed (SND-51; a depot's `healSoldier` goes through the
same call, SUP-22). The recording writes a visit's first and last heal and nothing between, so
`replay-bodies.js healSounds` places the sound on the depot's own 0.5 s cycle (SUP-4) from the first
heal to the last: 3 sounds across 60.767-62.252. `kind medpack` visits sound the same way. It plays
at the patient's chest (`page-audio.js playSoldierHeal`), and on the listener's own body when the
patient is the followed soldier in his first person. A `repair` visit heals a hull and has no soldier
sound; the wrench's own loop (`RepairPack.ssc`, the engineer's first person) and the medic bag's
(`MedPack.ssc`) already played and still do (`ownPackLoop`). Checked: `playSoldierHeal` 60.8, 61.28,
61.78 in the eyes; 221.13 to 223.06 from the orbit camera; the 1.48 s `medkit.mp3` starts at 0 m and
3 m, none at 20 m.

### 3. Knife throw: fixed

The throw is two sounds. The weapon's swish (`knife.ssc`, `knf1-3.wav` at 0.1 s) played all along as
`EliteKnife` / `CommandoKnife` from the `f` row. The loud one is the thrown knife's own flight:
`EliteKnifeThrowProjectile` loads `knifeprojectile.ssc`, `knife_air.wav` looping at 0.5, rising 0.1 s
after the throw and falling off over 20 m. It was already in the tree (`_shared/effects.sounds.json`
carries `eliteknifethrowprojectile` / `commandoknifethrowprojectile` as `#flight` scripts) and the
page's own rounds play it, but a replay's `pn`/`pj`/`pd` flight asked for nothing.
`replay-flights.js updateSounds` now plays a flight's round script with `follow` along the recorded
path while it flies, stops it at `pd` and across a pause, drag or seek, through
`ctx.flightSound` (`map.html`). Only scripts that sound for the whole flight take part
(`EffectAudio.hasFlightLoop`); a bullet's passing crack is not played from a server flight, as
before. The stab (`*Stab`, `knife2.ssc`) was untouched. Checked: `EliteKnifeThrowProjectile` starts
at 43.10 (the `f` is 43.124) and stops at 45.26 (`pd` 45.191).

### 4. Choppy automatic fire: ours, fixed

Not the 30 Hz limit: the Sten's rounds are 0.133 s apart (four ticks), exactly. The replay played
one cycle of the Fire Loop a round, each struck on the frame the round was handled on. The Sten's
loop (`silenced-version-1.wav`) is 0.111 s, so every round left 22 ms of silence and every cycle
began on a 16 ms frame edge. In the game the loop is one sample played back to back for as long as
the trigger is held (`stop finishsample`), at its own rate whatever the weapon's rate of fire.

`linkNextRounds` (`replay-bodies.js`) stamps each recorded round with the seconds to the same
soldier's next round of the same weapon, and `WorldFire.play` takes it (`{ next }`): the first round
of a burst starts the loop, and while the next round is within 0.5 s the loop is carried, each next
cycle handed to the audio clock (`EngineAudio.trigger(lead, { carry })`, a start in the future that
keeps the patch's clock) to begin exactly as the last ends, and the rounds only hold it. The last
round's cycle plays out and no more. The shortest layer at its highest start pitch sets the cycle,
so a pitch jitter cannot open a gap. Rounds with no hint (the page's bots, the live page) behave as
before. Guard: `tests/test_replay_auto_fire_sound.mjs` (a Sten burst: struck once a round it leaves a
gap over 15 ms; carried every cycle begins as the last ends, at 60 and 30 fps, and no cycle starts
after the last round). The perceived rate is the loop's, 540 a minute for the Sten, as in the game.

### 5. Footsteps by material: fixed

Every step was the same because `page-audio.js floorPatchAt` looked at the page's own soldier's
collider, which a replay has none of, so the floor was always material 0, and a guessed table
(`footstepMaterial`: 0 was sand) turned it into patch 0. Three changes:

- The table is the game's: `Objects/Soldiers/Common/Sounds/MaterialToSound.con`
  (`SoldierSound.addMaterialToSound <id> <surface>`, SND-49; a name with a later line wins, 111 and
  112 are written twice). `extract_soldier_sounds.py` reads it into `soldier.json` as `materials`
  (`--materials-only` adds it to a tree extracted before; vanilla, Road to Rome and Secret Weapons
  carry the same 102 rows; FH and FHSW 149, GC 107). `soldier-sound.js materialPatchTable` turns it
  into id -> patch with the engine's own word search (Sand 0, Metal 1, Wood 2, Concrete 3, Grass 4,
  Gravel 5, Frozen 6, Mud 7, Water 10, else 11); vanilla's is embedded for a tree without it. A
  material the file never names (7, "Outside map", and the gaps) leaves the stored patch as it was
  (`SoldierSound::setMaterial`, Mac client 0x00060f2c): no entry.
- The floor is the level's collider (`page.collider`) when the page has no soldier of its own:
  the terrain's `terrain/materials.png` (the level's `Materialmap.raw`, already exported for every
  exported level: Hellendoorn's is 256 x 256, 9 frozen ground, 12 rock, 1 water, 8 gravel, 7 outside),
  a static mesh's face material under the foot (building floors, roofs), and a replayed hull's
  collision face (`collider.dynamicCast`: a deck, a jeep, a tank) when it is the highest thing there.
- It is stored on the soldier's machine as `setMaterial` does, read when he is in contact and no more
  than every half metre or third of a second.

Checked headless on Hellendoorn: the followed man's walk and run steps now sound patches 3
(concrete), 5 (gravel), 6 (frozen) and 10 (water) where they were all 0; a grid of 100 x 100 m round
the launch site reads statics 85/90/93 (metal, concrete) and terrain 1/8/9/12. The play page's local
soldier shares `floorPatchAt` (its collider is still the first choice), so it gets the table too.
`tests/test_soldier_sound.py` pins the word search and the table; `tests/test_soldier_sounds.py` the
extractor's reading.

### 6. Another soldier's reload on a slow page: fixed

Found while checking item 1. `world-fire.js` held each reload slot on the wall clock, while
the page clamps a frame to 0.1 s of patch time. Below about 10 fps the slot was released, and
its later loads (gates up to 3.6 s) disarmed, before the patch reached them, so a heavy replay
played little or none of a nearby soldier's reload. A slot now counts the patch's own elapsed
time since its trigger and is not released until the patch has run its full hold.
`tests/test_reload_sound.mjs` covers it (0.4 s frames, patch clamped to 0.1 s, a soldier at
0.5 m: all three loads play, and the next reload too). The followed soldier's own reload stays
first person only (ac830f4fb).

### Published

`soldier.json` with `materials` for vanilla and nine mod trees (xpack2, eod, fh, fhsw, fhsweurope,
desertcombat, bf1918, gcmod, dc_final), a backward-compatible key. See the coordinator's note for
what landed.

## Projectiles and impacts

Recording 5txd9vj8ap (Hellendoorn, xpack2). Probed headless on the live page code through
`serve_viewer.py` on :5311 (seek, then frames at a slow replay speed; the recording has no kills,
so the chases were started by click, by Shift+5 and by key 6).

### 1. Bullet tracking (Natter rockets, thrown knives, every other projectile)

Verdict: in the data, drawn, but not trackable (viewer bug), in two places.

- Clicking a round in flight only found rounds in the page's own guns (`guns.tracers` /
  `guns.projectiles`, `replay-pick.js` `pickCandidates`). A Natter rocket, a flak shell, a thrown
  knife, a rifle grenade and a grenade are the recording's own objects (`replay-flights.js`,
  `replay-props.js`), so the pointer found nothing and no bullet cam started. They are now
  candidates (`life`, `flight`, with the shot that fired them: `flight.shot`, else `shotOfThrown`),
  and `RoundCam.chaseLife` / the creator's `chaseLife` ride the recorded path to where it struck,
  as a kill shot's is.
- Key 6 (`chaseHeavy`) skips weapons that are not "heavy" by name (`guessSpeed`). `NatterGuns`
  fires `NatterProjectile`: 200 m/s, 16 m blast (`models/mods/xpack2/damage.json`), a rocket by
  every number and a bullet by its name (650 m/s guess, "No more rockets..."). The weapon table
  now teaches the guess (`replay-weapon-speed.js`, fed by `replay-hud.js` `weaponTable`): a gun
  with a blast radius and a speed is kept, so `NatterGuns` is 200 m/s, heavy, kind rocket; a
  shotgun (200 m/s, no blast) and rifles stay bullets. Bullet time and the chase's standoff use the
  real speed.
- Thrown knives: 7fbe5de97 already covered arm/key 6/stand-in; on this recording all 19 throws find
  their knife and key 6 walks through them. What still failed was the click (above); now
  `EliteKnife` and `CommandoKnife` throws chase to `impact` (e.g. 43.43 s flying, 45.33 impact).
- Audit, each template armed by Shift+5 on a real shot, state sequence armed > flying > impact >
  idle: Natter (rocket), EliteKnife / K98RifleGrenade (thrown), FlakPanzerGunBarrel (shell),
  Gewehr42 / K98 / Gewehr43_zf4 / BrenLMG / Stengun / Shotgun (tracer), MG42 / Browning /
  FlakPanzer_MG42 / GoblinGuns (hull MGs, tracer). By click: Natter, both knives, K98RifleGrenade
  and FlakPanzerProjectile chase to the hit. A rifle bullet is `invisible 1` and has no body to click
  (retail draws none); it is ridden by the kill shot or Shift+5. WalterP38 at 57.465 never claimed
  in the 1 fps headless run only because its 21 m round lives under one headless frame; it is
  not a data or viewer fault (the same pistol at 177.563 s chases fine).

### 2. Shotgun: one impact per shot, should be five

Verdict: in the data (five `f`, five `pn`/`pj`, five `i` per pull), drawn wrong (viewer bug).

- Retail: `Objects/HandWeapons/Shotgun/Objects.con` has five `addFireArmsPosition` barrels
  (turns 0/-1, -0.5/1, 0.5/1, -1/-0.5, 1/-0.5) and `setBlastAmmoCount 1`: one pull is five
  pellets. The recorder writes one `f` per barrel, all at the pull's tick with the same `p`/`d`
  (aim before the barrel's turn, XHIT-16); the five `i` rows then differ by about 1 degree.
- The replay fired the weapon once per row (`guns.fireShot` fires every barrel of a non-async
  gun) down one constant ray (`aimRay: () => ray`): 25 tracers on one line, one impact spot. Now
  `numberBarrels` numbers the rows of a pull, `leadsPull` fires the pull on its first row only
  (soldiers, first person and hulls; an async gun, a one-barrel gun and a second pull in the same
  tick are unaffected), and `barrelAimRay` turns the recorded aim by each barrel as the engine
  does (`replay-gunfire.js`).
- Measured at 599.2 s: 5 tracers (was 25), five directions within 1 degree, five impact records
  at (338.32,64.86), (338.20,64.47), (338.44,64.47), (338.13,64.71), (338.51,64.71) against the
  recording's own `i` points (338.27,64.84), (338.22,64.43), (338.42,64.45), (338.09,64.68),
  (338.48,64.70). Vanilla has no shotgun; any multi-barrel hand weapon (DC, FH, FHSW) gets the
  same fix.

### 3. Vehicle impact effects (Gewehr42 on the Schwimmwagen)

Verdict: in the data (the `i` rows name the object struck), drawn wrong (viewer bug), for every
vehicle.

- `replay-gunfire.js` `dynamicCast` raycast the drawn model and answered material 61 for every
  hull, so every round into any vehicle played 61's effect (`e_RichoCascadesPlane`, the big
  metal plates). The engine collides a round with the hull's collision mesh, whose faces carry
  the vehicle's material and where a material 90 face is not solid (COL-23).
- Now the cast uses the glb's collision primitives first (`collisionPartsOf`: the invisible
  `*_collision_*` meshes with `defenseMaterial`, FHSW bullet catchers and the 1-2 triangle
  suspension probes left out), skips material 90, and falls back to the hull's dominant material
  only for a drawn part with no collision face under it (a barrel, an aerial). 61 stays only for
  a glb with no collision at all. `replay-flights.js` `struck` uses the struck hull's dominant
  material when the page's colliders miss it.
- Measured on the 13 Gewehr42 rounds into the Schwimmwagen (nid 704): material 45 at 30.6-31.2 m
  (recorded `i` distance 31.4 m), effect `e_RichoMetal` (was `e_RichoCascadesPlane`). Dominant
  materials now per hull: Schwimmwagen, R75, Willy, HD_XA42 45; FlakPanzer 50; PanzerIV, LVT4 51;
  Sherman 50; Goblin and Natter 60; stationary MGs 87.

### Files and tests

`replay-pick.js`, `replay-creator.js`, `replay-roundcam.js`, `replay-hud.js`,
`replay-weapon-speed.js` (new), `replay-recording.js`, `replay-gunfire.js`, `replay-bodies.js`,
`replay-viewmodel.js`, `replay-hulls.js`, `replay-flights.js`. Tests: `tests/replay_creator_harness.mjs`
and `tests/test_replay_creator.py` `CarriedRoundTests` (speed by table, a pull's barrels, per-barrel
aim, hull collision materials and `dynamicCast`, picking and riding a recorded round). Whole
replay set: 769 tests OK (15 skipped). Nothing re-extracted or published.

## Bodies, jet pack, parachute, medic bag

Recording `5txd9vj8ap` (SW Hellendoorn, one human, pid 0), probed headless on a local server
(port 5333) against the live assets.

### 1. Knife stabs (viewer bug, first person; third person partly)

- The data: 6 `f` rows `CommandoKnifeStab` / `EliteKnifeStab` (114.26, 115.63, 571.32, 572.42,
  632.66, 779.79). The torso state is recorded for the lying stabs (`Ub_LieAltFireEliteKnife`
  then `Ub_LieAltFireCommandoKnife4`, 113.996 for 0.53 s) but for the standing ones it is not:
  at 571.3 and 572.4 the torso still reads `Ub_StandReloadCommandoKnife` (the stab began and
  ended between two 30 Hz samples, or the engine returned to its `then` state). The stab round
  leaves 0.27-0.3 s after the press.
- First person: `replay-viewmodel.js` `armsTrack` had no family for `Ub_AltFire<W>` /
  `Ub_LieAltFire<W>` (`ARMS_FAMILY`) and never read a `<W>Stab` round, so the arms never played
  the rig's `altfire1..5`. Now a recorded stab state (hub plus numbered swing, one stab per run of
  records, whatever grip names it: an EliteKnife's swings are `...CommandoKnife1..5`) and a stab
  round with no state (`STAB_DELAY` 0.3 s before it) are each a one-shot `altfire` clip over the
  aim; stab states are no weapon switch.
- Third person: probed played through at 113.8: the lying stab does play `Ub_LieAltFire` (114.0,
  114.5, 115.4). The standing stab with no recorded state drew the knife's primary swing
  (`Ub_Fire`, observed at 571.4 and 572.5) because `replay-bodies.js` `fire` called `botFired`
  for the `...Stab` round. Now a `...Stab` round with no stab state calls `botStabbed`.
- Tests: `tests/replay_viewmodel_harness.mjs` / `test_replay_viewmodel.py`
  (`test_a_knife_stab_plays_its_own_clip_standing_or_lying`).

### 2. Jet pack (the "static, inverted flame" was a full-size mesh worn on his back)

- Cause: `GermanElite_RocketPack.kit.glb` carries the pack's effect bundles as child nodes
  (`e_RocketPack`, `e_RocketPackDefault`: `EffectBundle` / `Particle` / `SpriteParticle` templates,
  each with the jet mesh `e_JetFire_m1` at its authored 1 m x 0.45 m size, at 0.115 / +-0.1 / 0.2
  turned half a turn). The dresser (`soldier-dress.js`) hung the whole glb on the `backpack` bone, so
  two flame meshes were drawn as plain geometry from the nozzles to his feet: the flat brown block
  (before: `fy_cmp.png`), static because it is a node, and "inverted" because the mesh's wide base ring
  is at the nozzle end while the template is turned. The effect player never draws those nodes; it
  clones particles from its own library.
- Fix: `soldier-dress.js` hides every `templateKind` EffectBundle / Particle / SpriteParticle node of a
  worn part (`EFFECT_TEMPLATES`). After: `fa_cmp.png` (same chase camera, follow pid 0, 131.58-132.18):
  legs and pack clear, smoke sprites trail and fade.
- The flame texture itself is fine (the real `e_jetfire_I`, orange with an alpha ramp) and the material
  is additive with `alphaTest 0.7`, as `MuzzHeavy_m1`'s. The data: `e_RocketPack`'s jet mesh has
  `alphaOverTime 0.1 -> 0`, so under that alpha test none of it passes (it draws nothing, in the
  engine's arithmetic too); `e_RocketPackDefault`'s jet (0.03 s, alpha 1, scaled 0.18 x 0.18 x 0.06) is the
  small bright core, and additive on snow barely shows. `rocket-flame.js` plays both bundles (the
  Default one is the flicker, the active one gives the smoke).
- Pose: retail (see below). Pack orientation: right way up (before images); the pose in
  `Lb_RocketeeringIdle` is the parachute glide per `AnimationStatesRocketeering.con`, no
  Rocketeering `.baf` exists in xpack2.
- Measured: jet mesh base ring 0.118 wide at the nozzle, tip ring 0.069 wide 0.31 m below.
- Tests: `tests/test_rocket_flame.py`, `test_soldier_outfit.py`
  (`test_a_part_s_effect_templates_are_not_drawn`).

#### Jet pack, second pass: upside down, and the flame that drew nothing

- **Upside down (reproduced).** The part's nozzle axis (+Z; `e_RocketPack`'s emitters sit at z 0.2) hung
  toward his head on every body except the first: packZ world y -0.97 at 131.5 and 134 s (the
  EliteKnife body) and +0.97 / +0.91 at 138-173 s (every Mp40 and other body), head 0.62-0.64 m above
  pelvis throughout. Cause: the `backpack` bone's frame differs by pose file. GermanEliteSoldier's EliteKnife
  recipe bakes a `backpack` joint that is the rig's rest rotation times (1, 0, 0, 0) (a half-turn about its
  own X); the other poses leave the bone at rest. The back slot's half-turn was pinned by eye on one of
  the two. `rocket-flame.js` `orientRocketPack` checks each figure once from its own bones (part +Z
  against pelvis->head) and, if it points up, turns the part half a turn about the bone's X
  (`bone * X180 * part`, the other frame's answer). Called from `replay-bodies.js` `updateFlames` (every
  wearer, burning or not) and `foot-body.js` (the page's own body). After: packZ y -0.97 / -0.91 / -0.88 at
  all thirteen probe times, scratchpad `flip3.out`. Test: `test_rocket_flame.py`
  (`test_the_pack_hangs_nozzles_toward_his_feet_in_any_pose_file`).
- **The flame.** How the engine combines the curve and the cutoff: the StandardMesh path takes its alpha
  from the TEXTURE alone (stage 0 `ALPHAOP SELECTARG1, TEXTURE`, `bf1942-3d-models/envmap-materials.md`),
  so `alphaTestRef 0.7` gates the texture and the particle's `setAlpha` byte cannot be what it reads. An
  effect whose alpha curve peaks below its own cutoff is therefore not alpha-driven. `effects.js` now
  leaves such a mesh at full opacity (`alphaIsTexture`) and draws only the texture's hard core (additive,
  as `MuzzHeavy_m1`). Curves that cross the cutoff (shock rings, water impacts, the decal) are unchanged.
  Survey of the vanilla and xpack2 effect libraries (xpack1 has none): affected were
  `Em_WaterDepthRing` (0.6 < 0.7, vanilla and xpack2) and, in xpack2, `Em_RocketPack_mesh` (0.1),
  `Em_JetBeam_mesh`, `Em_JetBeam_goblin`, `Em_JetBeamho229` (0.2): the Goblin and Me 163 type exhausts
  were invisible for the same reason and now draw.
- **Evidence** (same follow-pid-0 camera, 167.8-169.1 s on snow, burning from 168.0; scratchpad):
  `jetB_cmp.png` chase on snow (small bright core at each nozzle, smoke trailing), `skyB_cmp.png` from below
  against sky and hills (two bright cores at the nozzle ends), `sideC_cmp.png` from the side (pack right way
  up, core at the bottom, puffs drifting). Particle ages advance and the Default jet blinks (0.03 s) between
  frames. The core is small and reads white-yellow on snow (additive on a bright ground); the jet mesh's
  hard core is what the engine's alpha test keeps, so I did not enlarge it: its size comes from
  `size 1.8 x sizeModifier 0.15 / 0.15 / 0.18` (0.12 x 0.32 m) and `e_RocketPackDefault`'s 0.08 x 0.06 m,
  both the data's own.

### 3. Parachute strings in first person (proved on screen, vanilla)

Cause: `replay.js` `hideOwnBody` hid his body and seat but not the canopy, so the shroud lines
drew round the camera. The Hellendoorn file has no open chute (bit 0x10 never set; its
`Lb_ParachuteFall`/`HitGround` are the jet pack's alias), so proved on `wj6jp56xzw` (bf1942
strasbourg, pid 0 opens at 492.27, touches down 494.30): first person at 494.11, old
`hideOwnBody`, a brown shroud line crosses the view (`canopyVisible: true`); with the fix
`canopyVisible: false` on every frame from 493.64 through touchdown and the view is clear
(`chute_cmp.png`: top-left old, bottom row new). General: vanilla and every mod share the code.

### 4. Medic bag (not in this recording; the same draw measured on the engineer's pack)

- The data: after `spawnPick` kit 3 at 709.142 the human is a Commando medic (nid 826) but
  holds only items 3 (Stengun) and 1 (CommandoKnife); item 5 (`MedPack`) never appears, and no
  `MedPack` state or round is in any `st`/`f` row. The `Ub_*MedPack` names are in the animation
  table only (it lists every weapon's states). `Landmine` is item 5 at 618.7 and `RepairPack` (item
  6) is drawn at 65.86 and 468.76 on the engineer lives, so the pack draw is measured on that.
- Measurement (first person, follow pid 0, raise recorded at 65.855): with rig-on-demand (old
  behaviour, `warmKit` disabled) the `RepairPack` rig is `loading` when the raise starts and the arms
  first show it at replay time 67.6: 1.75 s of the recording late. With `warmKit` the rig is `ready` at
  65.9 and the arms show it on that frame. The fetch is the whole delay, and `MedPack`'s rig takes the
  same path, so the medic bag's draw is closed by the same change; there is no medic-bag draw in
  this file to run it on.
- The third person already warmed every kit item (`warmKits`).
