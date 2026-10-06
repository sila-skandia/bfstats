# Desert Combat parity

Status (2026-10-07, round paused for quota): the sweep and two fix rounds have
landed on main except fixed-wing (built, review not finished) and bot-gunners
(work in progress). **The DC and DC Final asset re-extract and re-bake has not
been run**, so the live trees still show the old data for every exporter-side
fix below. This page is the tracker for the round: what the census found, what
each package changed, how it was checked, and what is still open.

## Resume here

Do these in order. Each step says where its work is.

1. **Review and land fixed-wing.** Branch `dc-parity/fixed-wing` on origin
   (local `worktree-agent-af900aeea9f96ae0a`, worktree
   `.claude/worktrees/agent-af900aeea9f96ae0a`). This is the fix for the
   original complaint: the Harrier and Black Hawk answering input the wrong
   way. Its implementer's report is
   [sweep/reports/fixed-wing.md](sweep/reports/fixed-wing.md).
   - Give one reviewer [sweep/REVIEW_BRIEF.md](sweep/REVIEW_BRIEF.md) and these
     checks:
     - Merge main into the branch. In `viewer/ship-spec.js`, both box changes
       must survive (test_flight's AH-64 pods case and AH-6 stick case).
     - In `world-vehicle-tick.js`, the condition becomes `(engineLaw ||
       landDrive || shipDrive) && activeRoot`. In the ledger, PHY-24 is
       ground-handling's and PHY-25..27 are fixed-wing's.
     - Fly the DC AV-8B on a live and a re-extracted glb: take-off, hover,
       transition, and the sign of every input.
     - Check the UH-60 and AH-64 still fly; a human's held W and its release
       in a Spitfire; and the sim's air scenarios, `deckAir` included.
     - Read PHY-25 or the throttle spring-back in lnxded.
   - Land it the usual way. Merge `--no-ff` in a landing worktree, run the full
     suite, fast-forward local main (check the main checkout's dirty files
     first), then push.
2. **Finish bot-gunners.** Branch `dc-parity/bot-gunners-wip` (local
   `worktree-agent-ab6c80a912c4768e8`). It is one WIP commit, 5d2b2233,
   stopped mid-investigation, unreviewed and never suite-run: bots bail from
   fixed guns and freeze in `Change` (`bot-decision.js`, `bot-mount.js`,
   `bot-referee.js`, `bot-vehicle.js`, `bot.js`, `strategic-ai.js`).
   - Restart one agent on it with [sweep/FIX_BRIEF.md](sweep/FIX_BRIEF.md).
     It merges main first, since bots, rooms and round-gaps have landed since.
   - The bots package's report, [sweep/reports/review-bots.md](sweep/reports/review-bots.md),
     has the background.
3. **Run the one asset pass** under "Assets" in [Open](#open). Until it runs,
   the live trees carry none of the exporter-side fixes. The local DC tree's
   helicopters and Harriers are a stopgap: glbs from the old exporter
   (b85016b5). The pass replaces them; the old helicopter test failures are
   fixed by vehicle-part-collision.
   - `~/.cache/dc-sweep/rex/` holds new DC/DC Final helicopter glbs (1.7 GB).
     They were extracted before fixed-wing's exporter change, so re-extract
     rather than reuse them.
4. **Real play.** A person at the client works through
   [Needs real play](#needs-real-play) on the lab server (skill
   `bf1942-server-lab`).
5. **The next sweep round** takes its items from "Gaps found and not built"
   below.

How the round was run, so it can be run again:

- [sweep/](sweep/) holds the agents' briefs (census, fix, review,
  adversarial), the agent registry (`AGENTS.md`), the census scorecard and
  every agent's final report under `sweep/reports/`.
- Agents claim ledger IDs in `sweep/LEDGER_IDS.md` before writing a row;
  parallel agents collided on IDs before it existed.
- `sweep/install-models.py` installs re-extracted glbs in place and merges
  `models.json` rows, keeping `thumb`.
- `sweep/extract_report.py <agent.output> <out.md>` pulls an agent's final
  report out of its transcript.
- The live copy of these files was `~/.cache/dc-sweep/`. That directory also
  holds the agents' scratch (sims, probes, decompiles), which is not copied
  here.

## How the round ran

1. **Census** (2026-10-06): five read-only agents sized DC 0.7 in the browser
   game by domain, from DC's own `.con` data, the extracted trees, the viewer
   code and the node harnesses. Score per item: Works 1.0, Partial 0.5,
   Broken 0.2, Missing 0; weight High 3, Med 2, Low 1.
2. **Adversarial sweeps**: one agent asked whether the mod pipeline follows the
   conventions vanilla set (tree freshness, fallbacks, mod path), one swept
   every con word DC uses against what the exporter parses and the viewer reads.
3. **Fix packages**, one agent each in its own worktree, each followed by an
   adversarial reviewer who re-derived the engine claims in the binary, ran the
   suite on a merge with main and tried to break the change.
4. **Real-game ground truth**: DC on the lab server with the server-side
   recorder and bots, including `aiSettings.lodEnable 0`, which puts every bot
   on physics. [lab-ground-truth.md](lab-ground-truth.md) holds the numbers;
   `tools/bf1942-models/lab/dc_truth.py` reads them out of a recording.

## Census scores (before the fix round)

| Domain | Score |
|---|---|
| Aircraft | 62% |
| Ground and sea vehicles | 78% |
| Weapons, projectiles, kits, damage | 79% |
| Levels, modes, world, bots | 79% |
| Soldiers, HUD, menus, sound | 85% |
| **Overall** | **78%** |

The adversarial sweeps then overturned five census verdicts (upside-down damage,
TTL bursts, DC's turn spread, the Forklift, magType) and found 13 con-word gaps
and 10 convention gaps the census had missed.

## What landed

| Package | What it fixed | Engine rows |
|---|---|---|
| air-flight | The Harrier and DC Final helicopters spun on their RollGrip wheels when crewed (a dot product taken after its operand was overwritten); vectored airframes had a gyroscopic term and the inertia axes in the wrong order; critical damage stops helicopter engines | COL-13, COL-14, PHY-14 |
| air-input, air-input-2 | The mouse flies the aircraft; keys reach full deflection in a tick; a seat's own category picks its profile; slots take the larger input; cockpit look limits; analogue rudder on the wire; a camera looks by sign(acceleration) x sign(maxSpeed) | MLK-7..18 |
| ai-scripts | `/ai/` scripts were dropped from the object library, so bots lost weapon AI and cover values (vanilla had been live with 6 of 24 weapon AIs since 10-03) | LOAD-5, LOAD-8 |
| kit-pickups | DC's M82 Barrett and AA kits (placed only by pads) get rows, pickup meshes and first-person rigs; the lost mortar/pad record rewritten | SPAWN-9..16 |
| terrain-grid | Terrain patches are sized from the heightmap; Medina Ridge's ground was the top-left quadrant stretched | TERR-1..4 |
| hand-weapons | Shotgun barrels fire along their own turns; hand-MG heat and the heat law; DC's turn spread; the Stinger sight | DEV-9, DEV-10, XHIT-16, GUN-13..16, SCOPE-6 |
| ground-chassis | Wheeled vehicles drive on their own mass, drag, header-box inertia and wheels (they were all the Willys); land hulls sit on the sea bed and take crush damage; upside-down damage runs; the Forklift steers the right way | COL-15, PHY-16, HP-18 |
| rounds | Rockets fall (IMP-7); rocket motors fly their own data, matched to recorded MLRS, AIM-9 and AA-10 flights within 1%; bullets and tracers follow their gravity; the square deviation cone; bursts at end of life only with `hasOnTimeEffect`; the CBU-87 emitter | PHY-18..22, FA-3, SM-14, PROX-7 |
| sounds | Release tails, reload foley, vehicle gun edges, turret/track/gear/flap part sounds | SND-17..23 |
| dof-effects | 18 DC vehicle guns fire from the seat camera (`fireInCameraDof` exported); level-declared effects and spawned ruins; death tiers play once at their offsets | EMT-10, ARM-11 |
| con-reader | The console's `set`-prefix spellings (23 DC parts had no mesh: the AH-64's chin gun and pods, the Mi-24's turret, the Harrier's nozzles); `GeometryTemplate.scale`; camera look exports | CON-15, CON-16, SM-13 |
| engine-reads | `blastAmmoCount` is a bool salvo flag; stabilization does nothing; a static collides only where it or its borrowed mesh says `hasCollisionPhysics 1` | BOMB-13, CON-17, GUN-17, COL-16..18 |
| spawner-pads | A pad spawns its holder's vehicle; abandoned hulls time out; respawn delays by the engine's formula; dead carriers drop their spawns (Weapon Bunkers, Bragg's Talil) | SPAWN-17..20, SPAWNGRP-10 |
| data-words | `hasMobilePhysics 0` keeps roots static (Nimitz carriers, No Fly Zone buildings); depots repair by vehicle type, every soldier and hull each cycle; per-placement paints; beached hulls stop spinning | PHY-17, SUP-18..20, FA-4 |
| round-rules | CTF in the page and in rooms; the round's end, debriefing, medals, music and restart | CTF-1..10, ROUND-1..9 |
| soldier-blast | Blasts throw soldiers (matched to 114 recorded throws); the soldier template's force and repair numbers from data | KNOCK-4..9 |
| hand-weapons-2 | The refused-pull lockout, fire camera shakes, grenade charge, kit heat, multi-barrel charge | GUN-18, GUN-19 |
| spawned-objects | Spawned rafts and ruins get bodies, collision and damage; per-Armor wreck clocks (`after-death.js`); level bundle sounds | HP-19, HP-20 |
| bots | Each hull's own AI template; the engine's walk to and into vehicles; door-less artillery seats; `exitVelocity`; the 0.8/0.5 heat hold; deviation points | AI-137..145 |
| terrain-contact | The steep-face launch; sea floor under undrawn patches; rooms drive land hulls; a landed helicopter's nose settles | COL (see viewer-ground-hull-collision) |
| ground-handling | Tank yaw damping and inertia match the lab's turn-rate table; dummy rollers skipped; box drag on land hulls; hidden wheels are physical (KettenKrad, R75, HD_XA42, LVT4, PT boats); critical damage stops ground and ship engines | PHY-4, PHY-24 |
| rooms | The room server runs the pads, prices every landing the shooter reports (a departure: retail's server flies rounds), throws soldiers, replicates object damage, relays reloads, ends and restarts its round | ROUND-11 |
| vehicle-deviation | Vehicle, stationary and aircraft gunner guns fire in their own deviation cone | DEV-11..13 |
| vehicle-part-collision | A hull's box is its own geometry, never a child part's mesh: the AH-64 was its rocket pods | COL-14, COL-19 |
| round-gaps | ObjectiveMode rounds end; a side with no spawns bleeds out; the end game clears the field; spawnDelayAtStart and disableWhenLosingControl; carriers' spawn points ride them; two pads on one spot | OBJ-1..6, TKT-5, TKT-8, SPAWN-21, SPAWN-22, ROUND-10 |

Every package's build record is in its own feature folder; the ledger rows
cite them.

## Checked against the real game

From [lab-ground-truth.md](lab-ground-truth.md):

- Helicopters keep their rotation hands-off in retail too; the viewer holding a
  rate is right.
- Tank top speeds and full-lock turns match retail for every input bots give
  (the replay of recorded servo and wheel traces matches within 10%).
- Pads: a capture spawns the taker's hull at once; respawns follow
  `calcSpawnDelay`; the abandon drain starts at about 45 s and runs 10 HP/s;
  a flag that starts neutral leaves its pads on.
- Rocket speed profiles (MLRS, AIM-9, AA-10, TOW, AT-5, Spandrel) and gravity
  per projectile.
- The MG heat law against 50,577 recorded rounds; thrown-soldier speeds against
  114 recorded throws.

## Needs real play

These cannot be settled from bots or the binary; each needs a person at the
client on the lab server (skill `bf1942-server-lab`):

- A human drive: DPV at 12-15 m/s with full throttle and full lock for 4 s,
  three times each way; the BRDM-2 at 15-18 m/s; the DPV from a standstill;
  T-72 and M1A1 20 s full throttle on the level.
- The Harrier's hover attitude and transition (bots fly it as a plane).
- A land vehicle driven into deep water.
- Whether a static vehicle wreck (`Mi24DWreck` on Bragg) stops rounds and
  soldiers.
- Whether one browser pixel is one mouse count.
- A tank's full lock from speed with W held (the viewer peaks at 85-118 deg/s
  for about a second, then downshifts).
- A running engine on a slope at zero throttle (the viewer's Willy creeps
  1.4 m/s down 5.7 degrees).

## Open

Not landed:

- **fixed-wing** (`worktree-agent-af900aeea9f96ae0a`, 14 commits, built and
  suite-run by its implementer; the adversarial review was stopped before it
  finished). This is the throttle as the engine's held axis with reverse and
  gearbox, the rotation law and header box, one step per engine tick, lift
  regulators on their own servo, landing gear from `LandingGear::handleUpdate`
  (PHY-25..27, SND-24). Merging it needs care in `viewer/ship-spec.js`: keep
  both its selector-class box search and vehicle-part-collision's no-child-mesh
  walk (test_flight covers both). Also `world-vehicle-tick.js`: the condition
  becomes `(engineLaw || landDrive || shipDrive) && activeRoot`. After a
  re-extract the AC-130 tops out at 33.9 m/s against retail's 42.8 (its
  regulators sit at their -30 degree stop); before the branch it could not fly.
- **bot-gunners** (`worktree-agent-ab6c80a912c4768e8`, one WIP commit
  5d2b2233, unreviewed and not suite-run): bots bailing from fixed guns, bots
  frozen in `Change`.

Assets (the next run, in one pass, after fixed-wing lands):

1. DC and DC Final models re-extract (`extract_all.py --level-all
   --configuration-all --cockpit -j 6 --mod M --own` into a scratch `--out`;
   install in place with `~/.cache/dc-sweep/install-models.py`, which keeps
   `models.json`'s thumbs).
2. DC and DC Final full level re-bake, then `collision-meshes.json`,
   `vehicle-ai.json` and the effects for every tree.
3. Vanilla, XPack1 and XPack2: the subsets ground-handling (KettenKrad,
   Elco80, Type38 incl. `--level Truk`; R75, HD_XA42, LVT4), round-gaps
   (Battle of Britain and XPack2's six objective levels, full scene) and
   fixed-wing (every model with a LOD selector, gear or regulator) need.
4. `patch_scene.py --layer game` and `--layer spawns --all` in every tree
   (round-gaps' objectives and `changeTeam`).
5. `optimise_mesh.py`, thumbs for changed models, `build_mods_manifest.py`,
   then `scripts/publish-mesh-delta.py` (stage with `textures/` hard-linked).

Gaps found and not built:

- Ships: the LCVP's speed and turn against retail (13.1 m/s, 20.8 deg/s); a
  craft that hits a carrier's side rolls past the bots' bail angle (2 of 12
  runner landings); a crewed critical ship never starts to sink.
- Rooms: the server flies no rounds (a rifle round never hits another player
  in a room); no remote gunfire sound; seat-gun reloads not relayed; CTF and
  TDM rooms never end; SPAWN-22 does not reach a room's pads (the room's
  capture law never writes `spawnsEnabled`).
- Fixed-wing (once landed): the AC-130's regulators; ground-roll revs; the
  idle tail slide; dive-angle sound; the DC F-14A has no physics.
- Bots: pilots' own guns fly straight (no draw index fits the recordings); the
  AI term's extra against air targets is never passed; bots never firing
  Hydra, Hellfire or AT-2 in retail is unread.
- Hand weapons: under DEV-12 a hand round still carries its own pull's bloom.
- ObjectiveMode: no objectives HUD; no `Factory_Objective` wreck glb; the
  defender's share reads 0 with a time limit; Medina Ridge's rock dropper.
- Artillery spotting (SPOT-1..16); missiles a player flies (SA-3, Tomahawk);
  stationary guns as static roots; dividing `geometryScale` out of physics;
  projectile flight sounds.
- Load settle against statics (replace `standsOverTheSea`); COL-17 for
  vehicles; the grip test by flag bits, not name (FHSW's
  `c_PGFEngineDUmmyGrip`); a mesh-carrying Bundle listed before the cockpit LOD
  still takes the box (FHSW `Zuiho_1944`); FHSW's pad scan memory (36 GB).
