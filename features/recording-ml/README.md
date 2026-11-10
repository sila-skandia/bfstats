# Machine learning on round recordings

Status: research, 2026-11-10. Nothing is built. This page is the approach: what
the recordings hold, how much there is, what to model and with what, and the
first experiment worth running.

The owner's goals: learn from the recordings how good pilots fly, how good tank
commanders position and aim, and which tactics win a round on each map. The
trial runs locally on the owner's laptop (an M5 Max MacBook Pro, 48 GB).

Every claim below carries its source:

- **(M)** measured for this page on 2026-11-10, method in
  [How the numbers were measured](#how-the-numbers-were-measured)
- **(R)** read from the repo, with the path
- **(W)** found on the web on 2026-11-10, with the URL
- **(I)** inference, mine

## Summary and recommendation

1. **The data is rich per round and thin in rounds.** The public feed holds 42
   recordings of 39 rounds, 17.8 hours, 797 distinct human names (M). 41 of the
   42 are player recordings; the one server recording is a 3-minute Berlin
   round with 6 humans and 96 bots (M). A player recording has its own side
   everywhere and the other side for 52% of its time in the world (M), so the
   corpus is one-sided views.
2. **For the first two goals there is enough to measure, not enough to train a
   network.** The repo's own detectors find 361 air fights (122 decided by a
   kill) and 425 tank fights (217 decided) in those rounds (M). That supports
   counts with honest intervals, logistic regression and small boosted trees.
   Only 12 pilots and 22 tank drivers have five or more decided fights (M), so
   nothing about named individuals is supportable yet.
3. **For the third goal the recordings are far too few.** 28 conquest rounds
   reach a result, on 25 different maps, at most 2 per map (M). A per-map
   win-probability model cannot be trained on that. The route that works today
   is a mechanistic ticket projection from the game's own bleed rule, plus
   priors from the stats database, which holds 32,826 conquest rounds of 20 or
   more players (M).
4. **Start with no neural network.** Step one is a columnar store built with
   the viewer's own parser and the existing fight detectors, then counts,
   cluster-bootstrap intervals, regularised logistic regression and LightGBM. A
   pilot run for this page already produced a checkable finding in seconds
   ([First slice](#first-slice)). A sequence model is justified only when there
   are roughly 100 hours of engaged trajectories for one vehicle class; today
   there are 1.8 hours of air fights (M).
5. **Ollama with a DeepSeek model is the wrong tool for the modelling and a
   reasonable tool for one layer on top.** The three goals are trajectory,
   tabular and sequence problems; a language model does not read trajectories
   and loses to boosted trees on tables (W, [Local stack](#local-stack-for-the-trial)).
   Where a local LLM helps: answering questions over the DuckDB tables by
   writing SQL, and turning computed tables into lesson text. On 48 GB the
   largest DeepSeek-family model that fits is `deepseek-r1:32b` (20 GB), a
   distill over a year old; Qwen 3.8 27b, Gemma 4 or gpt-oss 20b are better
   current choices for structured output (W).
6. **The biggest lever is not a model, it is the server recorder on a busy
   public server.** A server file sees every player at 30 Hz with the server's
   own hits, impacts, winner and capture timers. None of the 2026-11-01 records
   (`hg`, `i`, `ps`, `cpt`, `hm`, the winner on `gameStatus`) is in any public
   file yet (M).

## What a recording holds

A recording is newline-delimited JSON, one object per line, format version 5 in
all 42 public files (M). The row tables are in
`features/round-replay-capture/README.md` (sections 9, 14 to 20, the client
recorder, bf42plus) and `features/server-replay-recorder/README.md` ("What it
writes", the server recorder). The one reader is
`tools/bf1942-models/viewer/replay-recording.js` `parseRecording`.

### Two sources

| | Player recording (`plus: "2.0"`) | Server recording (`plus: "server-replay-recorder/3"`) |
|---|---|---|
| Sees | own side everywhere; the other side and empty hulls within the level's view distance plus 20 m of the recording player (Wake 520 m, Bocage and Kursk 420, Berlin 120) (R: `round-replay-capture` section 19) | every object, whole map |
| Sample rate | 10 Hz header; measured median gap 0.104 s, p99 0.22 to 0.36 s, 0.3 to 0.5% of gaps over 1 s (M) | 30 Hz header; measured median gap 0.034 s (M) |
| Events (kills, joins, seats, kits, captures, tickets, chat) | whole map | whole map |
| Hits | inferred from hit point drops | the server's own: `hg`, `i` |
| In the public feed | 41 files (M) | 1 file, 185 s (M) |

Replicated share of human players' time in the world, on the 17 player
recordings that flag the recording player: own side 98.9%, other side 52.4%
(per file 31% to 93%, median 56%) (M). The repo measured 54 to 90% on three
earlier files (R: `round-replay-capture` section 19).

### Fields, per entity

Coordinates are the game's world frame in metres: x east, y up, z north; the
viewer's level frame negates z (`viewPosition`, `viewRotation`) (R:
`replay-recording.js`). Heights are above map zero, not above ground (R:
`features/dogfight-recordings/README.md`, "Open"). `t` is seconds since the
file opened, to the millisecond. The header's `start` is local time with no
zone (R: `features/recording-stats-round/README.md`).

| What | Row | Carries | Quality |
|---|---|---|---|
| Any networked object | `o`, `s`, `d` | net id, template, team, `maxhp`; position to 0.01 m and rotation quaternion, written on change | exact at the sample; a client sample can be the client's own zero-input step between two server updates (R: section 19) |
| Hit points | `a` | hp per armoured object and per soldier (soldiers `maxhp` 30), on change | exact value; damage is the delta. Last hitter is -1 on a client, real on a server (R: section 9) |
| Player | `createPlayer`, `setTeam`, `p`, `control`, `enterVehicle`, `exitVehicle` | name, team, bot flag, the object controlled, the hull's root id and seat number, and the fire and altfire trigger flags | exact; a pid is reused when a player leaves, so identity is `playerAt(pid, t)` (R: `replay-recording.js`) |
| Soldier body | `st`, `anim` | lower and upper animation state, aim pitch, torso twist, held item, state bits (zoomed, chute) | view yaw and pitch rebuilt from twist times -3 and pitch times 2.5 (R: section 16). 13 of 42 files have no `anim` table, so stance cannot be read there (M) |
| Turrets and guns | `jn`, `j` | each moving part's rotation in its hull's frame: `ShermanTower`, `ShermanGunBase` and so on | exact. 1,396 of 1,913 tank lives carry turret keys (M). Aircraft have no control-surface parts: a Spitfire names none, a BF109 only its air brakes (M) |
| Engines | `g` | revs, throttle servo, running, disabled, gear | exact. Land hulls' throttle is seven steps from -1 to 1; aircraft -3000 to 5000 (M) |
| Shots | `f` | shooter, firing object, weapon template, muzzle position and direction | one per trigger pull on a client, one per barrel on a server. A remote player's single tap can be missed (R: section 14). 377,852 in the 39 rounds (M) |
| Kills and score | `e:score` | killer, victim, weapon (13,869 of 14,609 kills name it (M)), kind (kill, team kill, death, capture) | exact, whole map |
| Round-end tallies | `e:roundStats` | per player and per weapon or vehicle template: rounds fired, hits, objects destroyed | the server's own count, whole map. In 31 of 39 rounds (M) |
| Flags | `cp` | each control point's name, place and owner, on change | exact, whole map. 1,066 captures (M) |
| Tickets | `tk` | both sides' counts, on change | exact. In 39 of 42 files, a median 824 rows a round (M) |
| Round status | `e:gameStatus`, `e:clock`, `e:gameRules` | pregame, playing, over; time limit; ticket ratio; friendly fire | a client file has no winner field; the winner is read from the last tickets |
| Chat and radio | `chat`, `e:radio` | the line as shown, the radio message id | 7,917 chat lines in the corpus (M) |
| Hit direction, refills | `e:hitFrom`, `e:special` | the recording player's own on a client | every player's on a server |

Server only (R: `server-replay-recorder/README.md`): `hg` (each hit the server
credits), `i` (each projectile collision: shooter, origin, impact point, struck
object, damage flag), `pn`/`pj`/`pd` (projectile flights), `ps` (score board
counters), `cpt` (capture state and timers), `lod` and `bai` (bot detail and
behaviour), `heal`, `am` (magazines), `spawnPick`, `scoreTable`, and
`gameStatus` with `winner` and `victory`.

### What is not there

- **Control inputs.** No stick, pedal or mouse words. What exists is the
  result: attitude, throttle servo, turret and gun angles, trigger flags,
  stance. For aircraft this means stick input must be inferred from attitude
  change against the flight law (I).
- **Where a pilot or driver was looking.** No camera or free-look. A tank's
  turret bearing is the nearest proxy.
- **Which hull face or body part a hit struck, and the damage of one hit.** The
  client's `score` row carries a `bodypart` field the parser does not read (R:
  `features/battle-schools/infantry.md`). A server `i` point could be cast
  against the hull mesh; nobody has built that (R:
  `features/battle-schools/tanks-engine.md` section 7).
- **The other side out of range**, in a player recording. Its kills, seats and
  kits are still heard; its positions are not. Of all kills, the victim's
  position is known for 87%, the killer's for 86%, both for 74% (M).
- **Spawn choice, capture timers, bot state**, in a player recording.
- **Anything from 2026-11-01 onward in practice.** No public file has `hm`,
  `hg`, `i`, `ps` or `cpt`, and no file has the winner on `gameStatus` (M).
  38 of the 41 player files were written by recorder builds from before
  2026-10-18 (no build stamp) (M).

### Size

| | Raw | Gzip (as stored) |
|---|---|---|
| All 42 files | 1,036 MB, 3.95 million lines | 245 MB |
| A full round (over 10 minutes), median | 26.4 MB, 0.98 MB per minute | 6.2 MB, 0.22 MB per minute |
| Largest | 48.0 MB | 12.3 MB |

All (M). A server file is denser: 26.6 MB for 8 minutes with 30 bots (R:
`server-replay-recorder/README.md`, "Cost"). Parsing is not a constraint: all
42 files parse in 17 s, the dogfight extractor takes 17 s and the tank
extractor 30 s on the trial machine, peak 0.96 GB (M).

## The measured data inventory

Feed read on 2026-11-10: `totalCount` 39 round cards, `recordingCount` 42,
245.5 MB of a 20 GB quota. First recording 2026-09-27, latest 2026-11-09:
about 6 rounds and 3 hours a week (M).

| Split | Rounds | Hours |
|---|---|---|
| Player recording (lead of the round) | 38 | 17.7 |
| Server recording | 1 | 0.05 |
| Vanilla (`bf1942`) | 24 | 10.2 |
| FHSW Europe (`fhsweurope`) | 13 | 7.0 |
| Road to Rome, Secret Weapons | 2 | 0.6 |
| Conquest | 34 | 16.1 |
| CTF | 3 | 1.3 |
| TDM, unknown | 2 | 0.4 |

31 distinct mod and level pairs. Bocage has 4 rounds (3 conquest, 1 CTF),
Berlin 3, Market Garden, Liberation of Caen and Midway 2 each, every other map
1 (M). Three servers supply 35 of the 39 rounds. Thirteen uploader names; one
uploaded 15 of the 42 files and three uploaded 28 (M).

| Distinct human names in a round | Rounds |
|---|---|
| under 10 | 3 |
| 10 to 29 | 10 |
| 30 to 49 | 13 |
| 50 to 69 | 9 |
| 70 or more | 4 |

Median 41. Nine files also hold bots (8 to 10 on one public server, 96 on the
server recording) (M). Five recordings are under 10 minutes.

### People

797 distinct human names; 736 spend time in the world. 428 appear in one round
only, 63 in five or more (M). Human time in the world is 418 player-hours:

| Role (sampled at 1 Hz) | Player-hours | Of it, replicated |
|---|---|---|
| On foot | 250.0 | |
| Pilot (root seat of an aircraft) | 36.8 | 24.7 |
| Tank driver (root seat of a tank) | 49.3 | 39.6 |
| Other root seats (cars, boats, ships, fixed guns, unclassified mod hulls) | 58.7 | |
| Passenger or gunner | 23.6 | |

| Replicated minutes in the seat | Pilots | Tank drivers |
|---|---|---|
| any | 282 | 359 |
| 5 or more | 85 | 127 |
| 10 or more | 42 | 72 |
| 30 or more | 7 | 12 |
| 60 or more | 2 | 3 |

The ten most-recorded pilots hold 27% of the pilot time, the ten most-recorded
tank drivers 22% (M). Pilot time is 19.5 h vanilla and 4.3 h FHSW Europe; tank
time is 19.8 h and 18.9 h (M).

Kills by a human: 14,527, of them 9,125 on foot, 2,112 from a tank's driving
seat and 1,307 from a pilot's seat. 36 pilots have 10 or more air-seat kills,
62 tank drivers 10 or more (M).

### Engagements, from the repo's detectors

Run on all 42 files, counted on the 39 round leads (M):

| | Air (`dogfight-detect.js`, rules v2) | Tank (`tank-fights-detect.js`, rules v1) |
|---|---|---|
| Fights | 361 (212 dogfights, 149 bounces) | 425 |
| Decided by a kill between the two | 122 | 217 |
| Both sides shot | 27 | 166 |
| Both shot and one died | 6 | not counted here |
| Total fight time | 110 minutes, median 16 s | median 13.5 s (R) |
| Where | 14 levels; El Alamein 113, Battle of Britain 63 | 27 rounds; Tobruk 84 |
| People in a fight | 160 | 216 |
| In 5 or more fights | 54 | 65 |
| In 10 or more | 16 | 16 |
| With 5 or more decided fights | 12 | 22 |
| With 10 or more decided fights | 3 | 5 |
| Types | BF109 163 sides, Spitfire 102, Mustang 99, Zero 86, Yak9 53 | 69 templates; Sherman 193, PanzerIV 185, Tiger 64, T34-85 57 |
| Shots | | 2,395 main-gun, 1,353 aimed, 777 credited hits; kill range median 89 m |

One pilot is in 53 of the 361 air fights and 25 of the 122 decided ones: the
uploader bias the dogfight page already found (R:
`features/dogfight-recordings/README.md`).

### Rounds

Of 34 conquest rounds, 28 reach the round's end with tickets recorded and 17 are
seen from start to end. Axis won 12, Allies 16; 17 ended with a side at zero, 11
on the clock. The 28 are on 25 maps, at most 2 on one (M).

### Is it enough

| Goal | Now | What would be enough (I) |
|---|---|---|
| Pilots: what state wins an engagement | Yes for pooled questions with wide intervals (122 decided fights). No per plane pair, no per pilot | About 500 decided fights for a 10-feature model across types; about 100 per plane pair for pair tables |
| Pilots: rating individuals | No (3 pilots with 10 decided fights) | 12 to 36 decided duels per pilot (W: TrueSkill needs about 12 games for 1v1 and "up to three times" more) |
| Pilots: cloning ace flying into bots | No (1.8 h engaged, 24.7 h flying, many types) | About 100 h of state traces for one setting (W: MLMove, 123 h, one map) |
| Tanks: range, first shot, facing, lead | Yes, pooled (217 decided, 2,395 shots) | The same again per weight class to split by match-up |
| Tanks: where to stand on a map | No (one round on most maps) | 20 or more rounds per map, or server recordings |
| Round tactics: learned win probability | No (28 rounds, 25 maps) | 50 decided rounds per map for a three-feature model; several hundred pooled with map effects |

At about 6 rounds a week the pooled pilot and tank numbers double in about six
weeks; the per-map numbers do not arrive in any useful time without a server
recorder on a public server (I).

## What is already extracted

All of it is plain ES-module JavaScript that already runs headless in node on
an `.ndjson` or `.ndjson.gz` file through the one parser. Nothing analytic is
in C# or Python (R, confirmed by reading the code).

| Extractor | Code (under `tools/bf1942-models/`) | Gives | Batch-ready |
|---|---|---|---|
| Parser | `viewer/replay-recording.js`, loaded in node through `sim/env.mjs` | lives, control spans, seats, fires, kills, hp, joints, engines, stances, flags, tickets, round stats, with helpers `playerAt`, `rootOf`, `crewOf`, `isReplicated`, `flownPositionAt`, `aimAt` | Yes. Whole file in memory, about 130 MB plus five times its size. Drops `bodypart` and the `a` row's last hitter |
| Dogfight detector | `viewer/dogfight-detect.js`, CLI `extract_dogfights.mjs` | fights with both planes at 10 Hz, shots, evidence, ending | Yes; it is the daily job (`dogfights/refresh.mjs`, at the repo root) |
| Manoeuvre features, names, scores | `viewer/dogfight-manoeuvres.js`, `dogfight_manoeuvres_report.mjs` | per tick and side: speed, climb, pitch, bank, turn rate, prop revs, energy height, range, angle-off, the other's angle-off, closure, situation, firing; 21 named manoeuvres; before and after scoring | Yes on extracted fights. `features()` is not written to disk; add a writer |
| What-if on the flight law | `viewer/dogfight-whatif.js`, `viewer/dogfight-duel.js`, `viewer/aircraft.js` | nine alternative escapes flown for 8 s from a recorded state | Spitfire only in node (a hand-built fixture) |
| Tank fight detector | `viewer/tank-fights-detect.js`, CLI `extract_tank_fights.mjs` | fights with hulls at 5 Hz, hull yaw, turret yaw, hp, every main-gun shot with speed, gravity, miss, range | Yes; same job |
| Tank armour and ballistics | `viewer/tank-armour.js`, `viewer/tank-ballistics.js`, `surveys/tank_school_pairs.mjs` | where to aim, drop, lead, from the models (not from recordings) | Yes |
| Accuracy rebuild | `viewer/replay-accuracy.js` | shot-to-hit attribution, who fired at whom, range buckets | Yes, no CLI |
| Kill facts, Shorts picker | `viewer/replay-dossier.js` `killFactsOf`, `viewer/replay-shorts-pick.js` | killing round, distance, kill class (air-to-air, tank-to-tank, tank-buster, long shot) | Yes, no CLI |
| Activity, battles, standouts | `viewer/replay-battles.js`, `viewer/replay-medals.js` | weighted activity points, clustered battles, `whereIs`, behind-lines and sniper-nest detectors | Yes, no CLI. Output is in the viewer frame |
| Fronts | `viewer/replay-fronts.js` | activity by nearest flag, surges, people at a fight | Yes, no CLI |
| Merge | `merge_replays.mjs` | two recordings of one round on one clock | Yes |
| Terrain and line of sight | `viewer/heightfield.js`, `viewer/world-collider.js`, `viewer/bot-sense.js` `lineClear`, loaders `server/level-load.mjs`, `sim/level.mjs` | height at a point, ray casts against terrain, water and statics | Run headless; never wired to a recording |

Findings these already produced, to cite rather than rediscover (R):

- Air, 289 fights under rules v1: first shooter won 97 of 104 kills; a break
  turn left the breaker better placed 62% of the time and still losing 41%;
  the same move wins with an energy lead and loses without (low yo-yo 49% won
  with more energy, 15% with less) (`features/dogfight-recordings/README.md`).
- Tanks, 369 fights: first to fire won 141 of 183; when both fired, 36 of 74;
  median kill range 85 m (`features/battle-schools/README.md`, "The first
  run").
- Accuracy rebuilt from a player recording ranks players like the server's
  tally (Spearman 0.73 to 0.97 a round), with hits undercounted for vehicles
  (71%) and aircraft (42%) (`features/replay-accuracy/README.md`).
- The Spitfire's flight law measured: full pull 31 deg/s at 40 m/s and 61 at
  70, hardest sustained turn about 39 deg/s at 46 m/s
  (`features/dogfight-school/README.md`).

The tank school's own wish list is the feature list for goal two: first line of
sight and by how many seconds, face and aspect per hit, exposure seconds,
stationary when firing, circling before the kill, killed by an unseen tank (R:
`features/battle-schools/tanks-tactics.md`, "What to measure from real
rounds"). The dogfight page already asks for "a model that predicts the outcome
from the opening geometry and the manoeuvres flown" (R:
`features/dogfight-recordings/README.md`, "Next: what wins").

What needs writing for batch use: thin CLIs or one exporter around the modules
with no CLI, a writer for the per-tick feature vectors, the terrain glue, and
nothing else. No port to another language is needed.

## Skill labels

### What exists

Inside a recording:

- Engagement outcomes from the detectors: killed, was killed, left alive, hits
  and aimed shots per side.
- Kills and deaths with the weapon and the seat the killer was in.
- `roundStats`: per player, per weapon or vehicle template, rounds fired, hits
  and objects destroyed. It is the server's count, covers the whole map even
  in a player recording, and is in 31 of 39 rounds (M). This is the only
  per-vehicle, per-weapon skill signal anywhere in the system.
- Time alive in a hull, hit points lost, from `a` rows and seat spans.

Outside, the site's long-run statistics (R: `api/PlayerTracking/`,
`api/Data/Entities/`, `api/Bflist/Models/PlayerInfo.cs`):

- The source is the BFList feed polled every 30 s: name, score, kills, deaths,
  ping and team. **There is no per-vehicle, per-weapon or per-kit data.**
  `features/service-record/README.md` says so too.
- Aggregates: K/D, kills per minute, score, rank per server per month, per-map
  stats, wins and losses per team label. Public at `/stats/players/{name}`,
  `/stats/leaderboard`, `/stats/data-explorer/...`.
- A round stores final tickets and team labels, no winner (derived as the
  higher count) and no ticket history.
- No Elo, TrueSkill or other rating exists in the code.
- The 30-day leaderboard's top K/D is on a co-op server, so any long-run label
  needs the populated-server filter (M, one GET).

### Identity

`Player.Name` is the primary key; there is no GUID. A recording writes each
name byte as U+0000 to U+00FF and the database holds the same bytes read as
cp1252, so they differ only for bytes 0x80 to 0x9F:
`api/Utils/PlayerNameDecoder.cs` `FromRecording` converts, and `Decode` (the
display decoder) must not be used for joins (R). The recordings API trims
names; join from the raw file. On one checked round, 49 of 49 human names
joined to the stats round and the 8 bots were absent from stats (M, recording
`64q2x93wxq`). A changed name is a new player; clan tags are part of the
name. A recording is tied to its stats round by server, level, time and shared
players (`api/Recordings/StatsRoundMatcher.cs`; 38 of 39 cards carry a
`statsRoundId` (M)).

### Labels to use

1. **Engagement outcome, not a global rating.** The unit is one fight and the
   label is who won it. This needs no opinion about who is good.
2. **Per-weapon accuracy from `roundStats`** as the per-round skill signal for
   gunnery in a given vehicle: hits over rounds fired for `Spitfire` guns, for
   `ShermanGunBarrel`. It exists today and needs no reconstruction.
3. **A rating computed from engagements, later.** Bradley-Terry or OpenSkill
   over decided one-on-one fights per vehicle class, with the vehicle pair as
   a covariate and a prior that shrinks sparse players to the middle. With 3
   pilots and 5 tank drivers at ten decided fights it is not usable yet; treat
   it as a covariate with an interval, never as a ranking (I; W for the data
   need: https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/).
4. **Long-run K/D percentile on populated servers** as a weak control for team
   strength in the round model, not as a label for pilots or tank drivers. It
   cannot tell a good pilot from a good rifleman.
5. **Productivity per vehicle life**: kills per life, life length, hp lost per
   minute exposed.

## The three approaches

### Pilots

**Question, testable.** When two opposed aircraft come within range of each
other, what about the state before anyone fires predicts who gets the first
aimed shot and who dies? Which of it is position, which energy, which type?

**Unit.** The encounter: two opposed, piloted, replicated aircraft within
1000 m, from first approach to separation, whether or not anyone shoots. This
is new. The existing detector needs three aimed shots to call a fight, which
selects on the outcome; passes where nobody got a shot are the missing
negatives (I). Inside an encounter, ticks at 10 Hz in the relative frame.

**Features.** From `dogfight-manoeuvres.js` `features()` and
`dogfight-pilot.js` `geometry()`: range, closure, angle-off, the other's
angle-off, aspect, energy height difference, speed, climb rate, bank, turn
rate, prop revs (throttle). To add: height above ground (the heightmap);
fraction of the airframe's available turn in use at that speed (the flight law
in `viewer/aircraft.js`, measured for the Spitfire only); the type pair; other
enemies within 600 m (15 of El Alamein's fights ended "downed by another" (R));
whether the plane was replicated throughout.

**Labels.** First aimed shot, kill, survived, time to kill; per tick, "has a
firing solution within 5 s".

**Baseline without ML.** Counts. From the pilot run for this page on the 122
decided fights (M):

| Seconds before the first aimed shot | Winner had more energy height | Winner had the smaller angle-off | Median range |
|---|---|---|---|
| 1 | 69% | 92% | 213 m |
| 2 | 70% | 92% | 243 m |
| 4 | 66% | 81% | 290 m |
| 6 (n 115) | 64% | 63% | 284 m |

The first to fire won 93% (cluster-bootstrap interval by recording 90 to 97%);
more energy 2 s before, 60 to 79% (both on the 123 decided fights of all 42
files). So the shooting phase is nearly decided
when it starts, the positional advantage is built in the last six seconds, and
the energy advantage is there earlier. Only 6 decided fights had both pilots
shooting. What is worth learning is the approach, not the turning fight (I).

**Model family.**

1. Regularised logistic regression on the opening state, validated leave one
   recording out and leave one pilot out. A two-feature version (energy
   difference, angle-off difference at 2 s) already scores AUC 0.93, log loss
   0.33 leave-one-recording-out (M), nearly all of it angle-off, which is close
   to restating "the one about to shoot wins". The honest test is the state at
   10 to 20 s before, which needs the encounter table.
2. LightGBM on the tick-level label once there are about 500 encounters.
3. Manoeuvre discovery: cut tracks at change points in turn rate and climb,
   describe each segment by a fixed vector (heading change, height change,
   speed change, bank profile, duration), cluster with HDBSCAN, and compare
   with the 21 hand-named manoeuvres as weak labels (adjusted Rand index).
   Dynamic time warping (`dtaidistance`) as the second opinion. Prior art uses
   the same segment-then-cluster shape (W:
   https://doaj.org/article/46e64d9baa09493bb15cd52ab03297f2,
   https://www.mdpi.com/2227-7390/10/7/1196).
4. Behavioural cloning into the bots: not now. The nearest precedent needed
   123 hours of traces for one map (W: https://arxiv.org/abs/2408.13934). The
   cheaper route is to tune the thresholds of the scripted pilots in
   `viewer/dogfight-pilot.js` `PLANS` to the measured conditional win rates and
   check them in the what-if harness.

**Evaluation.** Log loss and a calibration plot, grouped splits by recording
and by pilot, cluster bootstrap by recording, and every finding repeated
without the most-recorded pilot, as the dogfight page already does.

**Output for the owner.** A chart in the dogfight school of win rate by energy
and position at the merge; a plane-pair table when counts allow; lessons
ordered by measured effect; `PLANS` thresholds for the bots.

### Tank commanders

**Questions, testable.**

- Does the tank that fires first win because it saw first, or because it was
  stationary, pre-aimed and partly covered?
- At what range, target crossing speed and own speed does a first shell hit?
- Which arc of the hull (front, side, rear) faces the shooter when a tank is
  hit, and how does that change survival?
- How long does a tank live per minute it is exposed to an enemy gun?

**Units.** The tank fight (425, 217 decided), the main-gun shot (2,395 in
fights), and the tank life (1,913) (M).

**Features.** Already in the extract: range, hull yaw, turret yaw on the hull,
hp over time, each shell's speed, gravity, miss distance and range, weight
class, who fired first. To add, all computable today:

- **Aspect.** The angle between the shooter's bearing and the target's hull
  yaw at the shot, binned to front, side, rear. Position and yaw are recorded.
- **Turret readiness.** The turret's bearing error to the enemy at first line
  of sight and at each shot. Turret keys are on 73% of tank lives (M).
- **Line of sight and hull-down.** Load the level (`sim/level.mjs`), build the
  collider, and cast from the shooter's muzzle to the target's hull bottom and
  turret top (`bot-sense.js` `lineClear`): first mutual line of sight, seconds
  exposed, and the share of the hull hidden. Terrain is `terrain/heightmap.png`
  in each level bake (`dim`, `spacing`, `heightUnits` in `scene.json`), statics
  are in `scene.glb`. Bushes stop nothing (R: `tanks-engine.md`).
- **Movement.** Own speed at the shot, stationary seconds before it, target
  crossing speed.
- **Company.** Friendly and enemy tanks within 100 m; distance to the nearest
  flag held by each side.

**Labels.** Win, loss or disengaged; first hit; hit per aimed shot; life
length.

**Model family.** Descriptive tables with intervals first. Then logistic
regression with weight-class match-up as a fixed effect, then LightGBM on
per-shot hit probability (range, crossing speed, own speed, turret settle
time). Position value on a map (kill origins against death places) is a kernel
density per map and needs many rounds of that map.

**Baseline without ML.** First to fire won 141 of 183; when both fired it is a
coin toss, 36 of 74 (R). The model has to beat "shoot first".

**Evaluation.** Leave one recording out; per-shot models also leave one driver
out. Check hit attribution against the server's `i` rows as soon as a server
recording with humans exists.

**Data.** Enough for pooled aspect, range and first-shot questions now. Not
enough for per-map positions.

**Output for the owner.** The tank school's "Duck, Flank, Ghost" scores on
real fights; a hit-probability curve by range and crossing speed; aspect-at-hit
bars; heatmap layers in the map viewer when a map has the rounds; a tank crew
policy for the bots, which does not exist yet (R: `tanks-engine.md` section 6).

**Known traps.** Per-level gun overrides are not read (Kasserine's guns fly
300 to 500 m/s against the 100 assumed) (R). Hits in a player recording are
inferred from hp drops. FHSW's 69 templates spread the data thin.

### Round-winning tactics

**Question, testable.** For conquest: given the state at time t, what is each
side's chance of winning, and which changes of state (a named flag changing
hands, a tank or plane destroyed, a front collapsing) move it most on this map?

**Unit.** The round-second for the state table. The effective sample size is
the number of rounds, since seconds within a round are almost copies of each
other (W: https://arxiv.org/abs/2011.01324 notes the same for Counter-Strike).

**Features.** Ticket share remaining per side, flags held and which, time left,
players per side, crewed vehicles per class per side, where each side's people
are by front (`replay-fronts.js`), and a team-strength prior from each roster's
long-run statistics.

**Labels.** The winner from the last tickets (a player recording) or
`gameStatus.winner` (a server recording).

**Baseline without ML, measured on the 28 decided rounds (M).**

| Point in the round | Raw ticket leader went on to win | Side holding more flags went on to win |
|---|---|---|
| 10% | 16 of 28 | 11 of 22 |
| 25% | 18 of 28 | 14 of 22 |
| 50% | 20 of 28 | 17 of 23 |
| 75% | 21 of 28 | 17 of 24 |

With 28 rounds, 20 of 28 is an interval of roughly 53 to 85%. Nothing learned
from 28 rounds will be distinguishable from these baselines.

**What to do instead, in order.**

1. **A mechanistic projection.** Conquest tickets are arithmetic: bleed from
   flags held plus one ticket per death. The rules are in the ledger (`TKT`
   rows) and already implemented for the replay in `viewer/round-state.js` (R:
   `round-replay-capture` section 17). Project each side's time to zero from
   the current bleed and the recent death rate. This needs no training, runs on
   one round, and gives the first attribution: flipping flag X changes the
   bleed by so many tickets a minute for as long as it is held.
2. **Priors and confounders from the stats database.** It has 32,826 conquest
   rounds with 20 or more participants lasting 10 minutes or more, 2,717 of
   them on Bocage (M, the public rounds API): map, team labels, final tickets,
   per-minute score boards. Fit win rate by map and side, the effect of player
   count imbalance, and the effect of roster strength (each team's mean
   long-run kills per minute), with a mixed model. That is the model of
   everything that is not tactics.
3. **Descriptive tactics from recordings.** Per map: capture order, hold time
   per flag, where fights were (`replay-fronts.js`), vehicle use. Presented as
   what happened in the rounds held, not as what wins.
4. **A learned win probability over recorded state**, only when a map has
   about 50 decided rounds or the pooled set several hundred. Gradient-boosted
   trees with a calibration check, as the Counter-Strike work found best (W:
   https://arxiv.org/abs/2011.01324), and attribution as the change in win
   probability across an event (W: https://arxiv.org/abs/1802.07127).

**Confounding, stated plainly.**

- **Team stacking.** Strong players choose a side. Control with roster
  strength from the stats database; a win credited to a tactic may be the
  roster.
- **Player-count imbalance.** One ticket per death scales with players.
- **Side asymmetry.** Many maps start unequal (Manchuria 868 tickets against
  1323, Market Garden 1150 against 1000 at the round's start (M)). Compare
  within map and side only.
- **Snowballing.** Holding flags causes bleed which causes the win; a flag
  count at 75% is partly the result. Attribute on changes, not levels.
- **The recorder's side is seen better.** Force distribution for the other
  side is 52% observed and biased toward the recording player. Use merged
  pairs or server recordings for any feature that counts enemy positions.
- **Selection.** Uploaders choose which rounds to share.

No published win model for Battlefield-style conquest was found (W, search on
2026-11-10).

**Output for the owner.** A projected-result line on the replay's ticket chart;
a per-map flag value table (bleed swing times typical hold time); a "what
decided this round" paragraph in the round report; later, flag priorities for a
bot doctrine.

## The data pipeline

```
feed (GET /stats/recordings) -> raw/<slug>.ndjson.gz + manifest
  -> node exporter (viewer parser + detectors) -> tables/<slug>/*.jsonl
  -> DuckDB -> Parquet, partitioned by mod and level
  -> Python: features, models, charts
```

**The parser to build on is `viewer/replay-recording.js`, in node.** It is
3,234 lines of settled edge cases (reused pids, stale samples after leaving a
vehicle, v4 part keys, merged files) and the replay's tests hold it. A Python
reimplementation would drift from it. Node writes flat JSONL; DuckDB turns
JSONL into Parquet; Python never parses a recording (I).

**Stages.**

1. **Sync.** Page the feed (`pageSize` 48 at most), download each
   `recordingUrl` as stored (gzip), record slug, content hash, source, mod,
   level, `statsRoundId` and the round card in a manifest. Incremental. Drop
   slugs the feed no longer lists.
2. **Choose per round.** One recording per round card: a server recording if
   there is one, else a merged pair when both sides recorded
   (`merge_replays.mjs`), else the longest.
3. **Export** (one node script, new): parse once, write the tables below, run
   the two fight detectors and `features()` on the result. Pin the catalogues
   it reads (`models.json`, `vehicle-ai.json`, the gun cache) into the dataset
   with their hashes so a run does not depend on the network.
4. **Terrain join** (node, new): per level, load the bake, sample height under
   each kept position, and cast lines of sight for engagement pairs.
5. **Load** into DuckDB and write Parquet.

**Tables.**

| Table | Grain | Main columns |
|---|---|---|
| `recordings` | file | slug, hash, source, recorder build, mod, level, mode, server, start, duration, sample rate, recording player, has `anim`, has `tk`, has `roundStats`, stats round id |
| `rounds` | round | lead recording, start seen, end seen, winner, how it ended, tickets at start and end, humans, bots |
| `players` | session | player key, team, bot flag, joined, left |
| `seat_spans` | player in a seat | root id, template, class (foot, air, tank, other), seat, from, to, replicated share |
| `samples` | controlled object at 2 Hz | position, rotation, velocity, hp, class, replicated flag, height above ground |
| `state_1s` | round-second | tickets, each flag's owner, alive and crewed counts per side and class |
| `kills` | kill | killer, victim, weapon, both classes, both positions, distance, whether each was replicated |
| `shots` | `f` row | shooter, weapon, muzzle position and direction, class |
| `hp_events` | hp change | object, delta, credited shooter where known |
| `captures`, `tickets` | event | as recorded |
| `accuracy` | player by weapon template | fired, hits, destroyed (from `roundStats`) |
| `air_encounters`, `air_ticks`, `air_manoeuvres` | encounter, tick, manoeuvre | the feature vector above; names and scores |
| `tank_fights`, `tank_ticks`, `tank_shots` | fight, tick, shot | hull and turret yaw, hp, aspect, line of sight, miss, range |

At 2 Hz the `samples` table for all 418 player-hours is about 3 million rows
(I); the whole store fits in memory many times over.

**Versioning and reproducibility.** Key every derived row by the recording's
content hash, the repo commit, and each rule set's version (`RULES.version` 2
for air, 1 for tanks, `M_RULES` 1 for manoeuvres). Changing a detector bumps
its version and re-derives only its tables. Seeds fixed; splits grouped by
recording and by player key, stored as a table, never re-drawn.

**Where it runs.** On the laptop only. Not on the production node: it is one
4-CPU, 7.7 GB machine with no room (R: `CLAUDE.md`, "Deployment constraints").
Code under `tools/` (suggested: the exporter beside the other extractors in
`tools/bf1942-models/`, the Python in `tools/recording-ml/`); data outside the
tracked tree.

**Parser gaps worth closing first.** Read `bodypart` on `score` rows and the
last hitter on `a` rows (both already written by the server recorder).

## Local stack for the trial

The trial machine today: Apple M5 Max, 48 GB, Python 3.13; no numpy, DuckDB,
uv or Ollama installed (M).

**Numeric work, which is all of the modelling.**

| Need | Use | Version on 2026-11-10 (W, PyPI) |
|---|---|---|
| Store and query | DuckDB, Parquet via PyArrow | 2.0.0 LTS, 26.0.1 |
| Dataframes | Polars | 2.1.0 |
| Baselines, logistic, calibration, grouped CV | scikit-learn | 1.9.1 |
| Boosted trees | LightGBM (CPU) | 4.7.0 |
| Mixed models for the round priors | statsmodels | not checked |
| Ratings | openskill | 6.2.0 |
| Trajectory distance and clustering | dtaidistance, hdbscan, umap-learn | 2.5.1, 0.8.44, 0.5.12 |
| A small-table cross-check | TabPFN | 9.2.0; runs on Apple silicon; weights after v2 are non-commercial (https://github.com/PriorLabs/TabPFN) |
| A sequence model, if ever justified | PyTorch on MPS | 2.15.0 (https://pytorch.org/blog/pytorch-2-15-release-blog/) |

All have native Apple-silicon wheels. PyTorch MPS over MLX for a small model:
no benchmark found favours either at this size, and every library above that
needs a tensor backend uses PyTorch (W). MPS has no float64; keep features in
float32. None of this needs the GPU at today's data size.

**The LLM layer, optional.**

- **What it is good for here.** Writing SQL over the DuckDB tables from a
  question, with the schema in the prompt and the reply constrained to a JSON
  schema (Ollama supports this: https://docs.ollama.com/capabilities/structured-outputs);
  turning a computed table into lesson or report text, with every number
  passed in; proposing names for manoeuvre clusters from their summary
  statistics.
- **What it is not good for.** Reading trajectories, predicting outcomes,
  finding patterns in rows, arithmetic. Removing the LLM from LLM-based
  forecasters leaves results equal or better (W: https://arxiv.org/abs/2406.16964);
  trees still beat deep and language models on mid-sized tables (W:
  https://arxiv.org/abs/2207.08815); DeepSeek R1 scored about 57% on a
  25-task table benchmark against about 69% for the best model (W:
  https://arxiv.org/abs/2506.05587).
- **DeepSeek on this laptop.** In the Ollama library the only DeepSeek models
  that run locally are the R1 distills: 14b 9 GB, 32b 20 GB, 70b 43 GB at the
  default quantisation. On 48 GB, `deepseek-r1:32b` fits; 70b does not in
  practice. V3 and V3.1 are 404 GB; V4 is cloud-only. The R1 entries are over a
  year old (W: https://ollama.com/library/deepseek-r1/tags).
- **Better current picks at the same size** (W): `qwen3.8:27b` (18 GB),
  `gemma4:26b` or `31b` (18 to 20 GB, Apache 2.0), `gpt-oss:20b` (14 GB,
  Apache 2.0, built for structured output). Ollama is 0.40.16 and now carries
  MLX builds of some models (https://ollama.com/blog/mlx).
- **Rule.** The LLM never sees raw rows and never produces a number that is
  not in a table handed to it. Keep 30 questions with known SQL answers as its
  test. Use only local models: a cloud tag would send players' data off the
  machine.

## Privacy and consent

What is true today (R, from the code and pages):

- Recordings are public files with every player's raw name, bot flag and chat.
  Only the uploader chose to share; everyone else in the round did not.
- The privacy page (`ui/src/views/v4/PrivacyV4.vue`) covers polled statistics
  under legitimate interests and does not mention recordings. No consent step
  at upload and no opt-out for a player named in someone else's recording were
  found. Removal of a name's statistics is a manual request.

What a research pipeline should do:

- **Local only.** Raw files, tables and models stay on the laptop, outside the
  tracked tree. Nothing is uploaded, and no cloud model is used.
- **Pseudonymise at ingest.** Tables carry a keyed hash of the raw name; the
  key and the name map stay local. The join to the stats database happens once
  and stores only the derived covariates.
- **Leave chat out.** None of the three goals needs chat text. Keep a count if
  anything.
- **Aggregate outputs.** Publish findings about situations, types and maps: a
  cell needs at least 5 players and 20 engagements behind it. A finding that
  one person dominates is reported as "one pilot", as the dogfight page does.
- **No per-player behavioural profiles or skill rankings published without a
  decision.** A rating computed from engagements is an inference about a named
  person. Using it as a model covariate is one thing; a public pilot ladder is
  a product decision that needs the owner's say and words on the privacy page.
- **Honour removals.** Each sync drops recordings the feed no longer lists and
  re-derives; a name removed from statistics is removed from the map.
- **Bots are not people.** Exclude `ai` players from every human-skill claim
  and keep them for bot comparisons.

A gap to note, not to fix here: the site's privacy wording does not yet cover
recordings at all.

## The link to bot support for maps without it

A sibling piece of work (`features/bot-map-generation`) is researching how to
generate bot support for maps that ship without it. This pipeline can feed it;
the hooks, not the design:

- **Where humans go.** From `samples`: per level and vehicle class, a grid of
  dwell seconds, pass counts and heading histograms. Seeds routes and checks
  generated path maps (`scene.json` `ai.searchMaps`, `pathfinding/`).
- **Where fights happen.** `replay-battles.js` battles and `replay-fronts.js`
  fronts per flag: candidates for strategic areas and choke points
  (`ai.strategicAreas`: name, points, radius, flags, neighbours; R:
  `features/bf1942-ai-spec/strategic.md`).
- **Where vehicles stop and fire.** Tank shot origins and stationary spans:
  candidates for an area's `orderPositions` per vehicle type.
- **Where boats unload and aircraft loiter.** Exit positions from landing
  craft; aircraft altitude bands and orbit centres.
- **Flag order.** Capture sequences per map as a prior for a doctrine's
  `orders(view)` (`viewer/doctrine.js`, R: `features/bot-doctrines/README.md`).
- **Validation.** Run bots headless (`sim/run.mjs`, `sim/compare.mjs`) and
  compare their occupancy grid with the humans' by earth mover's distance, the
  measure the Counter-Strike movement work used (W:
  https://arxiv.org/abs/2408.13934).
- **Learned vehicle behaviour.** Measured thresholds for the scripted pilots
  (`viewer/dogfight-pilot.js` `PLANS`) and the missing tank crew policy.

Limits to pass on: most maps have one recorded round, which seeds and does not
validate; the other side is half seen; of the 16 recorded levels whose bake
was at hand, Aberdeen and Coral Sea have no `strategicAreas` (M).

## Risks and unknowns

| Risk | How bad | What reduces it |
|---|---|---|
| Too few rounds, growing at about 6 a week | Sinks goal three as a learned model; caps goals one and two at pooled findings | The server recorder on one busy public server; prompting uploads; the stats database for priors |
| Player recordings are partial views | Biases every count toward the recorder's side and surroundings | `isReplicated` on every row; merged pairs; server recordings |
| One uploader dominates the fights | A finding may be one person's habit | Grouped splits by player; repeat without the top player |
| No inputs, no view direction | Limits "how they fly" to outcomes of control, not control | Infer from attitude against the flight law; turret bearing as the tank proxy |
| Hits inferred in player recordings | Accuracy low for vehicles (71%) and aircraft (42%) (R) | `roundStats` as the label; server `hg` and `i` when available |
| Detector thresholds are hand-set | The model learns the detector | Build encounters without a shot requirement; version the rules |
| Label noise in long-run statistics | Co-op farming, name changes, no vehicle split | Populated-server filter; use as a covariate only |
| Old recorder builds | 13 files without stance; none with `hm` | Flag per file; the recorder update notice (`features/recorder-update-notice`) |
| The flight law is measured for one type | "Fraction of available turn" exists only for the Spitfire | Build aircraft from their glbs in node |
| Mods spread the data | 69 tank templates | Model by weight class and gun, not template |

Not verified for this page:

- Whether the stats database keeps tickets through a round (only final
  tickets were found on `Rounds`), and how far back its history goes. Two broad
  queries against the public rounds API did not return and were stopped; use a
  database copy for such counts, not the live API.
- Whether a player recording can be trusted for the recording player's own
  aircraft (it is client-predicted; R: `round-replay-capture` section 9).
- Whether building an `Aircraft` for any type from its glb works in node; only
  the Spitfire fixture is proven.
- `hg`, `i`, `ps`, `cpt` and the server's winner on a round with human players:
  no such file exists in the feed.
- Web items taken from search summaries rather than the source are marked in
  the survey notes; the versions in the stack table are from PyPI on the day.

## First slice

**The air approach table.** One exporter and one notebook, on the recordings
held today.

1. Run `extract_dogfights.mjs` over the corpus (17 s) and write
   `dogfight-manoeuvres.js` `features()` per tick to JSONL.
2. Add the encounter finder: opposed piloted aircraft within 1000 m, both
   replicated, no shot required, with 20 s of lead-in.
3. Load into DuckDB. Fit the opening-state model at 5, 10, 15 and 20 s before
   the first aimed shot (or the closest approach when nobody shot): logistic
   regression on energy difference, angle-off difference, height above ground,
   type pair. Leave one recording out and leave one pilot out.
4. Deliver one chart (win rate by energy and position at each lead time) and
   one table (how early the winner's advantage appears), with intervals, and
   the same without the most-recorded pilot.

Why this one: the detectors and features exist, 122 decided fights are enough
for a pooled answer, and the pilot run already shows the shape: the winner's
position advantage falls from 92% at 2 s to 63% at 6 s before the first shot
while the energy advantage holds near 65 to 70% (M). The finding to confirm or
break is "energy is the early signal, position is taken in the last six
seconds". It can be checked three ways the repo already has: against the
manoeuvre tables' energy split, against the school's lessons, and by flying
the opening states in the what-if harness.

Done means: the table and chart exist, the grouped-validation numbers are
written down, and the finding is stated with its interval or withdrawn.

## Task list

Sizes: S half a day, M one to two days, L three to five days.

| # | Task | Size | Needs |
|---|---|---|---|
| 1 | Corpus sync with manifest and per-round choice | S | |
| 2 | Parser: read `bodypart` and the `a` row's last hitter | S | |
| 3 | Node exporter: core tables to JSONL (`recordings`, `rounds`, `players`, `seat_spans`, `samples`, `kills`, `shots`, `captures`, `tickets`, `accuracy`) | M | 1 |
| 4 | DuckDB load, Parquet layout, version keys, split table | S | 3 |
| 5 | Air: per-tick feature writer and the encounter finder | M | 3 |
| 6 | **First slice**: approach model, chart, table | M | 4, 5 |
| 7 | Terrain glue: level load, height under position, line-of-sight casts | M | 3 |
| 8 | Tank features: aspect, turret readiness, exposure, hull-down, per-shot table | L | 7 |
| 9 | Tank findings: first-shot hit curve, aspect at hit, first-fire decomposition | M | 8 |
| 10 | Round state table and the mechanistic ticket projection | M | 3 |
| 11 | Round priors from a stats database copy: map and side, player imbalance, roster strength | M | a database copy |
| 12 | Per-map descriptive tactics: capture order, hold times, fronts | M | 10 |
| 13 | Engagement ratings with shrinkage, as a covariate | S | 5, 8 |
| 14 | Manoeuvre discovery by segment clustering, against the named set | L | 5 |
| 15 | Local LLM layer: text-to-SQL and report writer, with a 30-question test | M | 4 |
| 16 | Occupancy and fire-position grids for the bot-support work | M | 3, 7 |
| 17 | Aircraft built from glbs in node, so the flight law covers every type | L | |
| 18 | Sequence model or behavioural cloning | L | about 100 h of engaged traces; not before |

Outside this list, and worth more than any item on it: a server recorder on a
public server with human players.

## How the numbers were measured

All on 2026-11-10 with throwaway scripts outside the repo; nothing was
uploaded, changed or deleted.

- **Feed.** `GET https://bfstats.io/stats/recordings?pageSize=48&sort=recent`
  (one page holds all 39 cards) and the same with `source=server`. Each card's
  `round` members were flattened to 42 recordings; a card's first item is its
  lead.
- **Files.** All 42 `recordingUrl`s downloaded as stored (gzip, 245 MB) and
  read back.
- **Census.** A node script loaded each file through
  `tools/bf1942-models/sim/env.mjs` and `viewer/replay-recording.js`
  `parseRecording`, counted row kinds by a line scan independent of the
  parser, then walked every human player at 1 Hz: `playerAt`, `controlledAt`,
  `rootOf`, `isReplicated`, with the hull classed as aircraft (`models.json`
  `category: 'air'`) or tank (the rule in `extract_tank_fights.mjs`: the AI
  data's `class: 'Land'`, `equipmentType: 0`, else `tank-arena.js` `isTank`)
  from a local copy of the mesh site's catalogues. Sample gaps are between
  consecutive samples of a replicated, moving life. Kill classes are the
  killer's seat 0.05 s before the kill.
- **Fights.** `extract_dogfights.mjs <dir> --out <scratch> --feed <feed>
  --clips none` and `extract_tank_fights.mjs <dir> --out <scratch> --feed
  <feed> --glb-cache <scratch>`, then counts over each `index.json`,
  restricted to round leads.
- **Air pilot run.** `dogfight-recorded.js` `recordedFight` and
  `dogfight-manoeuvres.js` `features()` on each decided fight; the winner's
  and loser's rows at N seconds before the first evidence; cluster bootstrap
  over recordings (2,000 draws); a two-weight logistic fit by gradient descent,
  leave one recording out. The lead-time table is on the 122 decided fights of
  the round leads; the bootstrap and the logistic fit are on the 123 of all 42
  files (one comes from a second recording of a round already counted).
- **Round baseline.** A Python line scan of `tk`, `cp` and `gameStatus` rows:
  the winner is the higher count at the first status 2; the leader at each
  fraction of the time between the first ticket row and that status.
- **Stats rounds.** `GET /stats/rounds?pageSize=1&gameType=conquest&minParticipants=20&minDuration=10`,
  with and without `mapName=bocage`, reading `totalItems`.
- **Machine.** `sysctl hw.memsize machdep.cpu.brand_string`; `python3
  --version`; import checks.
- **Web.** A search-and-read survey on the day; URLs are inline. Versions come
  from the PyPI JSON API and the projects' release pages.
