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
| (checking the bombs in the page) a paused replay's bombs went on falling and burst; at 4x they fell at a quarter of the round's speed | the page advances its rounds (`GunFire.advance`, on the world's tick) and its effects on its own clock, whatever the replay is doing. `GunFire` and `EffectPlayer` take a `timeScale`, 1 in play, and the replay sets its playback rate there every frame (0 while paused or dragged), and 1 again when it closes |
| (the same round) the four Flak 38s by the German base, and every Axis AA gun on every level, missing | the template is `flak38`, declared in `Objects/Vehicles/Land/Flak_38/`, and the models catalogue took a template as its folder's thing only on an exact name match, so no `models/flak38.glb` existed: the replay hid the level's baked Flak 38s and had nothing to draw in their place. `extract_models.py` `folder_key` compares without separators, which admits `flak38` and nothing else in vanilla, XPack1 or XPack2 |
| a soldier in the sea walking on the seabed | the replay's stand-in soldier gave the body renderer no swim state (`swimClips` returned null), so it drew his gait. `replay-bodies.js` `swimState` hands it the recorded lower state (v4 on), or in a v3 file the engine's own test on his origin (`swim.js`): a swimmer's origin is pinned 0.4 m under the surface. Soldier 1091 of replay_20260927-001120 now swims at 72.3 s, head and shoulders out, his rifle stowed; a death in the water is the swim death |
| (replay_20260927-140921) a man a blast threw ran on through the air, and, killed in it, fell with a standing death where the score stream found him, a corpse left hanging in the air | nothing baked `AnimationStatesExplosionFly.con`'s twenty states and the renderer had no path for them; and a replayed corpse is left where it is made. `extract_pose.py --explosion` bakes them into `gaits/explosion.gait.glb`; `SoldierActions.followHeld` holds the legs in the recorded state by name, and the torso where the recorded torso is the explosion's own (a thrown man's is often a hit or his aim), his weapon stowed (`c_AsmHideWeapon`), a sample early so his legs never run (`FLIGHT_LEAD`: the state is on the record a tenth after his samples leave the ground). A dead man still in the air is drawn by his body until the recording lands him (`recordedFlight`), and his corpse is the landing, `Lb_ExplosionLandFront` / `Back`, where he came to rest; his cry stays at the blow. All eight thrown men of that round were dead: soldier 3 flies 27 m from 30.8 s and lies on his face at 33.0 s, soldier 24 tumbles, bounces and lands on his back at 55.2 s |
| a pilot who bailed out fell standing, with no canopy | the parachute bundle was bound but nothing entered it for a replayed man or a bot, and only the human's body drew a canopy. The recorded parachute states hold the legs the same way (the glide's torso is his own aim, fire and reload, `Ub_ParachuteOpen`'s `addTransitionWhenDone Ub_StandAim`); the canopy (`parachute.canopy.glb`, `foot-body.js` `canopyAsset`) is out while the recorded state bit `0x10` is (`setIsParachuting`), opening while his legs do, idle after, hung at his origin plus the template's `addTemplate Parachute` 0/0.3/0. Soldier 22 falls from 70.8 s, opens at 72.8 s, fires his No4 under the canopy at 78.8 s and lands at 84.5 s; a man killed under his canopy rides it down and is left where it lands (`Lb_ParachuteDeadHitGround`). A page bot's own `Parachute` (a fall from a plane, the chute pulled) takes the same path |
| (a public Midway round, `replay_20260927-203459`, 6:20) El Zilcho's Zero firing and silent; so was every aircraft and hull machine gun | a gun patch made of loops (every MG's: `CAMG1`, `brownmlp`, `MG42_fire`) sounds only while its group fires (`vehicle-audio.js`, `group.firing`, the trigger in play), and a replayed gun has no trigger, only recorded rounds; one-shot guns (cannons, AA, bombs) were the only ones heard. `replay-hulls.js` `holdSound` holds `group.sounding` a round and a half at the gun's rate (0.2 s at least) past each round while the replay runs, and the rack opens on it. The rack also asks every mount of a name, not the first: a destroyer's third Browning left the shared patch shut, in play too |
| (the same round, 9:58) "Rut appears to kill Niconan but it shows as a team kill" | a public server hands a leaver's pid to the next to join, and the replay knew each pid by its last holder: pid 11 was Omen on the Axis when Rut's bazooka killed him (score kind 3, a kill), switched to the Allies in the same tick, left, and was Niconan (Allies) by the round's end. The log compared those final sides and printed "Rut killed a teammate / Niconan is no more". The parser keeps every pid's sessions (join, leave, each change of side from `setTeam` and the player records; `playerAt`, `nameAt`, `teamAt`), stamps each kill with the sides as the file stood at its line, and the score kind decides a team kill (`deathLines` `how.teamKill`). Chat lines, the card, the scoreboard (whose tally forgets a leaver's score), the tags, the kill log, the highlights and the server log's rows name whoever held the pid then: 3star's "lunch time" is 3star's, not "BF Udo Mayer: 3star: lunch time" |
| (the same round) the PT boats, their rafts, the Kubelwagens, the Stationary MG42s and the B17 silent | a level's `sounds.vehicles` covers the templates its own spawners place, and this server spawns others. `_shared/vehicle-sounds.json` (`extract_vehicle_sounds.py`, every vehicle template of the mod, the levels' own entries) is the rack's fallback for a template the level lacks (`page-audio.js` `sharedVehicleSounds`) |
| (the same round) both carriers, the Yamato, both Hatsuzukis, a Fletcher, eight Daihatsus and two LCVPs missing; the PrinceOW and the Fletcher2 appearing from nowhere at 405 s | the file began 41 s after the join (a recorder before bf42plus `0254e92` kept none of the join's objects), and each stayed beyond the 520 m view distance, so the sampler never named it; the replay hides the level's own vehicles. `replay-standins.js`: a hull the file sees late (41 of them: everything on the airfield first seen at 8.7 s, the PrinceOW, the LCVPs) lives from its first trace in the part and engine records, where it was first seen, when its engine never ran in between; a root nothing ever names is matched to the level vehicle whose parts it has, and stood in by it (18: a place holds one hull, so the unnamed destroyer takes the pad the Fletcher2 does not; the carrier removed at 389 s and made again at 499 s is the Enterprise). Both are drawn solid while nobody drives them (capture README §19) |
| (the same round) a respawned Enterprise carried a frozen Corsair, SBD and two LCVPs on her deck | a ship's `models/<Ship>.glb` bakes the craft its spawners launch, which a level detaches (`detachSpawnedCraft`); a replayed ship kept them, doubling the recorded craft and counting their seats among hers. `ReplayHull` drops them (`spawned-craft.js` `spawnedCraftUnder`) |
| (the same round) three soldiers never died and had no kit (806, 814, 740) | their players held them from the file's first record, and the recording first saw them 8.5 s in; a soldier took his player only from a control record at or after his first sighting. The owner is now whoever's hold on that id overlaps the life, and a kit picked up before the first sighting finds him through what his player controls |
| (the same round) no radio | nine RadioMessage events (0x3A) were read by nobody. They go through the page's own `comms.receive` with the recording player as the listener: the game's line (`[D5] Rut: Enemy armor spotted!`), team radio in his side's voice, a shout in the speaker's voice at the speaker; a line a seek rebuilds is not heard again |
| (the same round) twelve `special` events read by nobody | SpecialGameEvent type 0 is a refill: lnxded `GameServer::triggerSpecialGameEvent` (0x081591a0) sends it to the client of a player a depot resupplies, whose soldier plays `SoldierRefillAmmo.ssc` (`BFSoldier::triggerRefillAmmoSound` 0x0827ebc0). The recording player's refills play `Ammorefill` at him, full to 10 m and gone at 15 m (`page-audio.js` `playRefillSound`); one log row a visit |
| (the same round) ten "round playing" rows | the server sends every client the status again whenever someone joins; a row is now a change |
| (the same round) MoonGamers' messages were drawn with spaces the game does not show | its lines separate words with byte 0x80, which the game draws as nothing: they read as one word, `*Donotsteal/destroyequipment...` (the owner, 2026-09-28). `chatText` drops the byte rather than leave a browser font to draw it |

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
| blown off his feet | not recorded: drawn in his gait | recorded: both halves' explosion states (`st`) and his flight (`s`), the landing a dead man comes to rest in |
| a bail-out | not recorded: drawn in his gait | recorded: the parachute states and the chute's state bit `0x10` (`st`); the canopy is derived from the bit, as the engine's child object is not replicated |
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
- Knockback and bail-out, headless Chromium on `replay_20260927-140921`
  (v5), the page's own renderer, stepped at 30 frames a second: soldier 3's
  legs enter `Lb_ExplosionForward` at 30.8 s with his weapon stowed and his
  torso on its own machine, his body is drawn flying after his death at
  32.78 s, and his corpse is `explosionLandFront` at 33.0 s where he landed
  (546.6, 84.2, -587.0); soldier 24 goes `BounceFront`, `Forward`,
  `BounceFront`, `Backward` with both halves and lands on his back at 55.2 s;
  soldier 22 is `Lb_ParachuteFall` from 70.8 s, `Lb_ParachuteOpen` under the
  `open` canopy from 72.8 s, the glide with his No4 out, `Ub_Fire` at 78.8 s
  and the bolt after it, `Lb_ParachuteHitGround` with the canopy gone at
  84.5 s, and on his feet at 85.0 s. On `replay_20260927-075756` (v4) nid
  775, first on the record already in `Lb_ParachuteOpen` (52.71 s, no fall
  before it), the opening and the canopy start on that frame, and he fires
  his Panzershreck under the canopy at 55.7 s: every state is entered by its
  own name, and the canopy asset is asked for with the first body drawn.
  `tests/test_replay_models.py` `ReplayKnockbackAndParachuteTests` pins the
  same over a synthetic v5 file and a page bot's `Parachute`;
  `tests/test_explosion_assets.py` the bundle.

## Every record and event, cross-checked (replay_20260927-203459)

The Midway round of 2026-09-27 (MoonGamers, a public server, 883 s, v5,
begun 41 s after the join) holds every record kind and 23 event kinds. Each,
and where the replay presents it:

| record / event | count | presented by |
|---|---|---|
| `h`, `end` | 1, 1 | the format; the file's clean close |
| `serverInfo`, `serverName`, `challenge`, `setLevel`, `gameRules` (`ago`) | 1 each | the level, mod and server name; the challenge and the rules (friendly fire, ticket ratio, crosshair) change nothing drawn |
| `roster` | 1 (11 players) | the players' first sessions; a known player's side and `local` |
| `createPlayer`, `destroyPlayer`, `setTeam` | 10, 8, 3 | each pid's sessions (four ids passed to a new player; one side switched in the tick of a kill) |
| `p` | 1953 | who controls what, and each player's side as it changes |
| `o`, `s`, `d`, `createObject`, `destroyObject` | 517, 8379, 462, 260, 780 | object lives, their range and removals; removals of objects never seen feed the stand-ins |
| `jn`, `j`, `g` | 56, 5863, 6756 | turrets, engine notes and propellers; the traces a late or unnamed hull is carried back by |
| `a` | 1117 | hit points, damage tiers, wrecks and the kill's explosion |
| `f` | 2155 | every round, from its own gun, sounding while its rounds leave |
| `fire` (the input edge) | 255 | the replay log only (`f` has the rounds) |
| `st`, `anim` | 6367, 1 | stance, held weapon, fire, reload, swim, blast and chute states |
| `score` | 286 | the kill log (kinds 3, 4, 5 here), spawns and attacks in the replay log |
| `control`, `enterVehicle`, `exitVehicle`, `pickupKit`, `projPool` | 173, 114, 99, 95, 114 | who controls what, the seats, each soldier's kit, the grenades and mines lying about |
| `chat` records, `chat` fragments | 47, 140 | the chat box as shown (the fragments are v2's) |
| `cp`, `tk`, `clock` | 56, 125, 88 | the flags, the recorded tickets, the round clock |
| `hitFrom` | 41 | the recording player's red hit wash in his own first person |
| `radio` | 9 | the message log's radio lines and voices |
| `special` (type 0) | 12 | the recording player's refill sound |
| `gameStatus` | 10 | a replay log row for a change of status only |

## Open

- **A round begun after the join with the new recorder** (bf42plus
  `0254e92`, installed 2026-09-27 22:52): the file should open with every
  player's `createPlayer`, every standing object's `createObject`, the pools
  and the kits, each with `ago` (MANUAL_TESTS.md step 4). Until then the
  stand-ins are what such a file gets.
- A soldier alive at a late file's start whose kit went by before it (723, dead
  at 3.6 s) has no kit in the file, so his body has no kit weapon; the new
  recorder's held createPlayer and pickupKit give it.
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
- `gaits/explosion.gait.glb` is in the three vanilla trees (and their two
  hard-link mirrors), but no tree's `gaits.json` names it yet, and a page
  reads the bundle only through that key: `extract_pose.py --explosion
  --out viewer/models/poses`, and with `--mod XPack1` / `--mod XPack2` into
  `models/mods/xpack1/poses` / `xpack2/poses`, merges the one key in place
  (and rewrites the glb with the same bytes); then publish the glb and the
  three manifests.
- A man killed in free fall (`Lb_DieHitGround`) is left a corpse where he
  died, in the air: a corpse does not follow his recorded body down. None in
  the recordings so far.
- Soldier 22's torso reads `Ub_ParachuteHitGround` through his whole free
  fall (70.77 to 72.76 s), where the server's `handlePlayerInput` sets
  `Ub_ParachuteFall` (`template+0x1e8`); drawn as recorded.
- The human's own canopy (`foot-body.js` `syncFootBody`) hangs at his feet
  plus 0/0.3/0, a metre under the bots' and a replay's, which hang it at his
  origin (`CHARACTER_HEIGHT` over the feet), where the risers meet his
  shoulders in the page (soldier 22). Not checked in play.
