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
  bots-only round; the `realfire` round fills in the rest.

### Helicopters do not damp their rotation (air census open question 1)

With every engine rack square (the cyclic centred, the racks' recorded
rotation within 2 degrees of identity; a rack at rest reads (+-0.0017, 0, 0, 1)),
a helicopter's turn rate holds:

- A Mi-24 pitching over at 25.4 deg/s with its racks within 2 degrees held
  24.4-26.7 deg/s for 1.4 s (El Alamein round 2, 310.4-311.8 s), nose -43 to -79.
- A Mi-24 with its racks exactly square (within 0.25 degrees) held 1.4-1.8
  deg/s of pitch for 6 s (round 2, 204.4 s): no decay at all.
- Fitted over every hands-off stretch, angular acceleration against rate on
  the pitch axis has slope -0.004/s (Mi-24, 36.8 s, 1,054 samples) and
  -0.17/s (AH-64, 41.6 s): no damping term of any size. What there is, in a
  full-collective climb, is a steady nose-down moment of about 1.1-1.4
  deg/s^2 that builds the pitch rate from 0 to 15 deg/s over 7.5 s
  (three Mi-24 climbs alike, 24 m/s up).
- A real decay seen once (Mi-24, 6.1 to 1.8 deg/s in 2.3 s) happened while the
  racks sat 0.4-1.6 degrees off square; with them at 0.0 the 1.8 deg/s then
  held for 1.5 s. A degree of rack is enough to brake a few degrees a second.

So the viewer holding a rate forever is retail. Bots almost never roll or yaw
with the racks square (rate p95 0.3 deg/s on those axes in every hands-off
stretch), so roll and yaw damping are not measured; the pitch axis says the
engine adds none, which is what the laws read so far say (COL-8).

<!-- HARRIER -->

<!-- AC130 -->

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
