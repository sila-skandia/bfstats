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
| (after the first v4 round) a Defgun's shot looked like the gun being hit | a replay hides the level's own placed vehicles but left their hulls in the collision index, so a round leaving the replayed Defgun's barrel started inside the hidden baked one and burst there; and when the level's collider arrived after the replay was built, the replay's rounds lost the "skip my own hull" tag and its hull cast. `replay-gunfire.js` `syncReplayCollision` now takes the baked vehicles without a deck out of the rounds' way (a carrier's deck stays, it is a parked plane's ground) and re-arms both on whatever collider the guns hold |

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
| layer | `level-load.js` `?mode=` | from the recording's SetLevel mode file (`coop.con` plays `SinglePlayer/`) unless `?mode=` says otherwise; the briefing screen is accepted on its own and opens no spawn screen |

## Recorded, and derived

| quantity | v3 recording | v4 and v5 recording |
|---|---|---|
| hull pose | recorded, 10 Hz | recorded, 10 Hz |
| velocity, turn rates | derived from the poses (`replay-kinematics.js` `motionAt`) | same |
| throttle, revs, engine on/off | **derived**: an aircraft's from speed, climb and the take-off roll; a ship's from its speed; a land engine's revs from its own gearbox ladder (`EngineState`) and the speed | recorded: the PhysicsEngine's revs and the Engine's running flag (`g`) |
| stick (flaps, rudder, steering) | **derived** from the turn rates, in the game's signs | same |
| turret traverse, gun elevation | not recorded: the rig's rest | recorded (`j`); usable from v5 only, a v4 file's parts are all keyed 0 |
| who fired, what, where | the recording player's trigger presses only | every round the client fires, bots included (`f`) |
| stance, held weapon, firing pose | not recorded: standing, kit primary | recorded animation states and item (`st`, `anim`) |
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

## Open

- **A v5 round**, for the turrets: MANUAL_TESTS.md step 2.
- The round-end tallies (`roundStats`) are the whole round's; a check that
  compares each player's `f` count with his `fired` tally would measure how
  many remote taps the client drops (§14's open item).
- Aim pitch is recorded (positive up, 0.4 of the aim, capture README §16) but
  not drawn: `bot-visuals.js` has no aim pitch.
- A dead bot's free camera is never replicated; the follow camera stays on
  his body until it is removed.
- Kits dropped before the join, and a round's end effect when the round goes
  out of range rather than off, are approximations.
