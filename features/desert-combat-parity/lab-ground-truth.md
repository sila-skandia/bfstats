# Desert Combat ground truth from the lab server

The DC fix round ported Desert Combat 0.7 from its data and the decompiled
engine. This page is the other half: the real game, recorded. Bots-only DC
co-op rounds on the lab server (`tools/bf1942-models/lab`), each written whole
by the server recorder (`features/server-replay-recorder`), read back by
`tools/bf1942-models/lab/dc_truth.py` into per-template numbers. The numbers
are in [`lab-ground-truth.json`](lab-ground-truth.json) beside this page.

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
  | DPV | 50 | 27.5/47.1, 18.0/23.0 | 35.9/51.4, 8.7/13.3 | 24.9/36.6, 4.3/7.0 | |
  | Humvee | 50 | 24.5/29.4, 26.6/35.7 | 20.7/27.4, 11.4/16.4 | 21.9/24.1, 8.0/10.0 | |
  | Humvee_TOW | 35 | 12.9/48.2, 19.4/30.0 | 27.7/50.7, 16.6/33.5 | 22.0/34.4, 8.2/12.6 | 19.1/22.1, 6.0/7.2 |
  | Technical | 50 | 27.1/48.8, 20.7/26.2 | 26.7/49.7, 10.8/20.7 | 35.8/44.1, 9.1/11.4 | |
  | BRDM-2 | 30 | 17.5/37.4, 18.4/21.9 | 27.8/74.3, 11.9/20.6 | 20.3/42.2, 6.0/11.8 | 8.8/17.0, 2.7/4.5 |

  **The DPV does not spin out at full lock at 10-15 m/s** (slip 4.3 degrees,
  p95 7.0; the census's viewer spins it 190 degrees in 2.25 s at 15 m/s). No
  bot full-locked it faster than 15 m/s, so 15-30 m/s is unmeasured; at
  LOD 2 the spins seen at 30-40 m/s were the AI mover slewing the heading.
- **Upside down costs 5 hit points a second, in whole seconds.** An unmanned
  Humvee_TOW on its roof for 2.8 s went 100, 95, 90, 85, 80 at 109.0, 110.0,
  111.0, 112.0 s, then righted and kept the rest.
- **No launches at LOD 0.** No land hull went over 25 m/s or 8 m/s upward on
  the ground in the LOD 0 round. The one land hull seen far above the ground
  was at LOD 2: a T-72 driven by the AI mover went from 90.4 m to 401.5 m in
  one tick (El Alamein, 261.72 s), then came down at a steady 121 m/s (no
  acceleration) without a scratch: the mover, not the physics.

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

- **A captured pad spawns the capturer's hull** (item 24, the census's
  "Broken"): El Alamein's North outpost pads gave team 2 an M2A3 and a Humvee
  and team 1 a BMP-2 and a BRDM-2; the East outpost an MLRS or a BM-21, the
  South outpost a Humvee_TOW or a BRDM2_Spandrel, as the flag stood when the
  hull spawned (SPAWN-2's team pick, seen in play).
- **The respawn delay is `calcSpawnDelay` with the bots counted, drawn when
  the previous hull spawned, and it runs from that hull's destruction (hit
  points 0), not from its wreck's removal.** Against each spawner's authored
  window (the level's `SinglePlayer/ObjectSpawnTemplates`), a hull that was
  placed at the level's load (0 players) respawned at its maximum: 25 of 26,
  fill (max - delay) / (max - min) between -0.007 and 0. One spawned during
  play (30 bots of 32) respawned at fill 0.927-0.937 (38 of 40), which is
  30/32 = 0.9375: `min + (max - min)(1 - 30/32)`. The odd ones out are a
  helicopter pad with `maxNrOfObjectSpawned 2` (two hulls on one pad) and a
  pad whose flag changed hands in the wait (fill 0.43; `setActive` draws the
  delay again). A pad does not respawn before its wreck has gone (a T-72's
  60.1 s delay ended as its 60 s wreck went). The viewer draws the delay
  uniformly in the window (`vehicle-wrecks.js`) and counts it from the wreck.
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

From the LOD 0 round (every shot real) and, for the MLRS, a bots-only DC
Bocage round (artillery fires real at LOD 2). `v0` is the speed over the
first two ticks; "a along" is the acceleration along the launch direction and
"g across" the gravity across it, from a quadratic fit over the first 3 s of
free flight (to the first bounce or hit); speeds are at 0.5-5 s.

| round | fired by | flights | v0 | 0.5 s | 1 s | 2 s | 3 s | 5 s | a along | g across | what it says |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sabot_Projectile | M1A1 | 12 | 250.1 | 249.4 | 250.5 | | | | -1.7 | 14.74 | gravity 1.0 (IMP-7's 14.73) |
| T72Projectile | T-72 | 1 | 248.7 | 252.4 | | | | | -0.2 | 14.61 | gravity 1.0 |
| 25mmChaingunProjectileBMP2 | BMP-2 | 33 | 585.1 | 585.0 | 585.5 | | | | 0.0 | **2.94** | `gravityModifier 0.2` honoured (the viewer flies bullet-kind rounds flat) |
| SMAWProjectile | SMAW | 44 | 100.0 | 100.0 | 99.9 | 100.3 | | | -0.2 | **5.89** | 0.4 x 14.73 |
| RPGProjectile | RPG-7 | 14 | 100.0 | 100.0 | 99.7 | 99.7 | 100.1 | | -0.3 | **5.89** | 0.4 |
| M203projectile, AK47GP30Projectile | M203, GP-30 | 5 | 60.1 | 60.2 | 60.7 | | | | 0.2 | **7.36** | 0.5 |
| 40mm_Grenade | Humvee Mk19 | 6 | 107.7 | 106.3 | 105.4 | 105.0 | | | -3.5 | 14.73 | 1.0 |
| TOW_Projectile | M2A3, Humvee TOW | 10 | 100.6 | 106.2 | 107.4 | 100.7 | | | 0.0 | **0.0** | straight, constant speed, turns under 0.1 degrees: no guidance, no gravity |
| BMP2_AT4_Projectile | BMP-2 AT-5 | 17 | 100.0 | 100.0 | 100.0 | 100.0 | 100.2 | 100.3 | 0.0 | **0.0** | the same |
| Spandrel_Projectile | BRDM-2 Spandrel | 2 | **191.3** | 191.3 | 191.2 | | | | 0.0 | 0.0 | question 4: the launcher declares no velocity and the round leaves at 191.3, not the viewer's `velocity ?? 100` |
| AS-7 | Su-25 rack | 32 | 80.1 | 88.4 | 92.1 | 98.3 | 103.3 | | +4.4 | 14.48 | a winged bomb (no Engine in its template: mass 250, drag 0.08, `setWingLift 2`) gaining speed in the dive it is dropped in (12 degrees down: 3.1 m/s^2 of gravity along it), falling at full gravity |
| MLRSRocket | MLRS ("Blast") | 11 | 97.8 | 88.5 | 91.3 | 101.4 | 109.0 | | +4.0 | **16.8** | **arcs under gravity** (item 22: the viewer sets gravity 0 for every rocket) and speeds up under its `c_ETRocket` motor (torque 50, differential 30, maxRotation 5000; mass 20, drag 1) |
| Blank_Projectile | MLRS ("Blast") | 11 | 100.1 | 98.6 | 97.8 | 97.6 | 99.4 | 108.8 | -3.5 | 14.73 | a second round per MLRS shot, ballistic, lives 10 s |
| CBU87Prj | A-10C | 28 | 69.9 | 70.0 | 71.1 | 75.8 | 82.3 | | 0.2 | **14.45** | item 24: the submunitions fall (the viewer flies them level as bullet-kind) |
| Aim9 | F-15C | 11 | 503.7 | 224.4 | 154.3 | | | | | | slows to a third in 1 s (drag), turns under 0.1 degrees |
| 30mm / Avenger / .50 / 7.62 / 5.56 | guns | 1,000+ | 973-1,092 | | | | | | 0 | **0** | non-tracer bullets: no gravity |
| tracers (20 mm, .50, 7.62, Avenger) | guns | 200+ | 973-1,091 | | | | | | | **14.7** | every tracer falls at full gravity |

- **Rocket motors (question 1):** the MLRS rocket, the one recorded round
  with a `c_ETRocket` Engine, gains about 20 m/s over 3 s (88.5 at 0.5 s to
  109 at 3 s, on a shallow arc) and falls under at least full gravity (16.8
  across its path; the Wing's 0.1 lift and the motor's line both feed that
  number); the TOW and AT-5 neither accelerate nor fall; the Aim-9 loses two
  thirds of its speed in a second. None of them steers. The viewer's fixed
  25 m/s^2 with gravity 0 matches none of these. Hellfire, Hydra, Stinger and
  the Katyusha were not fired in any recorded round.

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

<!-- ROUNDS -->

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
  recorded engine is not its drive: a Humvee's reads 0 throttle and 0 revs at
  22 m/s. So a ground speed here is what a bot got out of a hull, not what
  the hull can do (see "Bots drive at 0.6 of their AI maxSpeed").
- **Fake fire.** A bot shooting a bot that no human is near fires fake (ledger
  AI-134): the shot is counted (`f` with `"fake":1`) but no projectile is
  made. In the first El Alamein round 155 of 156 T-72 shots were fake. What
  flies in a bots-only round is air-to-ground and anti-air fire and a few
  others. For the projectile laws, `lab/realfire/realfire.so` (a lab-only
  preload: `FireArms::setFakeFire` always stores 0) makes every shot real;
  the `*-realfire-rec` scenario loads it beside the recorder. Those rounds are
  ground truth for how rounds fly, not for how a bot round goes.
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
```

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
