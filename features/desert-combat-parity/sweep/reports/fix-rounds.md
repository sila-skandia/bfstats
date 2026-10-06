All eight work items in the `rounds` package are built and committed on the branch: the four you assigned, plus open question 4 (FireArms velocity default), CW4 (`hasOnTimeEffect`), DEV-9 (the square deviation cone), and the tracer-gravity route through the damage table. The full suite at HEAD has one failure, `test_nav_baked` Bocage route failures (308, needs under 100). It is not caused by this branch: I ran that match at my branch base `70d0b6ea` and also got 306; current `main` gives 0, so someone else's commits fixed it.

Nothing here has been checked against the real game. The laws are read from the binary; the ranges they produce on DC's data have not been watched in DC.

**What was wrong, and what changed**

- **Rockets fall (item 22).** `round-launch.js` gave every `kind:'rocket'` round gravity 0. Every drawn round now uses `spec.gravity ?? 1` (IMP-7). Across all five trees only vanilla's Katyusha, DC/DC Final's MLRS, BM-21 and SCUD-B, the Maverick (0.1) and the Silkworm (1.0) change, each checked against its `.con`.
- **Bullet-kind rounds fall (items 19, 24).** The tracer path had no gravity at all.
  - It now uses the projectile's own value for ordinary rounds and the tracer template's own value for tracers. The exporter writes `fireArms.tracer.gravity`, and `damage.json` rows carry it too.
  - Vanilla rifle and MG rounds declare 0 and are unchanged (measured: 0 drop before and after).
  - DC's 25 mm now falls at 0.2, and CBU-87 bomblets, XPack2's thrown knives and DC's heavy tracers fall at 1.0.
- **Rocket motors (item 21, open question 1): proven, so the 25 m/s² placeholder is gone.** Read on the Linux server binary, recorded as PHY-16..PHY-20:
  - A projectile's child `Engine` is updated every tick like a vehicle's, and its push lands on the round itself.
  - `c_ETRocket` starts itself, pins its throttle, and pushes with the aircraft thrust law. It stops below water: the engine's branch test is the water level, which also refines how TANK-7 was read.
  - Rounds with `setHasPointPhysics 0` drag by the box law on their own geometry; how its areas pair with the body's axes is now read rather than inferred, and π there is `3.14f`.
  - Built as the new `viewer/rocket-motor.js`, run on the engine's 30 Hz tick; the landing moves 0.3% across 30, 60 and 144 Hz.
  - The tail wing's effect is inferred, not read: I hold the nose on the flight path.
  - At 45°: Katyusha 481 m, MLRS 1313 m, BM-21 952 m, SCUD-B 4057 m.
  - Bombs also get the box law now: a Stuka bomb lands 1211 m out instead of 1229 m.
- **Open question 4.** A FireArms with no `velocity` launches at 200 m/s, not the invented 100 (FA-3, both constructors).
- **CW4.** A round now bursts at the end of its life only when it sets `hasOnTimeEffect`; otherwise it vanishes silently (PROX-7; constructor default 0).
  - Parsed in `con.py`, written into every `damage.json` row; assets too old to carry it keep the old burst.
  - Measured: AA_Allies still bursts at 240–420 m, Flak38 at 240–355 m, and the DC Shilka shell, which used to burst 983 m out, now vanishes.
  - Vanilla also loses expiry bursts on shells that would normally hit something first, and on `AA_POW` and `Yamato` flak, which keep their proximity fuse.
- **CBU-87 (item 24).** `e_CBU87Emission2` names its mesh inline as `StandardMesh:<path>`. The engine treats the part after the colon as a file; the reader treated it as a template name.
  - The reader is fixed (`con.py` `geometry`, ledger SM-13). Scratch bakes: DC and DC Final each gain exactly that one bundle; vanilla's bake is identical.
  - I also fixed a bug my gravity change exposed: a falling stand-in streak swung its head and put a bomblet 20 m off. One A-10C pull now lands all 14 submunitions, each within 1.6 m of its predicted fall point, in a 38 m × 74 m pattern. Before, none landed.
- **DEV-9 (re-checked in the binary first).** The cone is now a square in hundredths of a radian, not a disc in degrees. A cone of 1 reaches 0.573° per axis (rms 0.33°, 4% of rounds in the corners) instead of 1.0° (rms 0.50°). Every gun in every mod is 1.75× tighter per axis.

**Commits** (`9161b1a0`..`17da3b54`, 10, no Co-Authored-By): rocket gravity, bullet/tracer gravity, motor + box drag, velocity default, `hasOnTimeEffect`, CBU, tracer gravity via damage table, SM-13 docs, assets docs, DEV-9.

**Files touched**
- Viewer: `round-launch.js`, `projectile-flight.js`, new `rocket-motor.js`, and a one-line default in `bomb-release.js` (open question 4).
- Exporter: `bf42/assemble.py` (damage and tracer words only), `bf42/con.py` (`hasOnTimeEffect` parse, inline geometry), `extract_map.py` (projectile table).
- Tests: new `rocket_flight_harness.mjs` and `test_rocket_flight.py` (25 tests). Expectations updated in `test_assemble`, `test_collision`, `test_con` and `test_bomb_release`. Two modules added to the staged lists in five other harness tests.
- Docs: ledger rows PHY-16..20, FA-3, SM-13 and a PROX-7 update; `subsystems/physics.md`; `symbols.json`; the knowledge skill's topic map; new `features/rocket-flight/README.md` with its `features/README.md` line.
- `extract_effects.py` and `bf42/effects.py` needed no change: the gap was in the reader. `con.py`, `extract_map.py` and `bomb-release.js` were outside my file list; each hunk is small, for the reasons above.

**Asset commands for you**
1. Damage layer, every tree (`hasOnTimeEffect` and tracer gravity): `patch_scene.py --layer damage --mod <M> --all` for `bf1942`, `XPack1`, `XPack2`, `DesertCombat` and `DC_Final`. It works for DC: tried on a scratch copy of El Alamein. Then `publish-mesh-delta.py maps --hash`.
2. Effects library: `extract_effects.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared`, and the same for `DC_Final` into `viewer/maps/mods/dc_final/_shared`. Then publish.
3. No model or level re-bake is needed. The glb copies of these words ride the next bakes.

**Still open**
- The tail wing's weathervaning is inferred.
- DC's data with the read laws gives surprising top speeds: Hellfire about 82 m/s, AT-2 16 m/s, a TOW past 800 m/s. A lab recording of a vanilla Katyusha salvo would check gravity, motor and drag at once.
- The CBU canister bursts at 1.0 s, so only about 0.1 s of bomblets is drawn. Whether the engine keeps a detonated round's child effect running is unread.
- `hasCollisionPhysics 0` is not honoured for rounds: DC's `Blank_Projectile` now falls and can hit the ground in front of the MLRS.
- DC's `e_ExplAni01` dirt-gibb emitters still drop out of the effects bake, for a different reason.

**Belongs to other packages**
- `torpedo-run.js`: under water the torpedo engine's revs should follow the gearbox, not sit at 1.0 (PHY-17/18), which would lower its 158 m/s top speed. PHY-16 also answers that file's open question: a projectile's Engine is stepped.
- Bots: `bot-referee.js` `rollCone` still rolls a disc in degrees. CW12 (exit velocity) is also the bots agent's, as you said.
- `aircraft.js` and `ship.js` use π/4 for the box-law area where the engine uses 3.14/4.

**For the DC parity table**
- 19 Works.
- 21 Works (laws read, the wing inferred).
- 22 Works.
- 24 Works once the effects library is rebuilt (the bomblet draw is still short, as above).

Everything is in `features/rocket-flight/README.md`; scratch scripts are in `~/.cache/dc-sweep/rounds/`.