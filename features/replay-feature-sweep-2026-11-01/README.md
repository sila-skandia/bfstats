# Replay feature sweep: what retail has that the replay and recorders do not (2026-11-01)

Status: entries 1-10 and 12 built on 2026-11-01 (each marked in the catalogue);
11 and 13-16 open. Each entry is a brief for one implementer. Check `git log` on the files an entry names
before starting: other work may have landed since.

Out of scope, because other agents cover them: sound quality, EAX and the
hardware sound settings; the OPTIONS > VIDEO plate; console commands.

## How this was swept

- **Existing gap lists first.** `bf1942-engine-reference/ledger-gaps.md` is
  generated from the symbol table and lists unsymbolised addresses, not
  unbuilt features. `bf1942-parity-round-2026-09-19`, `bf1942-corpus-sweep-2026-09-18`
  and `bf1942-3d-models/parity-gaps.md` are about the live page, not the
  replay. The replay's own lists are the "Open" sections of
  `round-replay-hud`, `round-replay-fidelity`, `round-replay-highlights`,
  `replay-accuracy`, `replay-creator-view` and `server-replay-recorder`, and
  `udp-relay/netcode-audit.md` section 5 (events decoded but unused). Each
  claim used below was checked against the code.
- **Every game event class in the server.** `nm -C bf1942_lnxded.static`
  gives 51 `dice::bf::*Event` classes with `serialize`. Their ids were read
  from the registration calls in `GameEvent::initEvents` (`0x0811bee0`, each
  `push $maker; push $id; call registerEventMaker 0x0811bd60`), and each maker
  symbol resolved to its class. The table in [The event census](#the-event-census)
  compares that list with what each recorder writes and what the viewer reads.
- **Client strings.** `strings BF1942.exe` for camera, debriefing, demo,
  record, playback, weather and HUD terms. Server strings for the event log's
  event names.

### Findings that change other docs

- **Retail has no demo recorder.** No `demo`, `playback` or `record` string
  in `BF1942.exe` names one. `ReplayCampaign` and `ReplaySkirmish` are menu
  actions (replay a campaign level, beside `StartCampaign`). The server's
  only recorder is the event log (`Setup::getStatsRecorder`,
  `EventLogger::logRoundStats` `0x08058820`). The client does carry a spline
  camera, `toolBenchmark.addSplinePoint` / `clearAllSplinePoints` /
  `toolBenchmark.setActive`, which flies a benchmark path. That is the only
  scripted camera in retail.
- **No vanilla level uses weather.** `Weather.initWeather` and
  `rem *** Weather Data Base ***` are in the client, but no `.con` in any of
  the 44 vanilla level archives has a line that mentions weather (scanned
  with `bf42.rfa.RfaArchive`). Weather is not a replay gap.
- **Stale: `round-replay-hud` Open says "Left: the viewer reading `hm`".**
  The viewer reads it: `replay-recording.js:1104`, `replay-hitmarks.js:272`,
  `replay-accuracy.js:354`. The header of `replay-hud.js` (line 25, "the hit
  marks ... not recorded") is also out of date.
- **Still true:** `server-replay-recorder` says the viewer skips
  `pn`/`pj`/`pd` (no case for them in `replay-recording.js`).
  `round-replay-fidelity` says aim pitch is recorded and not drawn:
  `replay-gait.js` `twistTorso` turns the torso by the twist only. The
  live relay page does pitch the spine (`netcode-render.js:1066-1074`).

## The ranked catalogue

Ranked by value to someone watching a replay, over effort. Effort: S is a
day or less, M a few days, L a week or more. "Rec" means a recorder change,
in `features/server-replay-recorder/src/` (server, "srv") or
`~/projects/skandia/bf42plus/src/replay.cpp` (client, "cli"). "View" means a
viewer change under `tools/bf1942-models/viewer/`.

| # | Entry | Side | Effort | Value |
|---|---|---|---|---|
| 1 | [Third-person aim pitch on replayed soldiers](#1-third-person-aim-pitch-on-replayed-soldiers) | view | S | high |
| 2 | [Draw the server's projectile flights](#2-draw-the-servers-projectile-flights) | view | M | high |
| 3 | [The server recorder writes the events it drops](#3-the-server-recorder-writes-the-events-it-drops) (built 2026-11-01) | rec srv | S | high |
| 4 | [Retail scoreboard: score, ping, order and medals](#4-retail-scoreboard-score-ping-order-and-medals) (built 2026-11-01; client recorder half not planned) | view, rec srv+cli | S+S | high |
| 5 | [The round-end debriefing in the replay](#5-the-round-end-debriefing-in-the-replay) (built 2026-11-01) | view, rec srv | M | high |
| 6 | [Combat-area warning on the followed player's HUD](#6-combat-area-warning-on-the-followed-players-hud) (built 2026-11-01) | view (rec srv optional) | S | medium |
| 7 | [Capture progress from the server's own timers](#7-capture-progress-from-the-servers-own-timers) (built 2026-11-01) | rec srv, view | S+S | medium |
| 8 | [Retail vehicle and soldier views: chase, front chase, flyby](#8-retail-vehicle-and-soldier-views-chase-front-chase-flyby) | view | M | medium-high |
| 9 | [Artillery spotting markers and the scout view](#9-artillery-spotting-markers-and-the-scout-view) (built 2026-11-01) | view | M | medium |
| 10 | [Retail name tags in first person](#10-retail-name-tags-in-first-person) (built 2026-11-01) | view | S | medium-low |
| 11 | [Exact ammunition from the server](#11-exact-ammunition-from-the-server) | rec srv, view | M | medium-low |
| 12 | [Welcome message, votes and the map list](#12-welcome-message-votes-and-the-map-list) (built 2026-11-01) | view (rec srv in 3) | S | low |
| 13 | [Heals and repairs](#13-heals-and-repairs) | rec srv, view | M | low-medium |
| 14 | [The spawn screen for a dead followed player](#14-the-spawn-screen-for-a-dead-followed-player) | rec srv, view | L | medium |
| 15 | [Capture the Flag: the flags and their carriers](#15-capture-the-flag-the-flags-and-their-carriers) | rec srv, view | M | low (CTF only) |
| 16 | [The server-placed camera after a bail-out](#16-the-server-placed-camera-after-a-bail-out) | research | S | low |

### Dependencies

- 4 and 5 share the score work: 5's debriefing list is 4's sorted rows, so
  build 4 first, or build both in one pass.
- 5 wants 3's `roundStats` in server files for the debriefing's per-player
  shots and hits. The client file already has them.
- 12 needs 3 for server files (`welcome`, `vote` and `mapList` are written
  by the client recorder only today). Its viewer half needs nothing.
- 7's viewer half reuses `capture-progress-rings` code and has no other
  dependency. 9 needs nothing.
- 14 needs a new server hook (client-to-server events), the same one 15's
  recorder half could use. Build the hook once.

### File-overlap groups, for scheduling parallel implementers

Implementers in the same group touch the same file; run them one after
another, or give one implementer the group.

| group | files | entries |
|---|---|---|
| A, the server event writer | `server-replay-recorder/src/core.c` `emit_event_json` and the held-event table | 3, 4 (srv), 5 (srv), 7 (srv), 12, 13 (srv), 15 (srv) |
| B, the server's new hooks and reads | `server-replay-recorder/src/target_lnxded.c`, `core.h` (`struct rec_target`) | 4 (ping, score table), 7, 11, 13, 14, 15 |
| C, the recording parser | `viewer/replay-recording.js` (the `case` lists in `parseEvent` and the sample loop) | 2, 3, 4, 5, 7, 11, 12, 13, 14, 15 |
| D, the replay's DOM | `viewer/replay-ui.js` (board, card, log) | 4, 5, 12, 14 |
| E, the first-person HUD | `viewer/replay-hud.js` | 6, 9, 10, 11 |
| F, the camera | `viewer/replay-camera.js` | 8, 9, 16 |
| G, bodies | `viewer/replay-gait.js` | 1 |
| H, new modules | a new `viewer/replay-flights.js` (2), `viewer/replay-debrief.js` (5) | 2, 5 |
| I, the client recorder | `bf42plus/src/replay.cpp` | 4 (cli) |

Group C is the hot spot. Each entry adds its own `case` blocks and fields on
`rec`, so the merges are mechanical, but two implementers editing it at once
will conflict. A practical schedule: wave 1 runs 1 (G), 2 (H, plus a small
C hunk), 3 (A) and 8 (F) in parallel; wave 2 runs 4+5 together (C, D, A
after 3), 6 and 10 (E), 7; wave 3 the rest.

---

## 1. Third-person aim pitch on replayed soldiers

**Retail.** In third person the client bends each soldier to his aim:
`FUN_004fb150` calls `FUN_004f7ca0(pitch)` and writes post-absolute bone
transforms inside its third-person block, under `if (local_16c == 0)`
(ledger ANIM-5; `subsystems/handweapon-view-and-deviation.md`, the paragraph on
`Skeleton::transform`). The same block applies the third-person lean,
`soldier+0x3ec x 90 deg`, eased at 3/s from the `+0x416` movement bits.

**Ours.** The recorders write the aim register in every `st` row (BFSoldier
`+0x2B0`; `round-replay-hud` "Where the cross is"). The camera uses it
(`replay-camera.js` `AIM_PITCH_SCALE`). The drawn body does not: `replay-gait.js`
`twistTorso` turns `anim.torso` by the twist alone, so a man firing at an
aircraft stands level with his rounds leaving above him
(`round-replay-fidelity` Open, still true). The live page already does
this for remote soldiers: `netcode-render.js:1066-1100` turns `Bip01 Spine`
by `aim x 2.5` (VIEW-14), clamped to 60 degrees, eased, and caches the mixer's
base pose so the turn never compounds.

**Missing.** Viewer only.

**Brief.** In `replay-gait.js`, extend `twistTorso` (or add a sibling
called from the same place) to pitch the spine by the recorded aim pitch
`aimAt(...)` from `replay-recording.js` times `AIM_PITCH_SCALE` (2.5,
VIEW-14), about the body's right axis, after the twist. Copy
`netcode-render.js`'s clamp, its `TWIST_EASE_HZ` easing and its base-pose cache
(three's `PropertyMixer` writes a bone only on change; the memory note "three
mixer writes on change" is the trap). Skip it for prone and for seated soldiers
in a hull (their spine is the seat pose). Check on a recording with an AA or
anti-air rifle burst: the rounds' `f` directions against the drawn chest,
the way `twistTorso`'s comment measured the twist on
`replay_20261018-233939`. The lean is optional and smaller: read `+0x416`'s
strafe bits from `st`'s state bits if the recorder carries them, else leave it.

## 2. Draw the server's projectile flights

**Status.** Built 2026-11-01 (`replay-flights.js`; `linkFlights` in
`replay-recording.js`). Shells, rockets and bombs fly their recorded path and
end in the game's collision effect at the `i` point; the page fires none of
its own; the bullet cam and the clip clock ride the flight. Bullets stay the
page's (a server bullet is one to three samples). How it was checked:
`server-replay-recorder` "In the viewer", `replay-creator-view` "Server
flights".

**Retail.** The server flies every projectile. A client is sent only some of
them: networked pools (grenades, mines, charges, binocular markers) and none
of the tank shells or rockets (`round-replay-capture` section 13).

**Ours.** The server recorder writes every enabled projectile root each
sample: `pn` names a flight (`{"k":"pn","o":[[key,"tmpl"]]}`), `pj` places it
(`[key,x,y,z]`), `pd` ends it (`core.c` `sample_projectile`,
`projectiles_gone`, around line 3140). The viewer has no case for these
(`replay-recording.js` sample switch at lines 975-1213), so a server file's
shells and rockets are drawn only by the page re-firing them from `f`
(`replay-gunfire.js`), which can miss what the server's round actually hit.
`server-replay-recorder` Open lists it.

**Missing.** Viewer only. One recorder gap stays: a round that hits inside one
tick has no flight (`server-replay-recorder` Known gaps).

**Brief.** Parse `pn`/`pj`/`pd` in `replay-recording.js` into
`rec.flights`: per flight `{key, tmpl, t0, t1, track}` with the positions on a
`SampleTrack` (key is reused across flights, so a flight is `pn` to `pd`).
Link each flight to its `f` by template and time (the nearest `f` of the
same projectile template within one sample, at the barrel; `weaponOfProjectile`
in `replay-props.js` maps round to weapon) and to its `i` by key-less match
on time and point. In a new `replay-flights.js`, draw each flight with the
projectile mesh `replay-props.js` already loads for pooled rounds, oriented
along the track's velocity, and play its template's end effect at `pd` when
an `i` with `dmg` or a terrain hit sits there. Where a server flight exists
for an `f`, the page must not also fire its own round (`roundIsRecorded`
does this for networked pools; extend it). The bullet cam (`replay-camtrack.js`)
and the clip clock (`replay-clipclock.js`) should ride the recorded flight
when there is one. Check: a server lab file with tank fire
(`*-rec.json` scenarios), every `pn` drawn, every page re-fire suppressed,
shells landing on their `i` points.

## 3. The server recorder writes the events it drops

**Status: built 2026-11-01** (`server-replay-recorder/src/core.c`
`emit_event_json`, two new detours in `target_lnxded.c`; ledger NET-18,
NET-19, NET-20, HFD-14). What it writes and how it was checked are in
`server-replay-recorder/README.md` ("What it writes", "Status"). Two
readings below were wrong: `roundStats` goes to every client, for every
player, through `sendGameEventToAll` (NET-18), so it needed no new hook;
`hitFrom` and `special` did, at `0x0814bd5e` inside `_giveDamage` and at
`triggerSpecialGameEvent`'s entry. No viewer change was needed: the viewer
already took a `pid` on `hitFrom` and `special` from merged files.

**Retail.** The events and who sends them, from `GameEvent::initEvents`
(`0x0811bee0`): see [The event census](#the-event-census).

**Ours.** `emit_event_json` (`server-replay-recorder/src/core.c`, from line
2545) writes 22 kinds. Its `default` drops the rest, including events a
client file carries and the viewer already reads: 0x30-0x32 `roundStats`
(the round-end tallies; `replay-accuracy.js` uses them), 0x3C `hitFrom` (the
hit-direction wash, `replay-feed.js`), 0x27 `special` (refills, `rec.refills`).
Also dropped: 0x17 `welcome`, 0x12 `vote`, 0x13 `mapList`, 0x37
`sessionId`, which bf42plus names (`replay.cpp` 443-501), and 0x1E
FlagHolder, 0x25 ControlPointCaptured, 0x3B TriggerObjectSpawner, 0x0E
SetTempCamera, which bf42plus writes as `raw`.

**Missing.** Server recorder. The events reach the detours only while a
client is connected and are sent per connection (deduplicated already).
`roundStats` and `hitFrom` go to one client each, so a bots-only round has
none; for those the recorder must read the source instead. (Corrected
2026-11-01: `roundStats` goes to all, NET-18; `hitFrom` and refills go to
one client each, HFD-14, NET-19.)

**Brief.** In `emit_event_json` add cases that write the client recorder's
exact records, so the viewer reads them with no change: 0x30/0x31/0x32 as
`{"e":"roundStats","stat":"destroyed"|"fired"|"hit","pid","rows":[{tid,tmpl,n}]}`
(layout `round-replay-capture` 11.3: `u8 rows-1, u8 pid, u32[10] tids,
u16[10] counts`; name templates with `tmpl_name_json`); 0x3C as
`{"e":"hitFrom","pid","dir","strength"}` with `pid` the receiving
connection's player (check that the `addEventToSendQueue` detour can tell
which connection's queue it is; if not, use the `_giveDamage` route below
for everyone); 0x27 as
`{"e":"special","action","pid"}`; 0x17, 0x12, 0x13 and 0x37 as bf42plus
writes them (copy its field names from `replay.cpp`); 0x1E, 0x25, 0x3B, 0x0E as
`{"e":"raw","type","raw":"<hex>"}` like the client. Decide per event
whether it is held (`welcome`, `mapList` are state; `vote`, `hitFrom` are
moments). For bots-only rounds: hook `GameServer::sendPlayerStats`
(`0x081534b0`) or read the tallies it reads, so `roundStats` exists with no
client; and for `hitFrom`, the source is `GameServer::_giveDamage`
(`0x0814b870`), whose sector and strength formula is in 11.3 (cos 22.5 at
`0x086c0b68`, scale 255 at `0x086c08a0`): compute it for every damaged
soldier and write it with his `pid`. Extend `tests/core_harness.c` with one
payload per new case. Check in a lab round with one client joined.

## 4. Retail scoreboard: score, ping, order and medals

**Status: built 2026-11-01, except the client recorder.** Server recorder:
`ps` per player on change (score, kills, deaths, ping `+0x94`, the three
medal counters) and `scoreTable` once a file (`server-replay-recorder/README.md`,
"What it writes"). Viewer: `replay-recording.js` reads `score` events into
`rec.scores`, `ps` into `rec.playerStats`, `scoreTable` into
`rec.scoreTable`; `replay-chapters.js` `scoresAt` / `boardAt` (the `ps` rows
win for their pid's holder, else the score is paid by the server's table,
the pack's for the mode, or the engine's defaults; retail order with the
connect-time key as each recorder's machine sees it); `replay-ui.js`
`renderBoard` has SCORE and PING columns (ping `-` where unrecorded) and
the medal cells from recorded counters. `+0xc8` is ping: ledger MEME-27.
Tests `tests/test_replay_debrief.py`, `tests/run.sh` checks 26.
Checked on a Wake co-op lab round with 30 bots and the new recorder
preloaded (`~/bf1942-lab/runs/20261101-202218-a6board-wake-coop-rec`, 26
minutes): the `scoreTable` is vanilla's ScoreManagerSettings.con, and the
board at the round's end from `ps` matches the log's `bf:roundstats` score,
kills and deaths for 30 of 30 players. Paid from the events alone (the
`ps` lines stripped) 25 of 30 matched; the other 5 each had a team kill the
server counted (`tks` in its log, -2) with no ScoreMsg 6 recorded. The
2026-11-01 events3 round showed the same for 3 of 30. Every bot's ping
reads 0 and no medal was given: on this dedicated server `giveMedal`'s gate
(ROUND-9) stayed shut, so its medal cells stay empty.
**Open:** bf42plus writes none of it. Its record would read each client
player's `+0xf4`, `+0xd8`, `+0xd4`, `+0xc8` and the medal counters
`+0x11c..+0x124` (MEME-25) through the client's PlayerManager each sample,
a new walk in a recorder that ships to players, so it is left for a
bf42plus change of its own. Client files score from their events with the
pack's table and show no ping. **Not planned (owner, 2026-11-01):** the stats
site already captures every player's score and ping, so the client recorder
half is not worth a change to a recorder that ships to players.

**Retail.** The board has, per row, the kit glyph, the name, then score,
kills, deaths and ping (columns 3..6, client `+0xf4`, `+0xd8`, `+0xd4`,
`+0xc8`), the id, and three 8 x 8 medal cells (ledger MEME-25). Rows are
ordered by `getPlayersSortedByScore`: higher score, more kills, fewer deaths,
later connect time (MEME-26; lnxded `0x08260db0` on `+0xc0`, `+0xa4`, `+0xa0`,
`+0x168`). Score is paid by `ScoreManager::scoreEvent` (`0x081617c0`) from
the server's per-event points (`ScoreManager::getKill` `0x08163860`,
`getDeath`, `getTK`, `getCapture`, `getAttack`, `getDefence`,
`getObjective`, `getObjectiveTK`).

**Ours.** The replay's board (`replay-ui.js` `renderBoard`, line 1938) shows
kills and deaths only and sorts by kills. The page's retail board already
exists as pure functions: `scoreboard.js` `boardRows`, `scoreOrder`,
`medalKinds`, `boardVars`; and `round-state.js` has the point table
(`SCORE_DEFAULTS`, `scoreTable`) and the payer (`pay`). Neither recorder
writes a player's score or ping.

**Missing.** Viewer: score from the recording's `score` events, the retail
order, a ping column. Recorder: the server's point table (mods change it) and
ping.

**Brief.** Viewer first: in `replay-chapters.js`'s tally (`tallyAt`), pay
each `score` event through `round-state.js`'s `scoreTable` (kills, deaths,
TKs, captures, attacks, defences, objectives), so the board can show score
at any time; sort with `scoreboard.js` `scoreOrder`; add Score and Ping
columns to `renderBoard`. Recorder: once a file, write
`{"k":"e","e":"scoreTable","kill":..,"death":..,"tk":..,"capture":..,"attack":..,"defence":..,"objective":..,"objectiveTk":..}`
from the server's `ScoreManager` getters (globals `scoreManager`
`0x0871bb58`), and use it in place of the defaults when present. Write a
per-player `ps` row on change, `[pid, score, kills, deaths, ping]`, from
BFPlayer `+0xc0`/`+0xa4`/`+0xa0` and `NetServer::getPing` (`0x084382e0`) on
the server; in bf42plus, from the client's replicated `+0xf4`/`+0xd8`/`+0xd4`/`+0xc8`
(check `+0xc8` is ping against the retail board before naming it). The
recorded score, when present, wins over the computed one; a mismatch is a
check on the table. Medal cells come with entry 5.

## 5. The round-end debriefing in the replay

**Status: built 2026-11-01.** Server recorder: `gameStatus` 2 and 5 carry
`winner` and `victory`; the victory type is set after the status turns
(ROUND-13), so a 2 is finished at the end of its tick. Viewer:
`viewer/replay-debrief.js` (`roundResultOf`, `debriefModel`,
`ReplayDebrief`) paints round-end.js's plate, whose painter is now
`createDebriefingPlate`, shared with the page's own round end. The result:
the record's, else the server log's winner, else the tickets' (ROUND-2,
ROUND-3); the type: the record's, else `victoryTypeOf` over the tickets'
shares, each side's start its first count once the file saw the round
begin, else the log's `roundInit`, else the level's counts. The log's own
`bf:victorytype` is never read: it is 4 in all 1,067 logged rounds here
(ROUND-13). The winner is taken from the log before the tickets, not after
as the brief had it: the log is the server's word, the tickets an
inference. The plate shows when playback crosses `rec.roundEnded`, with the
win or lose cue only when playback runs into it, until a key is pressed or
the viewer seeks back; its ticket cells follow the HUD's. Checked in the
page: the 2026-10-17 El Alamein relay recording
(`20261017-195554-relay-elalamein-play/replay_20261017-214820`), whose
log names winner 1, shows MAJOR VICTORY for skandia's Axis (476 to 0, a
margin of 0.48) with its best three, goes on a key, stays down while
played on, and comes back after a seek before and past the end. On the
2026-11-01 Wake lab round the recorded result was winner 1, victory 1
(minor) where the log says winner 1, type 4; with the recorder's records
stripped, the tickets' fallback gave the same winner and type.
**Open:** the creator view does not offer the plate as a shot (the studio
was not touched); medals on the plate are by rank, as retail's are, but
the board's medal cells show only recorded counters.

**Retail.** A multiplayer round ends on `menu/LoadMenu`'s multiplayer plate
over the world (ROUND-12), titled by the local side's result and victory
type (ROUND-8: `DEBRIEFING_TOTAL/MAJOR/MINOR_VICTORY`, `_DEFEAT`, `DRAW`; the
strings are in `BF1942.exe`), listing the top three with gold, silver and
bronze (ROUND-9, `BFPlayer+0xe8/+0xec/+0xf0`; art
`Debriefing/medals/*_XL_*_32x32.tga`). The victory type is the ticket-share
margin (ROUND-6, `ScoreManager::getVictoryType` `0x08163960`); the winner is
`ScoreManager+0x5c` (ROUND-5).

**Ours.** The page builds it: `round-end.js` (`debriefingOf`,
`debriefingWords`, `bestPlayers`, `medalTexture`, `createRoundEnd`),
`round-state.js` `victoryTypeOf`. The replay marks a "Round over" chapter
(`replay-chapters.js:248`) from the server log's `roundstats` when a log is
attached, and otherwise does nothing at the end.

**Missing.** Viewer: the plate at `gameStatus` 2. Recorder (server): the
winner and victory type, so a file without a server log knows them.

**Brief.** Server: at `gameStatus` 2, add `winner` (`ScoreManager+0x5c`) and
`victory` (`getVictoryType`'s byte) to the `gameStatus` record. Viewer: a
`replay-debrief.js` that, when playback crosses the round's end
(`rec.roundEnded`), builds the plate with `round-end.js`'s functions: the
winner and victory type from the record, else from the last `tk` row with
`round-state.js` `victoryTypeOf` (ROUND-6), else from the server log; the
local side is the followed player's team; the list is entry 4's sorted rows,
top three, with `medalTexture`. Show it over the world as the page does, until
the viewer seeks back or presses a key; in the creator view it is a shot a
creator can include. Check against the server log's `bf:winningteam` on the
recordings that have one.

## 6. Combat-area warning on the followed player's HUD

**Status: built 2026-11-01** (viewer only). `replay-combat-area.js` runs the
page's `combat-area.js` law over the recorded positions of the object he
controls; `replay-hud.js` feeds `Outside/*`; `replay.js` labels a no-killer
death after more than the allowance outside as deserted in the replay's log.
What was built, how it was checked and what is open:
`features/round-replay-hud/README.md`, "The combat area (2026-11-01)". The
recorder half (`player+0x178`) is not done. Checking it turned up ledger
CA-10: bot B17s past El Alamein's terrain edge lose no hit points in the
server's recordings, which the model says they should.

**Retail.** Leaving the combat area starts a per-player 10 s countdown, then
5 HP/s on the occupied object (ledger CA-2, CA-3, CA-7). The HUD shows
`menu/InGame` entry 42, "Warning! You are leaving the combat area!..." with
`Outside/OutsideTime = allowance - trunc(secondsOutside)` (CA-4, CA-8). Every
player, bots included, has his own accumulator (CA-9).

**Ours.** The page has it (`combat-area.js`, `soldier-hud.js`, `hud.js`).
The replay has nothing: no `replay-*.js` mentions the combat area. A death
to it shows as a death with no killer.

**Missing.** Viewer; the recorder half is optional.

**Brief.** In `replay-hud.js`, run the followed player's position (his
controlled object's, CA-7) through `combat-area.js`'s test for the level's
area each frame, accumulate the seconds outside with CA-3's rules (zeroed on
re-entry, CA-5's terrain-material exception), and feed `Outside/OutsideTime`
into the same `hud.js` variable the page sets. Label a no-killer death that
follows 10+ s outside as "deserted" in the replay log (`replay-recording.js`
`row`). Optional exactness: the server recorder samples
`player+0x178` (CA-3) per player on change. Check on any round where a pilot
flies off the map edge.

## 7. Capture progress from the server's own timers

**Status: built 2026-11-01.** Server recorder: `cpt` records, a point's
state (`+0x17c`), getting team (`+0x170`) and get and lose timers
(`+0x16c`, `+0x168`) on change, a running timer at most every quarter
second, the template's full times (`+0x1f4`, `+0x1f8`) on a file's first
row (`core.c` `sample_cpt`; ledger AI-162; harness case 28). Viewer:
`replay-recording.js` puts them on `rec.controlPoints[id].timers`,
`replay-capture.js` `captureProgressAt` turns them into a ring, and
`capture-rings.js` reads them in place of its estimate when the replay
hands them in (`replay.js` `captureInput`), so the minimap, the full map
and the HUD ring are the server's; `replay-battlemap.js` rings a flag only
from them. A file without `cpt` runs as before (the `replaydump.mjs` output
of four recordings byte-identical). Checked on a bots-only El Alamein lab
round: every change of a side came a tick after its timer ran out, and the
page drew the server's frames on the minimap and the battle map
(`server-replay-recorder/README.md` "How it was checked",
`capture-progress-rings/README.md`). Open: the in-world flag has no ring;
`replay-merge.js` passes `cpt` through only while the server's file owns
the merged round (its other records), so a stretch a client's file owns
holds the last row; not run on a merge.

**Retail.** A control point's capture is a server timer: getting `+0x16c`,
losing `+0x168`, a state byte (ledger AI-100, `ControlPoint::handleFrameUpdate`
`0x08283b00`). No client is told: the ghost carries the team and the spawns
byte only (NET-16). Retail draws no ring for a control point (HUD-15).

**Ours.** The page draws its own rings from the law (`capture-progress-rings`,
labelled as the page's addition). The replay knows only team changes (`cp`
records), so a contested point looks idle until it flips.

**Missing.** Server recorder: the timers. Viewer: the rings in the replay's
minimap and battle map.

**Brief.** In the server sampler's control point walk (`core.c` near line
3110, where `cp` is written), also read the state byte and the two timers
and write `{"k":"cpt","t","id","state","get","lose"}` on change, at most a
few times a second. In the viewer, parse it into `rec.controlPoints[id].progress`
and feed the same ring frames `capture-progress-rings` draws
(`Minimap/Objectives/Objective000..100.dds`) into `replay-minimap.js` and
`replay-battlemap.js`. Client files have no timers: draw nothing there
rather than guessing. Keep the page's "our addition" labelling.

## 8. Retail vehicle and soldier views: chase, front chase, flyby

**Status: built 2026-11-01.** `replay-camera.js` modes `chase`, `front` and
`flyby` on F10-F12 (F9 first person), gated on each seat's `CVM*` words, the
soldier's chase on foot, and three creator cameras and recipes (Game chase,
Game front chase, Game fly-by). What was built and how it was checked:
[round-replay-ux](../round-replay-ux/README.md), "The game's outside views",
and [replay-creator-view](../replay-creator-view/README.md), "The game's
cameras". Left: `replay-recording.js` does not keep `gameRules.extViews` yet.

**Retail.** A seat's camera offers `CVMInside`, `CVMChase`, `CVMFrontChase`,
`CVMFlyBy` (F9-F12; ledger CVM-1). The chase and front chase frame the hull,
eased by `1 - exp(-2 dt)`, 1.2 x the bounding radius, 0.6 x velocity lead,
1 m over the terrain (CVM-2, CVM-3). A soldier has a third-person chase too
(`soldier-third-person-camera`).

**Ours.** The page has all four (`vehicle-camera.js` `CAMERA_MODES`,
`seat-camera.js` `SEAT_VIEW_FOR`). The replay has three modes of its own,
orbit, pov and free (`replay-camera.js:37`), and pov in an aircraft is the
nose cam.

**Missing.** Viewer only.

**Brief.** Add `chase`, `front` and `flyby` to the replay camera when the
followed player is in a seat, driven by `vehicle-camera.js`'s `VehicleCamera`
over the recorded hull's pose (`replay-hulls.js` gives the hull's matrix and
bounding radius; velocity from `replay-kinematics.js` `motionAt`). Honour the
seat's CVM flags from the model's camera extras (`cameraLookLimits` reads the
same userData), so a seat that forbids a view does not get it. On foot, offer
the soldier chase from `soldier-third-person-camera`. Keys: F9-F12 as retail,
alongside the replay's own cycle (`replay-ui.js` key map). The creator view
(`replay-creator.js`) can then offer them as camera recipes. Check against
`vehicle-camera-toggle-sweep`'s captures.

## 9. Artillery spotting markers and the scout view

**Retail.** A scout's binoculars place a scout-camera marker (SPOT-1); the
side's artillery gunners see it on the minimap (wedges) and can look through
it (view mode 17), until alt-fire, its removal or its life ends (SPOT-12;
`artillery-spotting` sections 1-7).

**Ours.** The page has it for its own player (`spotter.js`, `artillery-spotting`
"Built in the viewer"). The recordings carry each `BinocularsProjectile` as a
networked pooled object with its matrix and life (`replay-props.js`
`NETWORKED_ROUNDS`; `artillery-spotting` section 10: "enough to draw what was
spotted and to offer the scout view in a replay. Not built").

**Missing.** Viewer only.

**Brief.** From the replay's pooled-round lives, list each binocular marker
by side (the owner's team at placement) with its placed matrix and its end.
Draw the minimap wedges in `replay-minimap.js` the way `spotter.js` draws
them for the page. When the followed player sits in an `artPos` seat, offer
the scout view (mode 17) in `replay-camera.js`, with `spotter.js`'s gaze
and endings, and the scout overlay in `replay-hud.js`. Which marker a
gunner actually looked through is not recorded (the client sends
ReqScoutCamera 0x26 to the server, SPOT-10); offer the newest, and note the
server could record it (group B, a receive hook as in entry 14).

**Built (2026-11-01).** `viewer/replay-spotting.js`, wired in `replay.js`
(before the camera), `replay-camera.js` (`placeScout`), `replay-ui.js` (J,
`[` / `]`, the help line, H takes the overlay down) and `map.html` (the
overlay and the minimap wedges go through `map-spotter.js`'s own
`paintHud` / `drawWedges`; `map-surfaces.js` asks for the wedges in a replay
too). A marker is the first placed sample of its pooled object; its scout is
the man 30 m under its eye (nobody found: no side, never offered, grey on the
minimap); spotter.js's selector and view run over the recording's list. The
view is offered, not replayed: J looks through the newest marker of the
followed gunner's side, and the bar and the help say which one he used is
not recorded. Checked on the owner's Battleaxe round (the Priest gunner,
pid 5): the gaze law held on all 71 frames a shell was up, `]` stepped
between two markers, `game.useHud 0` and H hide the overlay; details in
`artillery-spotting`, "Built in the replay". `replaydump.mjs` output is
byte-identical on the Bocage round. Open: recording which marker the
gunner looked through needs the server's receive hook above.

## 10. Retail name tags in first person

**Status: built 2026-11-01.** In the followed player's first person the
page's `nametag-layer.js` draws the retail tags from the recording
(`replay.js` `nametagFeed`) and the replay's clickable DOM tags stand down;
orbit, free and the outside views keep the DOM tags. The caps come from the
file's `setLevel` `nameTags` where a recorder writes them, else 75 / 300 m.
`features/nametags/README.md`, "In a replay (2026-11-01)".

**Retail.** Team-mates' names within the near distance (75 m, capped by the
server) and the aimed-at player's within the scope distance (300 m) (ledger
HUD-16..HUD-22; `nametags`). The server's caps are in `SetLevel`'s settings
(`serverNameTagDistanceScope` 300 at offset 128, `round-replay-capture` 11.3).

**Ours.** The page draws them (`nametags.js`). The replay draws its own DOM
tags for clicking (`replay-ui.js` `updateTags`), in every mode.

**Missing.** Viewer only.

**Brief.** In pov mode, hide the replay's DOM tags and drive `nametags.js`
with the recording's players: positions from `replay-recording.js`
`positionAt`, teams from `teamAt`, the view from the replay camera, the caps
from the file's `setLevel` settings. The aimed-at test uses the followed
player's view axis (the cross is at the centre, `round-replay-hud`). Leave
the clickable tags in orbit and free.

## 11. Exact ammunition from the server

**Retail.** The HUD's ammo is the weapon's own magazine and reserve
(`FireArms::getAmmoInActiveMag` `0x0828cbe0` and `getAmmo` `0x0828cc00`,
both through `FireArms::mags` `0x0828ca40`).

**Ours.** `replay-hud.js` counts ammunition down from a full kit at spawn by
recorded rounds, reloads and refills: exact for the recording player of a
client file, an estimate for everyone else (its header, lines 17-21).

**Missing.** Server recorder: the counts. Viewer: read them.

**Brief.** In the server sampler's soldier pass (where `st` is written), for
the held weapon (`st`'s item), read the active magazine and the reserve
through `FireArms::mags` and write `{"k":"am","t","o":[[soldierNid, mag, reserve]]}`
on change. Read the layout of `mags`' return from its disassembly before
trusting an offset. In `replay-hud.js`, prefer `am` over the count-down when
the file has it. This also fixes the remote single-tap undercount
(`round-replay-capture` section 14 Open) for the HUD.

## 12. Welcome message, votes and the map list

**Status: built 2026-11-01** (viewer only). `replay-recording.js` reads
`welcome` (`rec.welcome`, cut at the first NUL), `mapList` (`rec.mapList`,
a list sent again replaces the last), `vote` (`rec.votes`) and `sessionId`
(`rec.sessionIds`, parsed and kept, not shown). The welcome lines are the
replay log's first rows (row time pulled to the log's first; their own times
stay in `rec.welcome`). Each vote is a log row in the lexicon's words
(`VOTEFEEDBACK_MAP`, `VOTEFEEDBACK_KICK`, `VOTEMSG_*_NONCONCLUSIVE`; who
started and who voted as bf42plus `showVoteInConsole`), e.g. `X started a
map vote: Vote for map "battleaxe" (ctf, bf1942)? 1 of 7 votes`; a map
vote with no list in the file names its index (`#9`). The board has a third
view, MAP LIST (only where the file has a list), with the game's map vote
columns (`MAPVOTE_ID` ... `MAPVOTE_NUMVOTES`), this round's map tagged NOW
and the next tagged NEXT (the one after it in the rotation, or the map a
passed vote chose), a running vote's yes count on its row
(`replay-maplist.js` `mapListAt`). Same change: hit-direction and refill
rows name their player where the record has a `pid` (server files), refill
rows are one a visit per player, and a sector is named (`ahead right`,
`left`, ...) from HFD-3. Checked headless on Bocage
(`replay_20260928-133433`: five welcome lines head the log, 13 maps,
bocage NOW, tobruk NEXT) and `sw-rtr-user.ndjson` (Raid on Agheila, xpack2:
the six map-vote rows); tests `test_the_server_notices_are_read`,
`test_the_map_list_marks_now_and_next`. Gate: `replaydump.mjs` on the El
Alamein server file without these records is byte-identical; on Bocage only
`events` differs (the welcome rows, sector names). Open: `add` 0 in a
MapEvent is skipped (no file has one; its meaning is not read); the welcome
lines are not printed in the in-game chat box; votes are not drawn as
retail's vote box.

**Retail.** The client prints the server's welcome line (WelcomeMsg 0x17),
runs votes (Vote 0x12, `updateVoteSystem`) and receives the map rotation
(MapEvent 0x13, `round-replay-capture` 11.3) (`udp-relay/netcode-audit.md`
section 5).

**Ours.** bf42plus writes `welcome`, `vote` and `mapList`; the viewer has no
case for any of them (`replay-recording.js` `parseEvent`).

**Missing.** Viewer; server files need entry 3.

**Brief.** Parse the three. Show the welcome line as the first line of the
replay log (`replay-ui.js` log), a vote as a log row ("vote to kick X",
"map vote"), and the map list in the round's info panel with the current map
marked and the next one named. Copy the field names from `replay.cpp` 443-501.

## 13. Heals and repairs

**Retail.** The server logs `beginMedPack`/`endMedPack` and
`beginRepair`/`endRepair` with the medic or engineer and the patient (lnxded
strings, the event log). Depots heal and repair by their own law
(`SupplyDepot::healSoldier` `0x083239d0`, `repairVehicle` `0x08323ba0`,
ledger SUP-5..SUP-10).

**Ours.** The viewer reads a server log's four events and silences them
(`replay-server-log.js:116` `QUIET`). Recordings show the rising hit points
(`a`) with no cause.

**Missing.** Server recorder: who heals or repairs whom. Viewer: a log row
and a credit.

**Brief.** Find the server code that logs `beginMedPack` and `beginRepair`
(xrefs to the two strings in lnxded; `bf1942-ghidra` skill) and hook it, or
detect a heal in the sampler from hit points rising on a soldier with a medic
of his side using his medpack within reach. Write
`{"k":"e","e":"heal","pid","to","kind":"medpack"|"repair"|"depot"}` once
per begin and end. In the viewer, one log row per visit (as refills are,
`replay-recording.js` `special`), and a "heals" and "repairs" count on the
board.

## 14. The spawn screen for a dead followed player

**Retail.** A dead player picks a spawn point and kit on the spawn screen;
the client sends SpawnRequest (0x2F) and ChangeKit (0x3E) to the server
(`GameServer::handleGameEventManagerEvent` `0x08135cb0`; `GameServer::changeKit`
`0x08158700`; `Game::setSpawnGroup` `0x0805d990`; ledger SESS-3).

**Ours.** The page has a retail spawn screen (`deploy-screen-spawn-points`,
`spawning.js`). The replay shows "spawn screen" as a status word on the card
(`replay-ui.js:1902`) and flies the camera to where he will spawn
(`replay-camera.js:1072`).

**Missing.** Server recorder: the requests, which go client to server and
pass none of the recorder's send-path hooks. Viewer: the screen.

**Brief.** Hook `Game::setSpawnGroup` and `GameServer::changeKit` (simpler
than the receive switch; bots go through them too) and write
`{"k":"e","e":"spawnPick","pid","group"}` and `{"e":"kitPick","pid","kit"}`.
In the viewer, while the followed player is dead, draw the page's spawn
screen with his side's points, his pick highlighted from the last
`spawnPick`, his kit from `kitPick`, and the spawn wave's countdown from
his next spawn (`replay-chapters.js` `nextSpawn`).

## 15. Capture the Flag: the flags and their carriers

**Retail.** A flag is carried (`BFPlayer+0x13c`), dropped, returned or
captured (ledger CTF-2..CTF-6); FlagHolderEvent (0x1E, `{flag, playerId}`,
`relay/events.mjs:170`) tells the clients who holds it.

**Ours.** The page plays CTF (`ctf-mode`). The replay has no CTF handling
(no `ctf` in any `replay-*.js`). bf42plus writes 0x1E as `raw`; the server
recorder drops it.

**Missing.** Both.

**Brief.** Server: write 0x1E as `{"e":"flagHolder","flag","pid"}` (entry 3's
pass) and, for rounds with no client, sample `BFPlayer+0x13c` on change.
Viewer: parse `flagHolder` (and the client's raw 0x1E), attach the flag
model to the carrier's back as `ctf-mode` does on the page, put the
carrier's name in the log, and show captures from the `score` events
(FLAGCAPTURE). Check the share of CTF rounds in the replay feed before
spending on it.

## 16. The server-placed camera after a bail-out

**Retail.** `GameServer::exitAndPlaceCameraIfApplicable` (`0x081595b0`)
builds a SetTempCameraEvent (vtable `0x0871a908` at `0x08159792`) and sends
it to the player's client (`addEvent` `0x0812d610`): the server places a
temporary camera for a player leaving a vehicle in some case. The client
resets it in `Camera::resetTempCamera` (`0x081acbc0`).

**Ours.** Nothing reads it. The replay's death cam is its own framing
(`replay-camera.js` `DEATH_FOOT`, `DEATH_WRECK`).

**Missing.** Research first.

**Brief.** Decompile `exitAndPlaceCameraIfApplicable` and the event's
`serialize` (`0x0811cf40`) to learn when the server sends it and what it
carries. If it is the death or bail-out camera's placement, entry 3 writes it
as `raw` and the replay's death cam takes that place for a hull death.
Record the finding as a ledger row.

---

## The event census

All 51 classes `GameEvent::initEvents` (`0x0811bee0`) registers. "cli" is
what bf42plus `replay.cpp` writes; "srv" is `emit_event_json`; "view" is a
case in `replay-recording.js`. Direction: S server to client, C client to
server.

| id | class | dir | cli | srv | view | entry |
|---|---|---|---|---|---|---|
| 0x02 | Ack | C | | | | |
| 0x03 | Debug | both | | | | |
| 0x04 | Simulation | S | simStart | simStart | yes | |
| 0x05 | CreateMultipleObjects | S | projPool | projPool | yes | |
| 0x06 | DestroyObject | S | destroyObject | destroyObject | yes | |
| 0x07 | CreateObject | S | createObject | createObject | yes | |
| 0x08 | CreatePlayer | S | createPlayer | createPlayer | yes | |
| 0x09 | SetDefaultVehicle | S | control | control | yes | |
| 0x0A | SetVehicle | S | enterVehicle | enterVehicle | yes | |
| 0x0B | ExitVehicle | S | exitVehicle | exitVehicle | yes | |
| 0x0C | DestroyPlayer | S | destroyPlayer | destroyPlayer | yes | |
| 0x0D | SetPlayerName | C | | | | |
| 0x0E | SetTempCamera | S | raw | raw | no | 3, 16 |
| 0x0F | ConnectionType | C | | | | |
| 0x10 | UpdateRate | S | raw | dropped | no | |
| 0x11 | CreatePlayerAck | C | | | | |
| 0x12 | Vote | both | vote | vote | no | 3, 12 |
| 0x13 | Map | S | mapList | mapList | no | 3, 12 |
| 0x14 | Challenge | S | challenge | challenge | no | |
| 0x15 | ChallengeResponse | C | | | | |
| 0x16 | GameRules | S | gameRules | gameRules | yes | |
| 0x17 | WelcomeMsg | S | welcome | welcome | no | 3, 12 |
| 0x18 | ResetMap | S | raw | dropped | no | |
| 0x19 | CheckSum | C | | | | |
| 0x1A | ServerInfo | S | serverInfo | serverInfo | yes | |
| 0x1B | ServerInfo2 | S | serverName | serverName | yes | |
| 0x1E | FlagHolder | S | raw | raw | no | 3, 15 |
| 0x23 | HandlePickup | S | pickupKit | pickupKit | yes | |
| 0x24 | GameStatus | S | gameStatus | gameStatus | yes | 5 |
| 0x25 | ControlPointCaptured | S | raw | raw | no | 3 |
| 0x26 | ReqScoutCamera | C | | | | 9 |
| 0x27 | SpecialGameEvent | S | special | special (with pid) | yes | 3 |
| 0x28 | ChatFragment | S | chat | chat (and the whole line) | yes | |
| 0x29 | TimerSync | S | clock | clock | yes | |
| 0x2A | ScoreMsg | S | score | score | yes | 4 |
| 0x2B | PBFragment | both | | | | |
| 0x2F | SpawnRequest | C | | | | 14 |
| 0x30 | StatsKills | S | roundStats | roundStats | yes | 3 |
| 0x31 | StatsShots | S | roundStats | roundStats | yes | 3 |
| 0x32 | StatsHits | S | roundStats | roundStats | yes | 3 |
| 0x33 | Suicide | C | | | | |
| 0x34 | DataBaseComplete | S | dbComplete | dbComplete | yes | |
| 0x35 | DatabaseCompleteAck | C | | | | |
| 0x36 | SetLevel | S | setLevel | setLevel | yes | 10 |
| 0x37 | SessionId | S | sessionId | sessionId | no | |
| 0x39 | SetTeam | S | setTeam | setTeam | yes | |
| 0x3A | RadioMessage | S | radio | radio | yes | |
| 0x3B | TriggerObjectSpawner | S | raw | raw | no | 3 |
| 0x3C | HitFromPos | S | hitFrom | hitFrom (with pid) | yes | 3 |
| 0x3D | RemoteCommand | C | | | | |
| 0x3E | ChangeKit | C | | | | 14 |

The directions of 0x0D, 0x0F, 0x11, 0x15, 0x19, 0x26, 0x2F, 0x33, 0x35,
0x3D and 0x3E as client to server are from `udp-relay/netcode-audit.md`
sections 5 and 6 and ledger SESS-3. "raw" for 0x0E, 0x10, 0x18, 0x1E, 0x25
and 0x3B is bf42plus's catch-all for an event it does not name; whether each
actually reaches a client in a vanilla round is not checked here.

## What is already done (not gaps)

Checked in the code on 2026-11-01, so an implementer does not rebuild them:
radio messages with their voices (`replay-feed.js` `comms.receive`); kill
lines in retail's styles (KILLSTAMP-2, `comms.onKill`); chat; the hit
direction wash for the recording player (`rec.hitsTaken`); the crosshair hit
marks from `hm` (`replay-hitmarks.js`); the first-person HUD, health and
vehicle panels (`replay-hud.js`); the minimap (`replay-minimap.js`); damage
smoke and fire by `addArmorEffect` tier, wrecks and the death explosion
(`replay-hulls.js`); thrown and laid rounds, dropped kits (`replay-props.js`);
the death cam and the free camera (`replay-camera.js`); the aircraft nose
cam in pov; parachutes; the server's `hg` and `i` (`replay-shotlines.js`,
`replay-accuracy.js`); bots' AI LOD on the card; the loading screen
(`map.html`); lens flares (`lens-flare.js`, `level-flare.js`).
