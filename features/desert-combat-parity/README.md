# Desert Combat parity

Status (2026-10-07): the first sweep and its fix round have landed; assets are
being re-extracted. This page is the tracker for the round: what the census
found, what each package changed, how it was checked, and what is still open.

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

## Open

In flight (2026-10-07):

- **bots**: bots frozen in `Change`, DC route failures, door-less artillery
  seats, AI records for every DC aircraft, the 0.8/0.5 heat break, the bot
  cone, `exitVelocity`, static-root seats.
- **ground-handling**: XPack2's bikes on reverse, the KettenKrad, critical
  damage stopping ground engines, the Krupp's drag.
- **terrain-contact**: the steep-face launch (any land vehicle into a 45 degree
  face is thrown at hundreds of m/s), a sea floor under undrawn terrain
  patches, the sea bed in rooms, a landed helicopter's rising nose.
- **hand-weapons-2**: the refused-pull lockout, fire camera shakes, grenade
  charge, kit heat, the projectile's first sweep, multi-barrel charge.
- **spawned-objects**: bodies for spawned rafts and ruins, their removal,
  `timeToLiveAfterDeath` on statics, level bundle sounds.

Queued:

- The fixed-wing engine law: the throttle as retail's held axis with reverse,
  the rotation law and header box for fixed wings, the AC-130's speed, landing
  gear from data.
- Vehicle guns fire with no deviation cone at all.
- Rooms: pads and respawn, blast splash and throws, object damage and reloads
  on the wire, CTF layers.
- ObjectiveMode's objectives, so those rounds end.
- Artillery spotting (SPOT-1..16); missiles a player flies (SA-3, Tomahawk).
- Stationary guns as static roots; dividing `geometryScale` back out of
  physics measurements; projectile flight sounds; bots never firing Hydra,
  Hellfire or AT-2 in retail (unread why); DC's scripted objectives (Medina
  Ridge's push).

Assets: the DC and DC Final model re-extract and full level re-bake carry
every exporter change above; until they are published, the live trees show
the old data for the exporter-side fixes.
