# Desert Combat ground truth from the lab server

The DC fix round ported Desert Combat 0.7 from its data and the decompiled
engine. This page is the other half: the real game, recorded. Bots-only DC
co-op rounds on the lab server (`tools/bf1942-models/lab`), each written whole
by the server recorder (`features/server-replay-recorder`), read back by
`tools/bf1942-models/lab/dc_truth.py` into per-template numbers. The numbers
are in [`lab-ground-truth.json`](lab-ground-truth.json) beside this page (the
ten DC runs from El Alamein to the Day 2 LOD 0 round; the Gazala LOD 0 and
Basrah's Edge runs are counted in the text only), and
the two vanilla LOD 0 rounds' in
[`lab-ground-truth-vanilla.json`](lab-ground-truth-vanilla.json).

## The census questions, by verdict

| census item or question | retail | verdict for the viewer |
|---|---|---|
| air Q1: does anything damp a helicopter's rotation? | no: a UH-60's roll and yaw rates hold to a few percent for up to 20 s with the racks square | the viewer holding a rate is right |
| air item 6: jet speeds | DC jets cruise 66-89 m/s (median), level 76-116, reach 95-165 | AI maxSpeed 60 does not cap them |
| air item 10: AC-130 | 27 m/s lift-off, 35-45 m/s level, holds height | contradicts 12.9 and 21 m/s |
| air item 25: bots never board A10_B/A10_C | they board the A-10C (6 of 9 lives) | viewer gap confirmed |
| air item 26: Harrier bots | flown as a plane: 4.5 s roll to 47 m/s, no hover; still on the pad | hover unmeasured |
| ground Q1: DPV spin-out at full lock | none at 10-15 m/s (slip 6-9 degrees) | contradicts the viewer's 190 degrees in 2.25 s; 15-30 m/s unmeasured |
| ground: tank top speed | M1A1 14.1, T-72 11.3, BMP-2 14.9, M2A3 14.8 m/s, flat whatever the slope | the T-72 is 24% too fast at 14.9 |
| ground Q4: door-less artillery driver seats | bots drive the MLRS from its gun seat by a seat switch; never the M-109, M-1974, BM-21 | partly confirmed |
| ground Q5: ship and boat top speeds | bots took no boat or ship | unmeasured |
| ground root cause 2: land hulls in water | could not be made to happen (see below) | unmeasured |
| ground: upside-down damage | 5 hp a second, in whole seconds | |
| weapons item 19: 25 mm gravity 0.2 | 2.94 m/s^2 = 0.2 x 14.73 | the viewer flies it flat: wrong |
| weapons item 22: MLRS rockets arc | yes, under 14.7+ m/s^2 | the viewer's gravity 0: wrong |
| weapons item 24: CBU-87 | submunitions fall at 14.45 | the viewer flies them level: wrong |
| weapons Q1: rocket motor law | MLRS: +20 m/s over 3 s; TOW and AT-5 constant 100 m/s, no gravity; no other rocket fired | the fixed 25 m/s^2 matches none |
| weapons Q1, helicopter and shoulder rockets | bots fired no Hydra, Hellfire, S-5, AT-2, Stinger or SA-7 in 3.7 h of helicopter flight (0.8 h of it at LOD 0); the BM-21 only fake; DC's Mi-24 S-5 rack names a missing AI template (`Mi25DS5`) | unmeasured |
| DEV-9: rifle spread square or disc | no per-shot draw reaches a still bot's rounds (0.03-0.05 degrees rms); a shotgun's pellets lean square, not decisively | unsettled |
| weapons Q4: FireArms velocity default | the Spandrel (no `velocity`) leaves at 200.5 m/s relative to its launcher (12 flights): FA-3's 200 default | not the viewer's 100 |
| levels item 23: respawn delay | `calcSpawnDelay` with the bots counted, drawn at the last spawn, from the death | the viewer draws it uniformly from the wreck's removal |
| levels item 24: pads change sides | the capturer's template, in the same tick, on every empty pad | viewer gap confirmed |
| levels item 25: abandoned vehicles | hit points drain at 10/s from 46-56 s after the last crewman left | viewer gap confirmed |
| wrecks | `timeToLiveAfterDeath`: 60 s for DC's tanks, IFVs and BRDM-2s, 10 s otherwise | the viewer's fixed 10 s is wrong for those |
| levels item 22: Weapon Bunkers spawns | no co-op layer, so no bot round | unmeasured |
| COL-16..18: a static wreck without `hasCollisionPhysics` passable? | no co-op level places one; Basrah's Edge's wrecks write it and nothing reached them | unmeasured |

## What the real game says

Census reports are in `~/.cache/dc-sweep/reports/`; the ledger rows cited are
in `features/bf1942-engine-reference/ledger.md`. Every number is from the runs
in "Runs" below unless it says otherwise.

### Read this first: bots far from a human are not simulated in full

A bots-only round has no human, so every bot is at AI LOD 2 (all 30 from
20 s on, the recorder's `lod` records; ledger AI-136). Two consequences
decide what a bots-only round can settle:

- **The AI moves a land hull at LOD 2, the physics does not.** Over half of a
  bot Humvee's samples above 10 m/s run on an exact line of constant x or z
  (5 mm over 0.1 s; 9,420 of 14,567), against none of an A-10C's, Su-25's or
  Mi-24's; a DPV slews its heading 108 degrees while its position runs
  straight up the z axis. And every land hull holds **0.596-0.599 of its
  `aiTemplate` maxSpeed** on the level, held for 3 s: Humvee, BRDM-2 and
  Technical 14.98 of 25, M2A3 11.98 of 20, BMP-2 10.15 of 17, M1A1 8.99 of 15,
  T-72 7.19 of 12, MLRS 7.15 of 12, Shilka 9.55 of 16, M163 10.19 of 17, the
  DPV 38.75 of 65. Vanilla's bots-only rounds do the same (Willy 14.98 of 25,
  Kubelwagen 11.99 of 20, Sherman and Panzer IV 9.59 of 16, Tiger 5.99 of 10,
  M10, Priest and Wespe 7.19 of 12). AI-45's tank law ("20 m/s ... capped at
  maxSpeed") does not give these; it is the LOD 2 mover's speed. So the land
  hulls' speeds, turn rates and slip angles in a bots-only round are the AI's
  mover, kept apart by `dc_truth.py` as `ground_lod2`, and **not** the
  vehicles' physics. For the physics a human has to be near: in the two
  vanilla El Alamein rounds the owner played (`parity-elalamein-rec`), hulls
  driven by him or by bots near him (LOD 0) give a Sherman 14.57 m/s held
  (52.5 km/h; the ground census's closed form is 53.6 km/h), a Panzer IV
  13.56, an M10 10.32 and a Willys 26.7 at most.
- **Aircraft are flown by the physics at LOD 2** (no locked lines; rates that
  follow the engine racks; lift-off at speed), so the air numbers below are
  ground truth.
- **Fake fire** (AI-134): see "How it was recorded". Only aircraft weapons,
  anti-aircraft fire, artillery and a few others make real rounds in a
  bots-only round.

**The way round it: `aiSettings.lodEnable 0`.** `game.rfa`'s
`Bf1942/Game/AIdefault.con` runs `aiSettings.createLODManager 200 2` and
`aiSettings.lodEnable 1`. `AILODManager::updateBots` (0x08475f00) tests the
manager's flag at +0x28, which only `lodEnable(bool)` (0x08476290) writes;
with it clear it skips `updateBot`'s distance test (0x08475fe0) and calls each
bot's `setLodLevel(0)` in turn, one a tick. Put in a scenario's autoexec
(`*-lod0-rec`), it holds for the round: every bot's recorded LOD stays 0, no
shot is fake (219 shots, 165 flights in the first minutes), land hulls leave
the AI mover's straight lines (1-5% of samples, from over half) and its 0.6
of maxSpeed, the engine servo carries the throttle (-1 to 1) and a car's front
wheels record the steering. That is a bots-only round driven by the physics,
and the ground and rounds tables below come from it. What it cannot give: a
bot's drive law asks for at most 20 m/s (AI-45), so a car whose physics can
go faster cruises at 18-19 m/s and its top speed stays unmeasured; and bots
full-lock only below 15-20 m/s.

### Ground hulls driven by the physics (bots at LOD 0)

DC El Alamein, `20261007-003106-dc-el_alamein-coop-lod0-rec` (549 s, 30 bots
at LOD 0). Speeds on the level at full throttle are samples with the engine
servo at 0.95 or more, |pitch| under 2 degrees and |vertical speed| under 1
m/s, on the ground:

| hull | level, full throttle: p95 / p99 / max (m/s) | samples | km/h | t to 5 / 10 m/s (s) |
|---|---|---|---|---|
| M1A1 | 13.56 / 14.10 / 14.15 | 1,853 | 50.8 | 2.4 / 2.9 |
| T-72 | 11.19 / 11.24 / 11.29 | 7,107 | 40.5 | 2.1 / 2.6 |
| BMP-2 | 14.63 / 14.88 / 14.88 | 3,857 | 53.6 | 1.7 / 2.8 |
| M2A3 | 14.79 / 14.84 / 14.86 | 2,557 | 53.4 | 1.3 / 2.3 |
| Shilka | 11.97 / 12.82 / 13.09 | 2,607 | 46 | 2.8 / 4.6 |
| Humvee, DPV, Humvee_TOW, Technical, BRDM-2 | 17.2-18.9 / 18.0-19.1 / 18.4-19.2 | 738-4,028 | | held by the bot law at 20 m/s |

- **Slope barely matters to a tank at full throttle.** By pitch bin (the
  slope along its track) the T-72's p95 is 11.06 at -8 to -4 degrees, 11.22
  at -1 to 0, 11.14 at 0 to 1, 10.99 at +2 to +4 and 11.12 at +4 to +8; the
  M1A1's 14.14 downhill (-8 to -4), 14.08 at -1 to 0, 13.72 at 0 to 1, then
  11.1-11.8 above +1. A tank tops out at a speed, uphill or down; it is not
  pulled faster downhill. So the viewer's closed form (53.6 km/h, 14.9 m/s,
  for both) matches the BMP-2 and M2A3 and is close for the M1A1 (14.1-14.2),
  and **the T-72 is 24% slower in retail: 11.3 m/s.** DC gives the T-72 and
  the M1A1 the same engine (`setTorque 10`, `setDifferential 4`, 5 gears,
  `setMaxSpeed 4/0/20`), mass (25,000) and drag (2); their running gear
  differs (the T-72 has two more dummy wheel springs a side), which is
  where to look.
- **Full lock** (the steered wheels within 90% of the most they turned).
  Yaw rate p50 / max (deg/s) and slip angle at the hull's origin p50 / p95
  (degrees), by forward speed:

  | hull | max steer | 2-5 m/s | 5-10 | 10-15 | 15-20 |
  |---|---|---|---|---|---|
  | DPV | 50 | 27.5/56.9, 17.9/23.0 (775) | 41.6/59.0, 9.1/13.3 (87) | 36.6/51.2, 6.4/8.9 (27) | |
  | Humvee | 50 | 23.9/46.5, 28.7/44.7 (1,099) | 22.5/42.4, 12.4/25.3 (731) | 20.9/28.9, 8.2/11.3 (184) | 14.9/16.1, 4.9/5.1 (2) |
  | Humvee_TOW | 35 | 16.1/48.2, 24.5/32.4 (1,186) | 26.6/50.7, 15.2/27.1 (418) | 21.8/34.4, 8.1/11.2 (160) | 17.5/22.1, 5.4/7.2 (39) |
  | Technical | 50 | 27.2/48.8, 21.3/25.7 (555) | 30.7/49.7, 9.5/18.6 (178) | 33.0/44.1, 7.5/10.7 (78) | |
  | BRDM-2 | 30 | 18.4/42.1, 18.3/22.2 (2,019) | 28.3/74.3, 11.9/19.2 (862) | 19.8/42.2, 5.9/9.5 (165) | 8.8/17.0, 2.7/4.5 (18) |

  (samples in brackets; three LOD 0 rounds: two DC El Alamein, one
  Guadalcanal.) The slip at 2-5 m/s is mostly where the origin sits on the
  hull: a car pivots about its rear axle, and the DPV's origin is 0.94 m
  ahead of it. **The DPV does not spin out at full lock at 10-15 m/s** (slip
  6.4 degrees, p95 8.9, 27 samples; the census's viewer spins it 190 degrees
  in 2.25 s at 15 m/s). No bot full-locked it faster than 15 m/s, so 15-30 m/s
  is unmeasured; at LOD 2 the spins seen at 30-40 m/s were the AI mover
  slewing the heading.
- **Upside down costs 5 hit points a second, in whole seconds.** An unmanned
  Humvee_TOW on its roof for 2.8 s went 100, 95, 90, 85, 80 at 109.0, 110.0,
  111.0, 112.0 s, then righted and kept the rest.
- **No launches at LOD 0.** No land hull went over 25 m/s or 8 m/s upward on
  the ground in the LOD 0 round. The one land hull seen far above the ground
  was at LOD 2: a T-72 driven by the AI mover went from 90.4 m to 401.5 m in
  one tick (El Alamein, 261.72 s), then came down at a steady 121 m/s (no
  acceleration) without a scratch: the mover, not the physics.

### Vanilla ground hulls at LOD 0

The same measures on vanilla, for the hulls the viewer's ground model was
built on: El Alamein (`20261007-012156-elalamein-coop-lod0-rec`, one round,
990 s) and Kursk (`20261007-013855-kursk-coop-lod0-rec`, one round, 779 s), 30 bots at LOD 0, `--mod bf1942`.

| hull | level, full throttle: p95 / p99 / max (m/s) | samples | km/h (p99) | t to 5 / 10 m/s (s) |
|---|---|---|---|---|
| Sherman | 13.50 / 14.21 / 14.63 | 10,323 | 51.2 | 2.8 / 4.1 |
| Panzer IV | 14.03 / 14.59 / 14.72 | 15,517 | 52.5 | 2.1 / 5.4 |
| Tiger | 9.07 / 9.11 / 9.19 | 1,033 | 32.8 | 2.0 / |
| Priest | 10.99 / 11.03 / 11.24 | 3,291 | 39.7 | 1.2 / |
| T-34 (Kursk) | 7.53 / 10.00 / 10.90 | 3,234 | 36.0 | |
| T-34-85 (Kursk) | 7.84 / 9.33 / 11.11 | 4,574 | 33.6 | 2.3 / |
| Panzer IV on Kursk | 10.05 / 11.71 / 13.01 | 7,025 | 42.2 | |
| Tiger on Kursk | 9.08 / 9.15 / 9.20 | 2,031 | 32.9 | |
| M3A1 (Kursk) | 8.29 / 10.91 / 11.10 | 1,118 | 39.3 | 3.6 / |
| Katyusha (Kursk) | 11.10 / 11.71 / 12.07 | 1,269 | 42.2 | 1.8 / 4.3 |
| Willy, Kubelwagen | 17.66 / 18.36 / 18.73, 16.12 / 17.44 / 18.90 | 4,516, 9,594 | | held by the bot law at 20 m/s |

- **Kursk holds a tank back, or its runs are too short.** The same Panzer IV
  tops out at 13.0 m/s on Kursk against 14.7 on El Alamein, in every pitch
  bin; the Tiger reaches its 9.2 on both. So the T-34's 10.9 and the
  T-34-85's 11.1 are lower bounds, not top speeds; a T-34 on El Alamein (or
  a flat co-op level that places one) would settle it. The Hanomag never
  went over 4.5 m/s in 176 s driven (not looked into).
- The Sherman's p99 and max (14.21, 14.63) agree with the 14.57 m/s held
  that the owner's own El Alamein rounds gave. The census's closed form,
  53.6 km/h (14.9 m/s), is 2-5% above it.
- **Slope does not move a tank's top speed.** By pitch bin from -8 to +8
  degrees the maxima stay at the cap: Panzer IV 14.27-14.72, Tiger
  9.16-9.44, Priest 11.03-11.24, Sherman 13.32-14.63 (its two lowest on the
  steepest bins, downhill and up). Only the p95
  falls on the steeper bins (the Sherman 10.6-10.8 at -8 to -4 and +4 to +8,
  12.6-13.9 between -2 and +4): fewer full-speed runs there, not a lower cap.
- **Tanks turn fastest near a standstill.** A tank records no steering, so
  this is the envelope: yaw rate p95, and the most held for 1 s, by forward
  speed (deg/s), ground contact, LOD 0:

  | hull | reversing | -1 to 1 m/s | 1-3 | 3-6 | 6-9 | 9-12 | 12-16 |
  |---|---|---|---|---|---|---|---|
  | Sherman | 5.1 | 40.6, held 43.3 | 48.8, 59.7 | 19.4, 26.5 | 14.4, 32.6 | 11.2, 8.3 | 5.8, 2.5 |
  | Panzer IV | 29.3 | 46.5, 53.6 | 43.8, 56.1 | 23.2, 29.2 | 12.5, 17.8 | 12.9, 11.4 | 6.1, 2.2 |
  | Tiger | | 31.3 | 59.2, 53.9 | 25.6, 8.7 | 13.8, 5.7 | 3.0 | |
  | Priest | 8.9 | 37.1, 47.1 | 45.8, 45.6 | 26.0, 13.5 | 15.5, 16.2 | 7.6, 5.7 | |
  | T-34 (Kursk) | | 35.0, 35.1 | 41.5, 47.3 | 23.0, 18.9 | 17.5, 6.9 | 16.8, 0.4 | |
  | T-34-85 (Kursk) | | 37.0, 38.8 | 39.1, 40.0 | 22.6, 19.8 | 19.0, 5.1 | 12.5, 1.3 | |
  | DC T-72 | 36.6 | 55.7, 73.0 | 59.6, 68.5 | 38.8, 21.6 | 26.5, 24.7 | 18.9, 28.2 | |
  | DC M1A1 | 13.1 | 52.5, 65.6 | 52.7, 50.5 | 46.8, 15.7 | 30.3, 30.0 | 20.0, 21.0 | 6.2, 3.0 |
  | DC BMP-2 | 38.8 | 61.5, 66.4 | 61.9, 79.9 | 51.5, 26.2 | 29.2, 24.2 | 19.7, 17.1 | 11.0, 6.2 |

  (`~/.cache/dc-sweep/dc-lab/probe_tankturn.py`.) A vanilla tank pivots at
  40-60 degrees a second and turns at 8-33 a second at 6-12 m/s; DC's
  armour pivots a little faster (52-62) and turns about twice as fast at
  6-12 m/s (p95 19-30 against vanilla's 11-15).
- **Cars at full lock** (`max steer` is the most the front wheels turned):
  yaw rate p50 / max (deg/s), slip p50 / p95 (degrees), samples:

  | car | max steer | 2-5 m/s | 5-10 | 10-15 | 15-20 |
  |---|---|---|---|---|---|
  | Willy | 30 | 23.2/52.3, 21.7/27.5 (666) | 35.5/72.9, 13.0/31.3 (314) | 29.8/42.6, 7.9/10.4 (109) | 20.6/22.0, 5.0/5.3 (4) |
  | Kubelwagen | 30 | 24.0/75.2, 18.8/27.6 (3,104) | 35.2/74.1, 11.6/26.7 (1,313) | 30.2/44.7, 7.0/9.7 (121) | 17.7/28.9, 3.2/5.1 (13) |

  (Both rounds.)
  Bots did not full-lock a car above 20 m/s, and their drive law holds a car
  at 18-19 m/s, so the Willys' top speed (the owner's rounds: 26.7 m/s at
  most) and its turn above 20 m/s stay unmeasured here.

### Helicopters do not damp their rotation (air census open question 1)

With every engine rack square (the cyclic centred: each rack's recorded
rotation within 2 degrees of identity; a rack at rest reads (+-0.0017, 0, 0,
1) against its hull), a helicopter's turn rate holds. Aircraft are flown by
the physics at AI LOD 2, so these are the engine's laws.

| hull | hands-off stretches, s | axis | rate at 0 s | 0.5 s | 1 s | 1.5 s | 2 s | stretch |
|---|---|---|---|---|---|---|---|---|
| UH-60 | 39, 485 | roll | -24.3 | -24.5 | -23.9 | -24.2 | -24.1 | 6.1 s |
| UH-60 | | roll | -19.7 | -20.0 | -19.5 | -19.6 | -19.9 | 8.0 s |
| UH-60 | | yaw | 21.2 | 21.4 | 21.4 | 21.1 | 21.2 | 8.0 s |
| UH-60 | | yaw | -12.1 | -12.2 | -11.8 | -12.3 | -12.3 | 19.6 s |
| UH-60 | | pitch | 8.7 | 8.9 | 8.6 | 8.9 | 8.9 | 19.6 s |
| AH-64 | 10, 177 | yaw | -14.3 | -13.2 | -12.1 | -12.1 | -10.7 | 37.0 s |
| Mi-24 | 24, 111 | pitch | 17.7 | 18.0 | 17.9 | 17.6 | 16.6 | 2.4 s |
| Mi-24 | | pitch | 6.2 | 5.6 | 4.3 | 3.0 | 2.2 | 9.0 s |
| Mi-8 | 48, 308 | yaw | 40.3 | 14.9 | 5.4 | -3.1 | -13.8 | 2.5 s |
| Mi-8 | | roll | 18.0 | 18.1 | 18.1 | 18.0 | 17.9 | 9.7 s |

(deg/s, body axes; DC El Alamein Day 2, `20261006-222848-dc-el_alamein_day2-coop-rec`,
seven rounds, and El Alamein. `dc_truth.py`'s hands-off fit and
`~/.cache/dc-sweep/dc-lab/probe_decay.py`.)

- **The UH-60, the census's case, holds roll, yaw and pitch rates to within
  a few percent for as long as the racks stay square** (up to 20 s). Fitted
  over all its hands-off samples, angular acceleration against rate has slope
  +0.04/s (pitch), +0.006/s (roll), +0.014/s (yaw): zero. AH-64 -0.05/s
  (pitch), Mi-24 -0.10/s. So the viewer's UH-60 holding 20 deg/s of roll
  after a 1 s input is retail. No damping term needs adding.
- **What does change a rate is a moment, not damping.** A Mi-24 in a
  full-collective climb (24 m/s up) pitches nose-down at a steady 1.1-1.4
  deg/s^2 whatever its rate: from 0 it builds to 15 deg/s in 7.5 s (three
  climbs alike), from 6 deg/s it falls in a straight line to 2-3 in 2 s, and
  from 17.7 it barely moves. The Mi-8's yaw falls fast at speed (40 to 5
  deg/s in 1 s, five stretches alike) while its roll holds: a tail surface
  turning it into the airflow (a Wing's lift, PHY-12..14), not a damping of
  rotation. Neither appears on the UH-60.
- A degree of rack is enough to move a few degrees a second: a Mi-24 decaying
  from 6.1 to 1.8 deg/s had its racks 0.4-1.6 degrees off square; once at
  0.0 the 1.8 deg/s held. A threshold tighter than 2 degrees finds few
  stretches.

### Fixed-wing aircraft, DC and vanilla (air census item 6)

Speeds (m/s) while airborne, "level" with climb or sink under 2 m/s and the
nose within 5 degrees, a rate "held" when it stayed at or above that for
0.5 s; bots flying at LOD 2, which the physics flies (rates follow the
controls, no locked lines).

| aircraft | air s | speed p50 / p95 / max | level p95 / held 3 s | climb p95 / max | roll rate p95 / held 0.5 s | pitch rate held 0.5 s | lift-off |
|---|---|---|---|---|---|---|---|
| A-10C | 445 | 68.3 / 79.5 / 103.3 | 78.3 / 71.3 | 21.3 / 41.5 | 62.1 / 87.4 | 54.8 | 46.0 |
| Su-25 | 1,076 | 66.9 / 77.7 / 94.7 | 75.7 / 73.6 | 21.4 / 38.6 | 68.1 / 116.4 | 49.1 | 44.3 |
| F-14B | 324 | 88.8 / 109.8 / 124.8 | 115.5 / 107.6 | 37.8 / 57.5 | 94.7 / 112.0 | 53.2 | 55.1 |
| F-15C | 198 | 78.2 / 149.7 / 164.9 | 85.9 / - | 32.3 / 40.9 | 85.6 / 135.3 | 71.1 | 46.7 |
| MiG-29 | 267 | 79.8 / 98.0 / 107.3 | 96.0 / - | 30.1 / 41.8 | 87.7 / 114.9 | 70.1 | 46.0 |
| AV-8B (as a plane) | 132 | 70.6 / 101.9 / 119.3 | 83.2 / - | 28.6 / 40.2 | 29.0 / 118.2 | 43.0 | 47.4 |
| AC-130 | 142 | 35.1 / 52.4 / 53.7 | 44.8 / 36.7 | 10.7 / 11.4 | 8.0 / 18.7 | 14.7 | 27.1 |
| vanilla BF109 | 2,716 | 49.8 / 64.3 / 94.5 | 60.8 / 61.2 | 13.9 / 32.2 | 49.3 / 135.0 | 61.7 | 27.6 |
| vanilla Spitfire | 7,087 | 38.6 / 59.9 / 80.5 | 60.9 / 61.1 | 9.9 / 31.8 | 51.3 / 122.7 | 69.2 | 27.6 |
| vanilla Stuka | 957 | 42.9 / 53.8 / 62.6 | 54.7 / 52.1 | 11.6 / 20.4 | 33.6 / 69.4 | 47.2 | 30.4 |
| vanilla B-17 | 3,352 | 35.3 / 68.7 / 96.9 | 61.9 / 57.9 | 18.5 / 26.5 | 17.7 / 47.9 | 35.3 | 25.4 |
| vanilla Zero | 341 | 39.6 / 59.0 / 65.5 | 56.2 / 53.3 | 12.9 / 25.9 | 48.2 / 72.7 | 52.7 | carrier |
| vanilla Corsair | 241 | 43.6 / 62.6 / 78.8 | 57.3 / 46.9 | 12.9 / 28.2 | 40.3 / 57.2 | 59.3 | 28.6 |
| vanilla SBD | 245 | 40.5 / 59.8 / 68.5 | 53.1 / 40.6 | 12.9 / 24.1 | 35.3 / 61.6 | 44.8 | 27.2 |
| vanilla Aichi Val | 305 | 38.8 / 53.0 / 57.3 | 53.1 / 49.1 | 11.8 / 17.9 | 34.7 / 52.2 | 38.7 | carrier |

(DC: El Alamein, Bocage, Gazala; vanilla: the bots-only El Alamein soak
`20261004-180859-parity-elalamein-rec` and the `projpool` El Alamein and Wake
runs, about 4 hours of round. The Zero and the Val leave a carrier deck, so
they are airborne from the start. A human-flown BF109 in the two parity
rounds: speed p50 48.4, max 84.4, roll held 118.2.) The census's DC level top
speeds of 63-87 m/s against an AI maxSpeed of 60: in retail the jets cruise
66-89 m/s at the median and reach 95-165, so their AI maxSpeed of 60 does not
cap them.

### The Harrier: bots fly it as a plane (no hover measured)

The one bot AV-8B flight (DC Bocage, `20261006-221215-dc-bocage-coop-rec`,
215-352 s) never hovered. On the pad with the bot aboard it sat still (pitch
3.7-3.8 degrees on its gear, rates 0, for the 0.26 s before throttle; the
air census's viewer slid 12.7 m/s in that state). Then the bot put all four
engine servos to 1.0 and swung its three lift-jet racks 18-20 degrees, and
the Harrier rolled: 0 to 43 m/s in 4.5 s on the ground (about 10 m/s^2),
off at 47 m/s, and flew as a jet from there (speed p50 71 m/s, level p95 83,
max 119, climb up to 40 m/s, roll held 118 deg/s for half a second, bank p95
72). Its rotation follows its racks: lift-jet racks square, the rates sit
under 2 deg/s. Hover attitude and the transition (the lead's COL-13
question: the viewer pitches up 5.6 deg/s in a hover) need a human at the
stick; no bot round can give them. Bocage Day 2 and Day 3 spawn no Harrier
(see "What the bots use").

### The AC-130 (air census item 10)

One bot flight on DC Gazala (`20261007-002229-dc-gazala-coop-rec`, 21-172 s,
pilot and two gunners):

- Take-off: 0 to 25 m/s in about 5.3 s on the runway, off the ground at 27
  m/s, climbing 5-6 m/s at 29-30 m/s (up to 11 m/s), throttle servos at 1.0.
- Cruise: held 36.7 m/s on the level for 3 s, level-flight p95 44.8 m/s,
  speed p50 35.1, max 53.7 in dives. The bot flies the gunship orbit: a
  steady 30-33 degree bank, yaw rate 7-11 deg/s, with a long phugoid (nose
  +20 to -34 degrees, 28-53 m/s, 100-300 m over the ground). It holds its
  height on average and does not fall out of the sky.
- The viewer's engine-correct drag gives 21 m/s (the lead's figure) and the
  census found it "never leaves 12.9 m/s": retail is 35-45 m/s level, with
  `aiTemplate` maxSpeed 50.

### Spawner pads (levels census items 23-25)

- **A captured pad spawns the capturer's hull, at once** (item 24, the
  census's "Broken"). Over three El Alamein rounds (one at LOD 0) and one of
  El Alamein Day 2 at LOD 0, every
  capture of a flag whose pads were empty spawned the capturer's template on
  each of them in the same tick (0.00-0.05 s after the flag's record): East
  outpost to team 2, an MLRS and an M1A1; to team 1, a BM-21 and a T-72; South
  outpost to team 1, a T-72 and a BRDM2_Spandrel; to team 2, an M1A1 and a
  Humvee_TOW; North outpost a BRDM-2 and a BMP-2, or a Humvee and an M2A3
  (SPAWN-2's team pick, `CPEnable`); on Day 2, East to team 2 an MLRS and an
  M1A1, South to team 1 a T-72 and a BRDM-2, North to team 2 a Humvee and an
  M2A3 (0.00-0.04 s). A hull still standing on a pad when its
  flag changes hands, either side's, is left alone and the pad spawns
  nothing until it dies. A flag going neutral spawns nothing and removes
  nothing. A delay already running when the flag changes is drawn again from
  the change: the East outpost's BM-21 died in the neutral spell, the flag
  went to team 2 at 181.2 s and the MLRS came 41.3 s later, which is the
  MLRS window (40-60) at 30 of 32 players, counted from the capture
  (`ObjectSpawner::setActive` 0x083143f0, as `deployables.js` has it).
- **The respawn delay is `calcSpawnDelay` with the bots counted, drawn when
  the previous hull spawned, and it runs from that hull's destruction (hit
  points 0), not from its wreck's removal.** Against each spawner's authored
  window (the level's `SinglePlayer/ObjectSpawnTemplates`), a hull that was
  placed at the level's load (0 players) respawned at its maximum: every
  such case in three rounds (36), fill (max - delay) / (max - min) between
  -0.015 and 0, and 13 more on Day 2 at LOD 0 (-0.003 to -0.001). One
  spawned during play (30 bots of 32) respawned at fill 0.924-0.937 (39 of
  41; Day 2 at LOD 0, 0.934-0.936, 8 of 8), which is 30/32 = 0.9375:
  `min + (max - min)(1 - 30/32)`. The odd ones out are a helicopter pad with
  `maxNrOfObjectSpawned 2` (two hulls on one pad) and a pad whose flag
  changed hands in the wait (fill 0.43, above). The next hull does not wait
  for the last one's wreck: an M2A3 (60 s wreck, 35-40 s window) came back
  40.0 s after its death with the wreck still on the pad. The viewer draws
  the delay uniformly in the window (`vehicle-wrecks.js`) and counts it from
  the wreck's removal.
- **A wreck stands for the template's `timeToLiveAfterDeath`**, 10 s by
  default: 60.0 s for DC's T-72, M1A1, BMP-2, M2A3, BRDM-2 and
  BRDM2_Spandrel (their `objects.con` set 60), 10.0 s for the Humvee, DPV,
  Technical, M163, Shilka, MLRS, M-109, M-1974, BM-21 and every aircraft
  (none sets it). The viewer lingers every wreck 10 s (`WRECK_LINGER`).
- **The abandoned-vehicle clock is as `deployables.js`'s `AbandonClock`
  reads it** (item 25): nobody aboard and nobody close, the hull's hit points
  start to fall 45.9-56 s after its last crewman left (22 of 28 cases; DC's
  spawners say `TimeToLive 45`, checked in 0.5 s steps) and drain at 9-10 hit
  points a second (DC's `damageWhenLost 10`, billed per step) to 0, then it
  is a wreck. The longer idles (64-150 s) had a soldier within 5-50 m of the
  hull part of the time. Nothing in the viewer runs this clock for a vehicle.
  The LOD 0 rounds agree: El Alamein 48.2-48.8 s idle and 9.2-10.0 hp/s
  (five cases), Day 2 47.1-50.6 s and 9.2-10.1 hp/s (four), with two longer
  idles there (71 and 101.5 s).
- **DC Weapon Bunkers (levels census item 22) cannot be run with bots**: its
  archive ships no `SinglePlayer/` layer and no AI data, and bots exist only
  in `GPM_COOP`, which plays that layer. Whether the Iraqi spawns vanish with
  the bunkers needs a Conquest round with humans.

### What the bots use

Over the DC runs, bots drove T-72s (7,666 s), M1A1s, BMP-2s, M2A3s, Shilkas,
Su-25s, BRDM-2s, Humvees, M163s, MiG-29s, A-10Cs, Mi-24s, F-14Bs, SA-342Gs,
the MLRS, the DPV, F-15Cs, AH-64s and once the AV-8B, and rode in every
gunner and passenger seat. Never, in any run: the UH-60L (3 lives on El
Alamein), the UH-60 on Bocage (4), the AH-6, the Mirage, the Scud, the Lada,
any boat or ship on Guadalcanal (OSA, LCVP, Fletcher, Sub 7C, Gato:
bots-only Guadalcanal had no sailor in 12 minutes), and no driver of the
M-109, M-1974 or BM-21 (their gunners, yes).

- **Retail bots board the A-10C** (air census item 25 "Bots never board
  A10_B/A10_C"): 6 of 9 A-10C lives, 847 s at the stick.
- **Retail bots drive the door-less MLRS** (ground census question 4): a bot
  took the MLRS's gun seat at 144.5 s and moved to the driver's seat at
  149.4 s (round 1), then drove it 317 s; never the M-109, M-1974 or BM-21.
- Bots-only co-op on DC Bocage Day 2 and Day 3 can have no Harrier: their
  `SinglePlayer/ObjectSpawnTemplates` name `Av8B`, which DC never creates
  (it makes AV-8A/B/C/H/M), so none spawns. DC El Alamein Day 2's co-op
  templates name the AC-130, A-10B, F-16, MiG-29 and Su-25 and its
  `ObjectSpawns` place none of them.
- Bots stand still rarely: of the soldier lives that lasted 30 s, 2-7 a round
  never got 20 m from where they began without boarding anything (the levels
  census's "frozen in Change" counts in the viewer's runner are 0-5 of 6).

### Rounds in flight (weapons census items 19-24, questions 1 and 4)

From every DC file: in the LOD 0 rounds every shot is real; at LOD 2
aircraft, anti-aircraft guns, the MLRS and a few others fire real. `v0` is the
speed over the first two ticks (p50 over the flights); "a along" is the
acceleration along the launch direction and "g across" the gravity across it,
from a quadratic fit over the first 3 s of free flight (to the first bounce or
hit), p50; speeds are at 0.5-5 s.

| round | fired by | flights | v0 | 0.5 s | 1 s | 2 s | 3 s | 5 s | a along | g across | what it says |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sabot_Projectile | M1A1 | 39 | 250.1 | 249.9 | 250.2 | 247.9 | 248.1 | | -0.6 | 14.73 | gravity 1.0 (IMP-7's 14.73) |
| T72Projectile | T-72 | 17 | 250.1 | 250.7 | 251.5 | | | | -0.3 | 14.73 | gravity 1.0 |
| M-109Projectile, M-1974Projectile | M-109, M-1974 | 3, 1 | 250.1, 250.0 | 250.1 | 250.0 | | | | -0.8 | 14.73 | gravity 1.0 |
| 25mmChaingunProjectileBMP2 | BMP-2 | 49 | 585.1 | 585.0 | 585.5 | | | | 0.0 | **2.94** | `gravityModifier 0.2` honoured (the viewer flies bullet-kind rounds flat) |
| 25mmChaingunProjectileM2A3 | M2A3 | 45 | 500.1 | 500.0 | | | | | 0.0 | **2.96** | 0.2 |
| 25mmChaingunProjectile | AH-64 M230 | 25 | 1,008.8 | 991.3 | 990.5 | 988.7 | 987.1 | | -1.7 | **2.94** | 0.2 |
| SMAWProjectile | SMAW | 102 | 100.0 | 100.0 | 99.9 | 99.8 | 99.3 | | -0.2 | **5.89** | 0.4 x 14.73 |
| RPGProjectile | RPG-7 | 104 | 100.0 | 99.9 | 99.9 | 99.6 | 99.8 | | -0.3 | **5.89** | 0.4 |
| M203projectile, AK47GP30Projectile | M203, GP-30 | 8 | 60.1 | 60.2 | 60.7 | | | | 0.2 | **7.36** | 0.5 |
| 40mm_Grenade | Humvee Mk19 | 6 | 107.7 | 106.3 | 105.4 | 105.0 | | | -3.5 | 14.73 | 1.0 |
| RecoillessProjectile | Technical | 1 | 179.8 | | | | | | | 14.78 | 1.0 |
| GrenadeAlliesProjectile | hand grenade | 151 | 25.0 | 24.4 | 24.1 | | | | -3.9 | 14.66 | thrown at 25 m/s |
| TOW_Projectile | M2A3, Humvee TOW | 51 | 100.2 | 100.2 | 100.2 | 100.0 | 100.0 | 100.0 | 0.0 | **0.0** | straight, constant speed, turns under 0.1 degrees: no guidance, no gravity |
| BMP2_AT4_Projectile | BMP-2 AT-5 | 47 | 100.0 | 100.0 | 100.0 | 100.1 | 100.2 | 100.2 | 0.0 | **0.0** | the same |
| Spandrel_Projectile | BRDM-2 Spandrel | 13 | **201.2** | 201.2 | 201.1 | 201.1 | 201.2 | | 0.0 | 0.0 | question 4: the launcher declares no velocity and the round leaves at 200.5 m/s relative to the BRDM-2 (12 flights, 199.8-201.0), plus the BRDM-2's own speed: the 200 m/s FireArms default (FA-3), not the viewer's `velocity ?? 100` |
| AS-7 | Su-25 rack | 81 | 82.6 | 87.9 | 92.5 | 97.3 | 103.8 | | +4.9 | 14.53 | a winged bomb (no Engine in its template: mass 250, drag 0.08, `setWingLift 2`) gaining speed in the dive it is dropped in (27 degrees down), falling at full gravity |
| MLRSRocket | MLRS ("Blast") | 25 | 97.8 | 88.5 | 91.2 | 101.2 | 108.6 | | +3.9 | **16.8** | **arcs under gravity** (item 22: the viewer sets gravity 0 for every rocket) and speeds up under its `c_ETRocket` motor (torque 50, differential 30, maxRotation 5000; mass 20, drag 1) |
| Blank_Projectile | MLRS ("Blast") | 25 | 100.1 | 98.6 | 97.7 | 97.2 | 99.1 | 108.3 | -3.6 | 14.73 | a second round per MLRS shot, ballistic, lives 10 s |
| CBU87Prj | A-10C | 56 | 71.5 | 73.1 | 73.4 | 77.7 | 84.7 | | -0.1 | **14.45** | item 24: the submunitions fall (the viewer flies them level as bullet-kind) |
| Aim9 | F-15C, F-16 | 60 | 498.8 | 222.9 | 153.9 | 109.5 | 95.3 | 87.4 | | | a third of its speed in 1 s (drag), turns under 0.13 degrees: unguided |
| AA-10 | MiG-29 | 23 | 508.0 | 183.8 | 119.3 | 83.8 | | | | | the same law |
| ShilkaProjectile, M163_Projectile | Shilka, M163, AC-130 Vulcan | 98, 82 | 1,000.5 | 1,000.5 | | | | | 0.0 | **0.0** | no gravity |
| 30mm / Avenger / .50 / 7.62 / 5.56 / 9 mm | guns | 2,500+ | 500-1,091 | | | | | | 0 | **0** | non-tracer bullets: no gravity |
| tracers (20 mm, .50, 7.62, Avenger) | guns | 900+ | 979-1,087 | | | | | | | **14.73** | these tracers fall at full gravity; the NSVT's `Tracer_Projectile` (64) does not |

- **A round leaves at its own speed plus its launcher's** (the launcher's
  velocity along the shot, from its poses 0.2 s either side): the Spandrel
  `v0 = 200.5 + 1.015 x` that speed over 12 flights, 199.8-201.0 m/s
  relative to the BRDM-2 (the 191.3 m/s an earlier draft of this page gave as
  the default was one fired by a BRDM-2 backing away at 8.9 m/s along its line
  of fire: 200.2 relative), the M2A3's TOW `99.97 + 1.037 x` (11). Over
  10 sabot shots the launchers barely moved (1.4 m/s at most), so it is not
  separable there. This is what `round-launch.js` already does (the
  platform's velocity on top of the muzzle velocity).

- **Rocket motors (question 1):** the MLRS rocket, the one recorded round
  with a `c_ETRocket` Engine, gains about 20 m/s over 3 s (88.5 at 0.5 s to
  109 at 3 s, on a shallow arc) and falls under at least full gravity (16.8
  across its path; the Wing's 0.1 lift and the motor's line both feed that
  number); the TOW and AT-5 neither accelerate nor fall; the Aim-9 loses two
  thirds of its speed in a second. None of them steers. The viewer's fixed
  25 m/s^2 with gravity 0 matches none of these.
- **Not fired in any run, so not measured: Hydra, Hellfire, S-5, AT-2,
  Stinger, SA-7 and the BM-21's rockets.** Over the LOD 2 DC files bots flew
  the Mi-8 3,467 s, the UH-60 2,300 s, the Mi-24D 2,263 s, the AH-64 1,862 s
  and the SA-342G 360 s; then a Gazala LOD 0 run for exactly this
  (`dc-gazala-coop-lod0-rec`, 18 rounds, 12,199 s, every shot real) added the
  AH-64 972 s at the stick, the Mi-24D 606 s and the Mi-8 1,352 s. The only
  helicopter weapon that fired in either was the AH-64's M230 cannon (132
  shots at LOD 0). No rocket pod or missile rack on any helicopter fired once,
  and no soldier fired a Stinger or an SA-7. The AI data does give the racks
  to the bots: the AH-64's `AH64HydraRack` and `AH64HellfireRack` carry
  `aiTemplate AH64Hydra` and `AH64Hellfire`, weapon templates with ranges
  10-450 and 20-350 m (`useAimerOnly 1`), and the Mi-24D's `Mi24D_AT2Arms`
  carries `Mi24DAT2` (30-200 m); but `Mi24D_S5Arms` names `aiTemplate
  Mi25DS5`, while the weapon template is `Mi24DS5`, a typo in DC 0.7 that
  leaves bots no S-5. Why the others never fire was not read. So the motor
  law's Hellfire figure (83 m/s) cannot be checked from bots. The BM-21 fired
  125 times, all fake (LOD 2, El Alamein Day 2 and Bocage), and not at all in
  the Day 2 LOD 0 round. The rockets that did fly are the table's: the MLRS,
  AS-7, TOW, AT-5, Spandrel, Aim-9 and AA-10.

### Hand-weapon spread, square or disc (DEV-9): not settled by bots

The viewer rolls a disc (`round-launch.js` `wander`: polar angle `spread x
sqrt(u)`). What the four LOD 0 rounds say, matching each real `f` record to
its round's `pn` and first two `pj` positions (the direction it flew, to 0.02
degrees over a tick's 30 m), offsets in degrees across (dx) and up (dy) from
the `f` direction (`~/.cache/dc-sweep/dc-lab/probe_dev.py`, `dev_burst.py`,
`dev_pellets.py`):

- **The `f` direction is the aim before any spread.** The 3-8 pellets of one
  Saiga-12K pull carry one `f` direction, the same to the last digit, and fly
  up to 1.9 degrees apart.
- **A still bot's rifle shows no per-shot draw.** Its rounds leave the `f`
  direction by an offset held for the burst and often far longer (one bot's
  M16: (-0.43, -0.28) at 260 s and (-0.40, -0.29) again at 494-508 s, 250 m
  away), varying 0.03-0.05 degrees rms shot to shot when the muzzle stays
  within 0.3 m (M16 71 shots in 15 bursts, PKM 35 in 9), which is the
  recorder's own resolution (`d` is written to 3 decimals, 0.06 degrees). The
  held offsets differ bot to bot and stance to stance (rms over bursts: M16
  0.50, AK47 0.38, PKM 0.76, M249 0.88), which fits the barrel's line differing
  from the eye's (`fireInCameraDof`; not checked). The `f` direction itself moves smoothly shot
  to shot (a bot tracking at 2.6 degrees a second). DC's M16 says `setMinDev
  0.4` and the AK47 0.5, so the deviation a human's rifle would roll does not
  reach a bot's rounds, and there is no draw to tell a square from a disc.
- **The shotgun is the one per-shot spread in the data.** Around each pull's
  centre the Saiga-12K's pellets spread 0.96 degrees rms across by 0.76 up
  (68 pellets in 12 pulls, the farthest 1.89 out). Scaled per pull by its
  largest |dx| or |dy|, 0.265 of them lie outside the unit circle and 0.559
  within 22.5 degrees of a diagonal; square draws of the same pull sizes give
  0.265 and 0.559 (median), disc draws 0.250 and 0.500, and each lies inside
  the other's 95% range. It leans square; it does not decide.

DEV-9 needs a shooter whose deviation is rolled: a human on the lab server
(a connected client, 30 or more shots standing still at a wall), or the read
of where `fireBarrel` (0x0828aba0) perturbs the matrix it was given.

### Static wrecks and collision (COL-16..18): not answerable from bots

Whether a level-placed static that never writes `hasCollisionPhysics 1`
stops rounds and bodies cannot be read from these recordings:

- **No recorded level places a static wreck.** Vanilla El Alamein, Kursk,
  Gazala, Guadalcanal, Bocage, Midway and Wake, and DC's El Alamein, Day 2,
  Gazala, Guadalcanal, Bocage and Bocage Day 2 have no `Object.create
  *wreck*` in their archives. The levels that do place them (DC Operation
  Bragg 13: `mi24dwreck`, `t72wreck`, `m1a1wreck`, `brdm2wreck`, `bmp2wreck`;
  73 Easting 11; Urban Siege 17; Inshallah Valley 2; Basrah Nights 1;
  vanilla Liberation of Caen 13 aircraft wrecks) ship no `SinglePlayer/`
  layer, so no bot round can be played on them.
- **The one co-op level with wrecks has the other kind.** DC Basrah's Edge
  places six `DC_pickup-wreck1_m1` and a `DC_slumwreckage1_m1`, and both
  templates do write `ObjectTemplate.setHasCollisionPhysics 1` (collision
  boxes 2.0 x 1.4 x 5.1 m and 5.9 x 2.6 x 2.0 m). They would be the control,
  not the case. In 750 s at LOD 0 no round came within 14 m of any of them
  and the nearest body came 3.0-6.3 m from their origins, so even the
  control saw nothing (`~/.cache/dc-sweep/dc-lab/probe_wreck_hits.py`,
  `wreck_near.py`).
- A destroyed vehicle's wreck in these rounds (a T-72 standing 60 s on its
  pad) is the same networked hull with its wreck geometry, not a placed
  static, so it does not settle the static rule either.

Settling it needs a human on the lab server (Conquest on Bragg: shoot at
and walk into the `Mi24DWreck`), or a co-op layer added to Bragg, which this
lab could not do (see the water attempt below: the server rejected every
archive the lab wrote).

### A land hull in deep water (ground census root cause 2): not measured

Bots did not drive a land hull into the sea in a 10-minute LOD 0 round of DC
Guadalcanal (12 land hull types driven, 0 samples under the water plane).
Putting hulls there failed three ways: `Object.create` / `Object.absolutePosition`
in the server's autoexec makes nothing (it runs before the level loads); a
numbered level patch (`guadalcanal_001.rfa` / `_999.rfa` with six extra
co-op spawners in 2-15 m of water) is not read; and a whole uncompressed copy
of DC's `GuadalCanal.rfa` with the spawners added is rejected (the server
falls back to vanilla's Guadalcanal: US Marines, Shermans), with or without a
148-byte checksum block. So the engine reads only archives it can verify, or
only compressed ones. Measuring it needs a human driving in, or an archive
written the way the game writes them (LZO segments and its checksum).
(`~/.cache/dc-sweep/dc-lab/make_water_patch.py`, `make_water_level.py`; the
lab's link tree was restored after each try.)


## Runs

All under `~/bf1942-lab/runs/`, each with `server/replay_<unix>.ndjson` (one
file a round), the event log in `serverlog/`, `scenario.json`, `settings/` and
`run.json`. 30 bots on 32 slots, no human, DC 0.7 from the Wine client.

| run | level | AI LOD | rounds (files) | s | used for |
|---|---|---|---|---|---|
| `20261006-212343-dc-el_alamein-coop-rec` | El Alamein | 2 | 2 full + a start (3) | 1,680 | pads, aircraft, LOD 2 mover |
| `20261006-215149-dc-guadalcanal-coop-rec` | Guadalcanal | 2 | most of 1 (1) | 757 | crews (no boats used) |
| `20261006-220426-dc-bocage_day2-coop-rec` | Bocage Day 2 | 2 | part (1) | 469 | helicopters |
| `20261006-221215-dc-bocage-coop-rec` | Bocage | 2 | 1 full + part (2) | 992 | the Harrier, MLRS rockets |
| `20261006-222848-dc-el_alamein_day2-coop-rec` | El Alamein Day 2 | 2 | 7 full + 2 short (9) | 6,821 | helicopters hands-off |
| `20261007-002229-dc-gazala-coop-rec` | Gazala | 2 | 1 full + a start (2) | 517 | the AC-130 |
| `20261007-003106-dc-el_alamein-coop-lod0-rec` | El Alamein | **0** | 1 full + a start (2) | 593 | ground physics, rounds, pads |
| `20261007-004059-dc-guadalcanal-coop-lod0-rec` | Guadalcanal | **0** | 1 full + part (2) | 742 | water (none), ground |
| `20261007-010104-dc-el_alamein-coop-lod0-rec` | El Alamein | **0** | 1 full + a start (2) | 584 | ground physics, full lock |
| `20261007-011049-dc-el_alamein_day2-coop-lod0-rec` | El Alamein Day 2 | **0** | 1 full + a start (2) | 573 | pads and captures, rockets (none fired) |
| `20261007-015645-dc-gazala-coop-lod0-rec` | Gazala | **0** | 16 full + 2 starts (18) | 12,199 | helicopter rockets (none fired), the M230 |
| `20261007-052417-dc-basrahs_edge-coop-lod0-rec` | Basrah's Edge | **0** | most of 1 (1) | 750 | static wrecks (none reached) |
| `20261007-005321` ... `010013-dc-guadalcanal-coop-lod0-water-rec` | Guadalcanal | 0 | starts only (6) | 40-117 | the failed water placements |

Vanilla rounds recorded for this page (`--mod bf1942`), 30 bots of 32:

| run | level | AI LOD | rounds (files) | s | used for |
|---|---|---|---|---|---|
| `20261007-012156-elalamein-coop-lod0-rec` | El Alamein | **0** | 1 full (1) | 990 | vanilla ground physics |
| `20261007-013855-kursk-coop-lod0-rec` | Kursk | **0** | 1 full + part of the next (1) | 779 | vanilla ground physics (T-34, T-34-85, M3A1, Katyusha) |

Vanilla files read for comparison: `20261004-180859-parity-elalamein-rec`
(the bots-only El Alamein soak, 7 rounds), `20261005-082947-` and
`20261005-191346-projpool-elalamein-rec`, `20261005-082144-projpool-wake-rec`,
`20261003-200822-` and `20261003-215615-midway-coop-rec`, and the owner's
`20261005-070852-` and `20261006-200339-parity-elalamein-rec`.

## How it was recorded

- **DC on the lab server.** server1 has `bf1942`, `xpack1` and `xpack2` only.
  `python3 lab/lab.py setup --mods-from-client DesertCombat` builds
  `~/bf1942-lab/server/mods/desertcombat/` as a lower-case tree of links to
  the Wine client's `Mods/DesertCombat/` `.con`, `.dat` and `.rfa` files
  (44 files; the 1.6 Linux server lower-cases every path before it opens it,
  server1's `readmes/readme-linux.txt`). Nothing is copied. The first start
  worked: DC's El Alamein overlay loaded over vanilla's archives through DC's
  `addModPath Mods/BF1942/`, with vanilla's AI data, and 15 bots a side spawned
  and took Mi-24s, A-10Cs, F-14Bs, the DPV and T-72s in the first minute. A DC
  level writes its event log to `mods/desertcombat/logs/`, which `lab.py stop`
  now collects.
- **The rounds.** `lab/scenarios/dc-<level>-coop-rec.json`: one level, co-op
  (`GPM_COOP` plays the level's `SinglePlayer/` layer), 30 bots of 32 slots,
  30 s pregame, the recorder preloaded, no client. A lab server plays round
  after round of the same level, one recorder file a round.
- **What a file holds.** Every networked root's position and rotation after
  every server tick (30 a second), each moving part's rotation against its
  root (`j`: turrets, a helicopter's engine racks), each engine's revs and
  throttle servo (`g`), every seat change (`p`), hit points (`a`), every round
  in flight (`pn`/`pj`/`pd`), every shot (`f`), control points and the server's
  destroy events.
- **What it does not hold: anybody's input.** Bots drive and fly; their
  stick is not recorded. A helicopter's engine racks are (they are the cyclic
  as the hull got it), and so is an aircraft's throttle servo. A land hull's
  recorded engine is not its drive at AI LOD 2: a Humvee's reads 0 throttle
  and 0 revs at 22 m/s, and the AI mover carries it. At LOD 0 the engine
  servo is the bot's throttle (-1 to 1) and the front wheels its steering.
- **Fake fire.** A bot shooting a bot that no human is near fires fake (ledger
  AI-134): the shot is counted (`f` with `"fake":1`) but no projectile is
  made. In the first El Alamein round 155 of 156 T-72 shots were fake. What
  flies in a bots-only round is air-to-ground and anti-air fire and a few
  others. For the projectile laws, `lab/realfire/realfire.so` (a lab-only
  preload: `FireArms::setFakeFire` always stores 0) makes every shot real;
  the `*-realfire-rec` scenario loads it beside the recorder (never run:
  `aiSettings.lodEnable 0` makes every shot real without patching anything,
  and is what the `*-lod0-rec` scenarios use).
- **Frames.** BF1942's: left-handed, +Y up, a body's nose its rotated +Z. A
  moving hull's velocity lies along it (cosine 0.999 or better for every DC
  ground hull and fixed-wing aircraft recorded). Speeds come from samples a
  quarter second apart (positions are written to the centimetre).
- **Cut at the round's end.** The first end-of-round status after play ends
  a file's statistics: the teardown destroys every hull in one tick.

To redo it:

```sh
cd tools/bf1942-models
python3 lab/lab.py setup --mods-from-client DesertCombat
python3 lab/lab.py start lab/scenarios/dc-el_alamein-coop-rec.json --wait 0
python3 lab/lab.py stop                                   # after a round or two
python3 lab/dc_truth.py ~/bf1942-lab/runs/<run> --md out.md --compact out.json
python3 lab/dc_truth.py --mod bf1942 ~/bf1942-lab/runs/<vanilla run> ...  # a vanilla level
```

The `*-lod0-rec` scenarios add `aiSettings.lodEnable 0` to the autoexec;
the rest are the bots-only LOD 2 rounds.

`dc_truth.py` reads the level's heightmap from the game install (through the
mod's `addModPath` chain, as the exporter does) for heights over ground, and
the level's `SinglePlayer/ObjectSpawns` for each pad's authored window. The
test is `tests/test_dc_truth.py`, on a 33 KB cut of the first round
(`tests/fixtures/make_dc_truth_fixture.py` makes it).

## The viewer reads a DC server recording

In Node (`parseRecording`, `parseServerLog`, `alignServerLog` and the merge
reader, imported straight from `viewer/`), the first El Alamein round
(`20261006-212343-dc-el_alamein-coop-rec/server/replay_1791285831.ndjson`,
727 s of play, 31 MB) parses in 0.7 s with nothing skipped: 959 lives (90
soldiers, 30 cameras, 90 kits, 5 control points, 662 rounds of the three
pooled templates, 82 others), 383,563 samples, 30 bots, 61 kills, 4,179
shots, 5 captures, 56 hulls' engines and 70 hulls' parts, every hull template
by its DC name (T72, M2A3, F-14B, BRDM2_Spandrel, DesertPatrolVehicle ...).

In the page (headless Chromium, the worktree's viewer on :5620,
`map.html?mod=desertcombat&mode=CoOp&replay=...`), the same file is ready in
5.2 s: "el_alamein · 70 vehicles · soldiers drawn by the map · tickets
recorded"; 30 hull templates get their DC model (M1A1, T-72, BMP-2, Mi-24,
F-14B ... drawn on DC's El Alamein under DC's HUD), and seeks to 120, 300 and
600 s show 22-25 templates with no stage of the replay's guard reporting a
throw. What is off, for the replay's owner (nothing here changes `replay*.js`):

1. **A kit an ObjectSpawner lays is a hull to the replay.** DC's `US_AA` and
   `US_Sniper_hvy` pads lay a kit object; `parseRecording` marks a kit only
   from a pickup of that life or of its template, so 11 `US_AA` lives and one
   `US_Sniper_hvy` that nobody took are `isHull` (`replay.js:123`): the page
   asks for `models/mods/desertcombat/US_AA.glb` and `.wreck.glb` (404) and
   draws nothing on the pad. Such a life has no `maxhp`, which every hull has.
2. **A bots-only server file never aligns with its event log.**
   `alignServerLog` proposes offsets from `spawn` and `chat` matchables and
   from exact clocks; a server file with no client connected has none (its
   soldier lives are never `announced`, its `clock` events carry world time 0,
   and it has no `simStart`), so the `&serverlog=` lab.py prints for a server
   recording is loaded but never placed. Vanilla's bots-only files
   (`20261005-191346-projpool-elalamein-rec`) do the same: it is not DC's.
3. **`rec.mod` is empty.** With no client there is no ServerInfo event, so
   the file does not say it is DC; the URL's `&mod=desertcombat` is what
   loads DC's models (lab.py now writes it on every run's URL).
4. **Rounds in flight are not drawn from the file.** The replay skips
   `pn`/`pj`/`pd` (as `features/server-replay-recorder` says); a bots-only
   round has few real rounds anyway (fake fire, above).
5. Not DC's: the page probes `poses/index.json` and each `*.pose.json` recipe
   before the `.pose.glb` (404s in both trees, harmless).
