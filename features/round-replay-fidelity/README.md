# Round replay fidelity: the replay plays through the map's own machinery

The report (2026-09-27, after the first lab recording, `replay_20260927-001120`):
most replayed vehicles had no sound and no animation (a plane flew with its
parked model, propeller still; only some landing craft made a noise), and the
recording player, who spawned as assault, was drawn with a bazooka. The ask:
the replay should reuse every piece of the playable map (models, sounds,
physics, animation), and the recorder should capture what an honest replay
needs.

Manual checks for the owner: [MANUAL_TESTS.md](MANUAL_TESTS.md).

## What was wrong

| symptom | cause |
|---|---|
| a zook on an assault soldier | `replay-recording.js` gave **every** soldier the kit of the last `pickupKit` in the file (a bot's `Jap_AT`), and picked the weapon with a regex over the kit name |
| planes with a still propeller, no gear retraction, no engine sound | the replay drew bare clones of `models/<Template>.glb` and set their transform; no drive, no rig, no audio claim ever touched them |
| landing craft silent except near the destroyer | nothing claimed their audio; what was heard near the Hatsuzuki was the level's own sounds |
| shots pointed at whatever vehicle took damage next | the parser rewrote every fire event's direction toward the next damaged vehicle, and `place()` turned the soldier to face it |
| only the recording player's shots, one per trigger press | the recorder took shots from the local input (`Game::addPlayerInput`), which exists for the local player only |
| (after the first v4 round) a rifleman's left hand in mid-air beside his Garand (3:05.4, running after a shot) | the bots' body renderer, play's bots too: three's `PropertyMixer` writes a bone only when its own value changed, so a bone the new state's clip holds still (a run's clavicles and left hand) was written once and then left to `MorphBlend`, which read its own last frame back as the clip and froze the bone in the shot's pose, the hand 27 cm off the rifle. `MorphBlend.restore` (soldier-actions.js) puts the mixer's pose back on the bones before the mixer runs; 4.8 cm, every arm bone on the clip |
| (after the first v4 round) the recording player running a metre above the ground | so was every soldier, the bots too. A soldier's sample is the engine's soldier origin, which the template's `setCharacterHeight -1.00` puts a metre over his feet, and the body renderer, the camera and the plain fallback stand a man on his feet. `replay-recording.js` `standOnFeet` lowers a soldier's samples by `CHARACTER_HEIGHT` (capture README §12); his first-person eye is 1.65 m over the ground again, not 2.65 |
| (after the first v4 round) a Defgun's shot looked like the gun being hit | a replay hides the level's own placed vehicles but left their hulls in the collision index, so a round leaving the replayed Defgun's barrel started inside the hidden baked one and burst there; and when the level's collider arrived after the replay was built, the replay's rounds lost the "skip my own hull" tag and its hull cast. `replay-gunfire.js` `syncReplayCollision` now takes the baked vehicles without a deck out of the rounds' way (a carrier's deck stays, it is a parked plane's ground) and re-arms both on whatever collider the guns hold |
| (after the first v4 round) "in the defgun I can see the rounds impacting at the correct location, but the defgun points to a random spot"; the AA gun the same | nothing turned a gun. The rounds flew their recorded rays, but a v4 file's parts were all keyed 0 and left unused, so every turret sat at its rig's rest: the Defgun's barrel 90 degrees off its rounds, skandia's AA gun 33 (up to 115), a bot's 134. `replay-aim.js` now aims each manned gun from the recording (below), on the seat's own `TurretRig` (`pointAlong`, within the axes' limits), after the drive's rig; a v5 file's parts still win |
| (a public Kursk round, `replay_20260927-140921`) a medic killing with his Mp18 at 1:52.9 drawn with a bazooka, right again after a seek | he had died in an AT kit. `killBot` builds the dead man a fresh body at once, in the kit he died with, and a stretch with nothing of him to draw left no life bound, so the new life thought he had no body and kept that one. `bindLife` now discards whatever body he has whenever the life changes |
| (the same round) an engineer's wrench never turned while he repaired | a wrench, a medic's pack and the plunger fire no round, so no `f` record ever started the torso's fire, though the recording has the engine's `Ub_FireRepairPack`. A weapon the recording writes no rounds for now fires from the recorded torso state, started again each time the one-shot runs out while the state still says fire (`ReplaySoldiers.recordsRounds`, `bot-visuals.js` `botFireHeld`) |
| (found beside it) no reload ever played; every death was a guess | a reload is only a torso state too (`Ub_StandReload<W>`), and nothing read it; it now starts the torso's reload as the recording enters it (`botReloaded`). A body's record ~0.1 s after the kill names the die state the engine chose (`Lb_DieHead`, `Lb_DieChestStand`, `Lb_DieLie`), and `killBot` plays that one (`recordedDeath`) instead of rolling its own |
| (the same round) the Stuka's bomb drop was one bomb, falling nose-down | the rack has a barrel under each wing, 6.6 m apart, and every barrel launched from the recorded point, so the two bombs lay on top of each other; and a replayed hull's rounds had no platform velocity, all a `velocity 0` release has, so they fell from a standstill and turned to face the ground. Each barrel now keeps its muzzle's offset from the recorded point (`recordedLaunch`) and every hull round leaves with the hull's recorded velocity |
| (the gun-aim work beside it) one Hatsuzuki round lit all three of its mounts | `fire` fired every gun of the round's FireArms name; it now fires the mount nearest where the round left (`nearestGroup`), the one the aim lays for it |
| (the same round) the four Flak 38s by the German base, and every Axis AA gun on every level, missing | the template is `flak38`, declared in `Objects/Vehicles/Land/Flak_38/`, and the models catalogue took a template as its folder's thing only on an exact name match, so no `models/flak38.glb` existed: the replay hid the level's baked Flak 38s and had nothing to draw in their place. `extract_models.py` `folder_key` compares without separators, which admits `flak38` and nothing else in vanilla, XPack1 or XPack2 |
| a soldier in the sea walking on the seabed | the replay's stand-in soldier gave the body renderer no swim state (`swimClips` returned null), so it drew his gait. `replay-bodies.js` `swimState` hands it the recorded lower state (v4 on), or in a v3 file the engine's own test on his origin (`swim.js`): a swimmer's origin is pinned 0.4 m under the surface. Soldier 1091 of replay_20260927-001120 now swims at 72.3 s, head and shoulders out, his rifle stowed; a death in the water is the swim death |

## What the replay reuses now

Every recorded object is presented by the code that presents the same object
in play; the recording writes the state the physics would have written.

| recorded | the map's own | how the replay drives it |
|---|---|---|
| vehicle (every hull) | `seats.js` `VehicleOccupancy` and its drive class (`Aircraft`, `GroundVehicle`, `TrackedVehicle`, `Ship`) on a clone of the template's glb | the recorded pose into `VehicleState`, then `presentKinematic` (new, `vehicle-base.js`): throttle spool, propeller spin and blade/disc swap, surface servos, gear on the airframe's own altitude thresholds (`Aircraft.autoGear`), wheels rolled at the hull's speed (a tracked hull's per side), `applyRig` |
| engine note, gun reports | `page-audio.js` `claimVehicleAudio` onto the one `VehicleAudioRack` | claimed while the root seat is held (v4: while the recorded engine runs); guns while anyone is aboard; cut on the kill |
| a vehicle's shot | `GunFire.fireShot` on the hull's own gun group | v4: the named FireArms along the recorded ray; v3: the seat's guns on the pressed trigger. Rounds are marked `replay` and `guns.onImpact` bills nothing |
| damage | `vehicle-damage.js` `activeTier`/`deathTier`, `EffectPlayer` | the template's `addArmorEffect` tiers at the recorded hit points; its death bundle when playback crosses the kill; the wreck glb |
| soldier | `bot-visuals.js` (a second instance the replay owns) | an actor per player through the renderer's own inputs: uniform, **his own kit's** weapon and packs, gait from his speed, stance, fire, death and corpse, seated body in the hull he rides |
| a soldier's shot | the weapon glb's FireArms through `GunFire` (as `bot-rounds.js`), `playWorldShot` | flash, casing, tracer or rocket from the drawn weapon, down the recorded direction; the world fire patch at the shooter |
| footsteps, death cry | `page-audio.js` `botFootstepTick`, `playSoldierDeathSound` | per actor |
| dropped kit, thrown grenade | the kit's `__pickup.kit.glb` (`kit-drops-page.js`'s mesh), the weapon glb's projectile mesh and end effect | shown where the recording has it lying; a round that goes out of the recording where it lay plays its projectile's end effect (`e_ExplGranade` for a grenade) |
| control points, tickets | `hoistCaptureFlag` (the flag's cloth, the minimap marker, the flag bar), the HUD's `ShowTicket` counter (`extras.tickets`), `round-state.js` | each point's recorded owner (`cp`) on the level's point it matches (by template, shown name, or place); the recorded tickets (`tk`, bf42plus `e692f14` on), else the page's own round run over the recorded deaths and owners from the round's start and called an estimate; no counter for a join mid-round without `tk`. The page's own round stands aside while a replay has the page |
| layer | `level-load.js` `?mode=` | from the recording's SetLevel mode file (`coop.con` plays `SinglePlayer/`) unless `?mode=` says otherwise; the briefing screen is accepted on its own and opens no spawn screen |

## Recorded, and derived

| quantity | v3 recording | v4 and v5 recording |
|---|---|---|
| hull pose | recorded, 10 Hz | recorded, 10 Hz |
| velocity, turn rates | derived from the poses (`replay-kinematics.js` `motionAt`) | same |
| throttle, revs, engine on/off | **derived**: an aircraft's from speed, climb and the take-off roll; a ship's from its speed; a land engine's revs from its own gearbox ladder (`EngineState`) and the speed | recorded: the PhysicsEngine's revs and the Engine's running flag (`g`) |
| stick (flaps, rudder, steering) | **derived** from the turn rates, in the game's signs | same |
| turret traverse, gun elevation | not recorded: the rig's rest (a press's ray is the hull's axis, not the barrel's) | v5: recorded (`j`), put on the nodes, eased into each next sample as the hull's pose is (`sampleAt`). v4: the parts, all keyed 0, decoded per hull (`replay-aim.js` `decodeKeyedParts`) and used for a gun where one carries its own rounds, every 0.1 s; else **derived** from the rounds (`f`): each is where its gun pointed, held until the gun must turn to the next as late as its `setMaxSpeed` allows |
| who fired, what, where | the recording player's trigger presses only | every round the client fires, bots included (`f`) |
| stance, held weapon, firing pose | not recorded: standing, kit primary | recorded animation states and item (`st`, `anim`) |
| swimming | **derived**: his origin more than 0.35 m under the water (`swim.js` `SWIM_LEAVE_DEPTH`), stroke from his motion along his heading | recorded: the lower swim state (`st`) |
| crew and seats | from every player's controlled object; a seat id resolves to its hull (the ids after the hull's own) | the hull and seat are in the player record |

## Recording format (bf42plus)

`sila-skandia/bf42plus` `src/replay.cpp`; the tables are in
`features/round-replay-capture/README.md` §11.3 (the decoded events), §14
(every round, the player record, the named events), §15 (parts, engines,
bodies) and §16 (the first v4 round, and v5's part numbering). The reverse
engineering behind them is there too, with addresses.

## Verification (2026-09-27)

- `tests/test_replay_models.py` (16 tests, node harness over the viewer's own
  modules): each soldier keeps his own kit (the zook report as a regression
  test), seat ids resolve to hulls, deaths from the score stream, round-end
  tallies from raw 0x31, every v4 record, the flown propeller law on a
  replayed `Aircraft` (idle blade parked; disc, turned propeller and gear up
  under power), the stick's signs, the gearbox shifting on the engine's own
  thresholds.
- Headless Chromium on `replay_20260927-001120` (v3), the owner's machine:
  44 hulls built on their drive classes; at t=102 the Aichi Val in flight at
  37 m/s, gear up, propeller turning, engine claimed; Daihatsus claimed and
  sounding; five hulls live on the rack, the audio context running; all 31
  players drawn in their own kits (UsMarine_AT bots with bazookas, Jap_Scout
  bots with the K98 sniper, the recording player with the BAR); the
  recording player's Defgun shot fired the `DefgunGunBarrel` group and its
  patch; a dropped Jap_AT kit lying where 1091 died.
- A synthetic v4 file (the same recording plus hand-written v4 records): the
  Sherman's recorded running engine claimed its note at revs 0.6, its recorded
  `ShermanGunBarrel` shot fired that group only, its tower turned with the
  recorded part; the recording player crouched, fired and drew the Colt while
  the recorded held item was 2, and the BAR again at item 3.
- The first v4 round in the game (`replay_20260927-075756`, 279 s): every
  record there, 791 rounds from 24 shooters, and every vehicle round names a
  gun its hull's model has. Its part records were keyed 0 (a child
  networkable has no id), which v5 fixes (capture README §16).
- bf42plus `9451721` (v5, with the hit indicator named) builds clean under
  `tools/build-linux.sh` (MSVC under Wine) and is installed in the game
  folder; `dsound_old.dll` is `1e45a5d`. Every event the game sends a client
  is now decoded: `0x3C` was the last one dumped raw (capture README §11.3).
- The guns aimed (`replay_20260927-075756`): the drawn barrel's world
  direction against each recorded round's, through `ReplayHull` on the
  models' own node trees in node and in the page headless. Before, at rest:
  the Defgun 90 degrees off (67 to 90), skandia's AA gun 33 median (up to
  115), bot 240's AA gun 134, the Hatsuzuki's gun 95, a Sherman's cupola
  Browning 62 and its main gun 6. After, on the decoded parts: 0.05 to 0.08
  on the Defgun, 0.05 to 0.75 on skandia's AA gun, 0.06 on the bot's, and
  medians of 0.05 to 0.38 on every other gun on an aim rig that fired (a
  quickly swept MG up to 10.7, its part sampled 0.1 s from the round).
  Between rounds the barrel is on the decoded part (0.00). From the rounds
  alone (a file with no part that matches) it is exact at every round and
  holds between them: on the Defgun session that is within 0.3 degrees of
  the recorded aim while the gunner holds his aim, and up to 95 off
  mid-traverse, where he turned early and slowly and the fallback late and
  fast. `tests/test_replay_models.py` `ReplayGunAimTests` pins the decode,
  both sources, the rig's limits and that a v5 file's parts win.

## Open

- **A v5 round**, for the turrets: MANUAL_TESTS.md step 2.
- The round-end tallies (`roundStats`) are the whole round's; a check that
  compares each player's `f` count with his `fired` tally would measure how
  many remote taps the client drops (§14's open item).
- Aim pitch is recorded (positive up, 0.4 of the aim, capture README §16) but
  not drawn: `bot-visuals.js` has no aim pitch.
- A dead bot's free camera is never replicated; the follow camera stays on
  his body until it is removed.
- A soldier blown off his feet, living or dead, goes into the engine's
  explosion states (`Lb_ExplosionForward`, `Lb_ExplosionLandFront`, 34
  records in replay_20260927-140921), and a pilot who bails out into its
  parachute states. No gait sidecar bakes the explosion clips, and the bots'
  renderer draws no parachute, so a replayed body shows neither.
- Kits dropped before the join, and a round's end effect when the round goes
  out of range rather than off, are approximations.
