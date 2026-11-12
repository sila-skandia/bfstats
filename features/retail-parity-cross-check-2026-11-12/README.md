# Retail parity cross-check, 2026-11-12

Status: done 2026-11-12. Every retail citation in the browser game's source was
re-checked against a second, independent decompile and against our own
binaries; 70-odd wrong values and laws were fixed, the ledger was corrected
where the decompile and the binary overturned it, and the documented
departures from retail were kept. What is still open is listed at the end.

## What was checked

The browser game (`tools/bf1942-models/viewer/`, `server/`, `sim/`) cites the
retail game about 7,900 times in 424 files: 681 distinct client addresses,
1,255 server addresses, about 700 ledger rows, and prose claims such as "the
engine default" or "the server's tick". The files were split into fifteen
buckets by subsystem and each bucket was given to one verifier:

| Bucket | Files | Citations |
|---|---|---|
| soldier physics (body, ground, collision, fall damage) | 23 | 429 |
| soldier states (stance, swim, ladder, parachute, poses) | 24 | 592 |
| hand weapons (deviation, recoil, heat, viewmodel) | 24 | 483 |
| projectiles and effects (flight, impacts, blast, fuses, rockets, bombs) | 25 | 653 |
| damage and armour | 13 | 298 |
| ground vehicles (drivetrain, springs, tracks, hull bodies) | 23 | 833 |
| aircraft and ships (flight, buoyancy, subs, sonar) | 27 | 498 |
| seats and turrets | 21 | 319 |
| cameras and input | 19 | 573 |
| modes, spawns, supply, kits | 38 | 736 |
| HUD, menus, console, radio | 37 | 550 |
| sound | 15 | 213 |
| rendering and level | 35 | 457 |
| bots and AI (with `sim/`) | 50 | 588 |
| netcode, server, replay | 51 | 681 |

Each verifier checked, per citation, that the code matches its ledger row,
that the row matches the third-party decompile
(`~/projects/skandia/bf1942reverseengineering`, through `recorpus.py`: the
WinPC dump is our `BF1942.exe` address for address, the Linux dump is the 1.61
`.dynamic` server matched by name, the Mac dump names client-only code), and
settled every disagreement on our own `BF1942.exe` and `bf1942_lnxded.static`
with `objdump` and `readmem.py` (added here; `objdump -s` misreads data
addresses in both files). The third-party dump was a lead and a second reader,
never the verdict, as the engine-reference README's "The second corpus" asks.
Each bucket's full record, with the MATCH lists and every address read, is in
[`buckets/`](buckets/).

## What changed in the game

The ones a player or a bot watcher will notice:

- **Bots' anti-aircraft spread** (AI-36): ground bots now take retail's penalty
  of 30 against an air target (10 from naval units, 3/1 under a held trigger),
  keyed on a non-air shooter firing at an air target. They were shooting
  planes with almost no AI spread.
- **Bots bail out of a tank on a bridge over steep ground** (AI-44): retail's
  upside-down test compares the hull's up with the *heightmap* normal under
  it (`BFEnvironment::getNormal` -> `PatchTerrain::getNormal`, statics
  ignored) at 0.7071, and never tests aircraft or fixed guns. On Kharkov 99% of
  the new flags are tanks level on the two stone bridges over 52-degree banks.
  Route failures on DICE's vehicle levels rose about five-fold; that is what
  the retail rule does. To take it back: the `upright` line in `bot-units.js`.
- **AT and thrown weapons are point-accurate** (DEV-8): `minDeviation` /
  `maxDeviation` are in neither binary, so the 78 templates that use only
  those words keep the constructor's zero cone; the total is never clamped.
- **The first-person eye halves its distance each 30 Hz tick** between stances
  (VIEW-15), instead of a linear ease over a clip length.
- **Engine sounds follow their curves** (SSC-7): six-parameter `Ramp`s are
  linear, quick or slow with an exponent (5,140 of them, mostly rev-to-pitch),
  not straight lines. Doppler shifts only looping samples (SND-45); the dive
  angle is `(2/pi) asin` of the nose's descent (SND-24).
- **A soldier's acceleration is clamped** at 1000 m/s^2 a tick, friction over
  250 dropped (PHY-34): a close satchel or shell throws at most 33.3 m/s a tick.
  A swimmer is pushed by 0.75 + 5.0 times the command (PHY-6). The drowning
  clock also runs while water stands over the origin (HP-23).
- **Engines clip throttle and steer to their own min..max span** (TANK-12):
  347 of 1,428 land engines are uneven; EoD's trucks reverse at 0.6 of forward.
  An omitted `setAcceleration` is the bundle's 0.1, and an axis with maxSpeed 0
  runs no servo.
- **Engine defaults for omitted words**: differential 10, torque 60,
  noPropellerEffectAtSpeed 100 for aircraft, ships, helicopters, rockets and
  torpedoes. Twelve bf1918 engines (zeppelins, the Lebaudy, the armoured
  train) faded their thrust at 70 m/s instead of 100.
- **Damage**: a damage-table pair with no cell does no damage (DMG-1, in the
  two places that priced it x1); an unwritten upside-down or water rate is 1.0
  HP/s; water damage bills from the first wet frame; a ship destroyed in one
  blow stays afloat, because death sends 0x15 without 0x14 (HP-13).
- **Capture and spawn**: a lone attacker takes an owned point whose lose timer
  is spent (AI-100); spawn points outside the combat area are never offered
  (SPAWN-5); the capture radius default is 10 m; the spawn countdown uses the
  server's wave law with 20 s / 3 s / 5 s (SPAWN-35); a CTF flag with no
  `TimeToReSpawn` goes home at once (CTF-12); depots fire strictly after 0.5 s
  and start at a random phase (SUP-4).
- **Netcode**: the per-connection budget is 1400 bytes (J-1), the choke is
  retail's one-pass fair share with cap 0 = off (R-1); the room client draws
  remotes 100 ms behind from a 16-snapshot history with up to 1.2 s of
  extrapolation (the relay's law, now shared in `ghost-draw.js`); the room
  server runs one tick when more than nine are owed (D-4).
- **HUD**: the vehicle reload bars are retail's reload-else-fire-interval with
  a 0.1 s dead band (VHUD-10), live and in the replay; the map hides hulls past
  the view distance outside a joined game (MMAP-3); radio items are not dimmed
  in a joined or hosted Conquest game (RADIO-15).
- **Rendering**: tree billboards swap on horizontal distance times the view's
  field of view (VID-1); the alpha-LOD near test uses selectLod's
  `d^2/m - r^2` (DL-12); the texture fade is `trunc(255 clamp(e/D^2))` with D
  each geometry's `textureFadeMaxDist`, engine default 200 (DL-13).
- **Third-person torso** (ANIM-23): the drawn upper-body bend stops at +-20
  aim degrees standing or crouched, and lying bends up only, 0..6, as
  `setLiePointUpDownAngle` says. It is a drawing clamp, not a look limit.

And many smaller ones: strict comparisons where the code had `<=` (the swim
exit, the chute close, the soldier handler's 0.1, the crossfade's 1000, the
depot's 0.5), `trunc` and `ceil` where the code rounded (sense rays, the
aimer's halvings, WPMoveTo, the mounted fire score; the third-party dump's
`ROUND` was wrong for the first), 3.14 x 0.25 for the box-drag area, parachute
clips of 2.0 / 1.0 s, the entry radius default 3.0, a seat's exit at its own
origin, and DEFINE KEY's Grave unbinding the box as Escape does.

## Gravity: one value, and a mis-decode withdrawn

`BasicPhysicsSystem`'s constructor (lnxded `0x08251e3b`, client `0x00578f11`)
writes `0xC16BAE14`, which is float32 **-14.73** (-14.7299995). A 2026-09-15
note in `flyable-vehicles/flight-model.md` had decoded it as -14.7295379, and
that number had reached the aircraft code, `dogfight-flight.js`, physics.md,
AIRGND-1 and several "x 1.49995" factors. This cross-check first spread the
mis-decode further, then caught it reading the constant back with
`readmem.py - 0xc16bae14 hexf`. `g / -9.82` is 1.5 to float precision (the
ships VERDICT had it right), and the docs and rows were corrected.

The viewer's shared value is `rigid-body.js` `GRAVITY = -14.73`, which ships,
floats, ground hulls, soldiers and rounds use. **Two modules are held on the
old pair, -14.7295379 and a pi/4 box area: `aircraft.js` (the flight law) and
`aircraft-ground-law.js`** (which steps the same body in the air, so it cannot
run another gravity). At the retail values 76 dogfight-school tests fail and
about 30 lessons break their own claims (two planes fly into the ground, the
Kursk drag-and-bag gets no shot, counters let the shots land again), and
`test_air_law`'s Bf109 lift-off reads 1.19 mm against its 1.0 mm lab bound.
The difference is 0.003% of g and 0.05% of the box area, but the lessons are
tuned on knife edges. Both modules say so at the constants, with the retail
values and addresses; switching them needs the dogfight school retuned
(`buckets/air-sea.md`, "Held", lists every lesson that breaks and how).

## Caught on the way

Four things this pass got wrong first. Each was caught by a check that the
next pass should run too:

- **The gravity mis-decode** (above): a verifier quoted an older doc's
  decoding of an immediate instead of decoding it. Decode every immediate you
  quote (`readmem.py - <hex> hexf`).
- **Bots that could not kill.** DMG-1's "no cell is x0" was right, but a bot's
  round carries no material until its weapon glb has loaded (the headless
  runner never loads one), and the first fix read that gap as engine material
  0: a rifle round did 0.03 HP and bot kills on foot fell from 0.87 to 0.016
  per bot-minute. Only the DICE trace run showed it; the unit suites passed.
  `crash-damage.js` `roundAttackerMaterial` now tells our own gaps (null,
  priced at the old stand-in) from a template that authors no material (the
  engine's 0, `0x0831eeda`, `0x081dbd4c`), and `sim/level.mjs` shares the law.
  `tests/test_round_damage_parity.py` pins it.
- **A test level outside its own combat area.** Never offering a spawn point
  outside the combat area (SPAWN-5) stopped the room harness's flat level
  spawning anyone: it declared no area, so its play area was the terrain's
  extent, and its spawns lay outside. Retail would refuse them too; the level
  now declares an area.
- **A cruise test that a perfect run would fail.** The bot tank test compared
  the run's median with the lab's p95. It now compares p95 with p95, hull by
  hull.

`test_room` had been skipping on this Mac for want of assets, which hid a
stale module list; it runs again with Wake, Battle of Britain, Willy and Zero
mirrored from the live site into the (git-ignored) local tree. A model glb is
served from the content store as `glbs/<sha>.glb`, not `models/<name>.glb`.

## Kept on purpose

Departures from retail that each bucket confirmed are documented, so nobody
"fixes" them back: the client's 12-tick and 10-tick catch-up clamps (retail
collapses more than nine to one; the room server now does the retail thing),
the controls screen's 40 px mouse capture, the NaN centring in
`floatToFixed`, swimming and the parachute on the point body,
`LOW_SNAP_SHARE_B = -1`, the stand-up refusal under a ceiling (now documented
in `viewer-soldier-stance-and-blast`), the zero-area combat area treated as
none, the deterministic spawn walk, CTF bases for the living only, the bot
hold-fire (FF-7), the doppler clamp, loudest-emitter ambience, texture quality
as anisotropy, the viewer-only fog modes, the Instant Battle AI slider,
the open map's framing, the 60 Hz track-scroll pin, and the bomb rack that
never goes into ammunition debt (retail's `fireFinished` charges a whole
salvo and a short magazine goes negative, BOMB-5).

## The ledger

20 new rows (among them FA-26, HP-23, PHY-44, ANIM-23, SEAT-39, SPAWN-35,
CTF-12, NET-21, NET-22, PROX-10, DL-13, SSC-7, RADIO-15, COL-26 and
AI-164..AI-168) and about 70 corrected or extended, every overturned claim
struck through with what overturned it. The biggest corrections: J-1's 1044
bytes (1400), R-1's choke, P-2's "ghosts every 0.1 s" (that is the scope
refresh; ghost data rides every packet), VHUD-10's heat feeder, AI-44's 0.6914
(0.7071, against the ground normal), AI-33's rounding, TANK-2's differential
reason, PARA-5/6's `<=`, DL-12's "squared distance", ARM-1's threshold rule
and HUD-20's "buddy list".

## Data that still has to catch up

The exporter now carries what retail reads, but some trees can only be
rebuilt elsewhere:

- **`textureFadeMaxDist` (`materials` layer)**: patched and published from
  live for vanilla (with the community levels), XPack1, XPack2, bf1918, EoD
  and Desert Combat. Not FH (this Mac's install lacks 20 of its 80 level
  archives, so a bake here would drop 171 live material entries), FHSW or
  FHSWEurope (installs on the Linux PC): run
  `patch_scene.py --layer materials --mod <M> --all` there. Until then those
  trees draw the 70 m interim.
- **Mod re-extracts** (out of extraction scope without the owner's go):
  bf1918's `autocarmg` top MGs traverse at 40 once re-extracted (`con.py` now
  reads `setMaxSpeed 40/0`), and its `horse_spearcamera`; FHSW/FHSWEurope's
  four gt101/102 engine rig axes; FH's `pzl11ElevatorLeft`; DC's F-14 front
  hatches; and the deep-water damage words for bf1918 (137 templates), EoD
  (4) and GCMOD (3). Vanilla's SBD hatch changes nothing the viewer drives.
- **`setPcoId` and `setLiePointUpDownAngle`** are not extracted; the seat order
  is exact for vanilla, and the torso clamp uses the vanilla pair.

## Still open

- **The aircraft laws on retail's g and box area** (above): held until the
  dogfight school is retuned on -14.73 and 0.785.
- **The T-72's top speed**: the bot cruise test now compares the run's p95
  with the lab's p95 hull by hull (`test_ground_handling`). The M1A1, BMP-2
  and M2A3 match; the T-72 has the M1A1's drivetrain ceiling where retail tops
  out at 11.3 m/s (`lab-ground-truth.md`), so its test is an expected failure
  until its ceiling is found. The M1A1 at retail's 0.785 settles in the bots'
  +-0.02 steer cycle (AI-45 is exact on the binary; TANK-24's hundredth
  rounding gives the law two basins) and matches the lab's p95 but not its top
  speed; only the lab's per-tick steer words can say which basin retail sits in.
- The world camera's zoom FOV ease (hand weapons F4): the camera-mode switch
  at `0x004fc8b6` sets the flag only; the code that applies the zoom FOV was
  not found.
- The soldier's drag bounding radius, 0.8 (PARA-6): computed at runtime from
  geometry and kit; needs a lab read of `0x08165630`.
- Lens-flare sprite size: lnxded's `buildFlare` scales by 25.0, in units the
  client's vertex writer would settle (LOAD-28).
- A held area's wanted strength (AI-168): a sampled running value fed by
  `EnemyStatistics::sample`, not read.
- The `checkVsTerrain` branch for a part with more than 10 collision vertices
  (COL-26), the equal-distance door tie order (SEAT-32), the voice a ninth play
  steals, and where the Skirmish bot percentages go.

## Where the evidence is

- [`buckets/`](buckets/): each verifier's findings, fixes applied and the
  ledger text it drafted, with addresses and disassembly.
- `features/bf1942-engine-reference/ledger.md`: the rows named above.
- `features/bf1942-engine-reference/readmem.py`: typed reads at a VMA in
  either binary.
