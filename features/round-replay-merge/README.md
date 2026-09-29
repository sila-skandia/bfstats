# Round replay merge

Several bf42plus recordings of the same BF1942 round, merged into one replay.

A recording is one client's view. The server sends every client every event,
wherever it happens, but an object's continuous state (pose, hit points,
turrets, engines, the body's states, trigger flags and so shots) only within
the level's view distance plus 20 m of the client's viewpoint. The exception
is the controlled object of every living player on the client's own side,
which it sends map-wide at priority 0.03 (`features/round-replay-capture`
§19). So one recording per side covers every player for the whole round, and
the files line up by the server's own ids.

Built 2026-09-29. The first real pairs came the same day: two rounds an admin
linked by hand, which the merge must refuse (below, "The guard"), and one
round two players recorded, nj2dyh58te and skandia's
`replay_20260929-063300`, which it merges (8366 events matched, residual
median 5.3 ms, p95 35 ms, drift 2.2 ppm).

## Using it

```
node tools/bf1942-models/merge_replays.mjs allies.ndjson axis.ndjson -o merged.ndjson
node tools/bf1942-models/merge_replays.mjs a.ndjson b.ndjson -o merged.ndjson --report report.json --set hysteresisMetres=80
```

The first file's clock is the merged file's, and its recording player is the
one the replay follows first. The report prints to stdout, the guard's lines
after it; `--report` also writes it as JSON. `--local 3,21` names each file's
recording player where a file cannot (below). Files the guard finds are not
one round are not merged: what it measured is printed and the exit status is
1; `--force` merges them anyway, with a warning in the report.

In the page, picking or dropping several `replay_*.ndjson` files together
merges them before they play (`replay-open.js` `pickedRecording`). The first
file picked leads. The report goes to the browser console.

So does a link with one `replay` per recording,
`map.html?replay=<one>&replay=<another>` (`replay.js` `openMerged`), the first
leading: the REPLAY feed finds the recordings of one round that players shared
separately and offers them merged that way, each recording's comments moved
onto the merged clock by the header's `merged[i]` (features/replay-feed,
"Rounds"). A set the merge refuses plays its first recording alone, the page
saying why (`Not merged. These look like different rounds: ...`), and the
replay's switch between merged and each recording alone greys out Merged
with the reason.

A merged file is an ordinary v5 recording, shared exactly like one client's
(`features/gameplay-recordings`). Its header adds the sources:

```
{"k":"h","v":5,"plus":"2.0","start":"2026-09-28T13:34:33","hz":10,
 "merged":[{"file":"allies.ndjson","start":"...","offset":0,"drift":0,"local":3},
           {"file":"axis.ndjson","start":"...","offset":59.9992,"drift":-3.57e-5,"local":21}]}
```

`offset` is where the file's `t = 0` falls on the merged clock, `drift` its
rate against it (merged `t = offset + (1 + drift) t`), `local` its recording
player.

## The code

| file | what |
|---|---|
| `viewer/replay-merge.js` | `mergeRecordings(inputs, options)`: the merge proper, and `MERGE_DEFAULTS` |
| `viewer/replay-merge-read.js` | one recording read for merging, its record classes and event keys, shared helpers |
| `viewer/replay-merge-clock.js` | the clock fit, and the world-clock checks |
| `viewer/replay-merge-guard.js` | the guard: `checkAlignment`, `MergeRefused`, `formatGuard` |
| `viewer/replay-merge-report.js` | the report, and `formatMergeReport` |
| `merge_replays.mjs` | the command line |
| `tests/replay_split.mjs` | one real recording split into the files each side's client would have written |
| `tests/replay_merge_harness.mjs`, `tests/test_replay_merge.py` | the tests |
| `tests/fixtures/merge_bocage_350-385.ndjson.gz` | 35 s of the public Bocage round of 2026-09-28 (167 KB), cut by `make_merge_fixture.mjs` |
| `tests/fixtures/merge_guard_*.ndjson.gz` | the events of the first real recordings shared (139 KB), cut by `make_merge_guard_fixtures.mjs`: kqqaqxdwtr whole, nj2dyh58te 1370-1930 s, `replay_20260929-063300` 580-1135 s |

All five viewer modules are three.js-free and pure. The page loads them only
when it merges.

## Design

### Time

Each file's `t` is its own recorder's QPC clock, and the header's `start` is
that PC's wall clock to the second, so neither aligns files across machines.
Reliable events reach every client in one order, so they are the backbone:

1. Every event every client receives gets a key that says what it is, not
   when: `createObject` by net id and template, `destroyObject` by net id, a
   kill or team kill by killer and victim, any other score by kind and
   player, `enterVehicle` by player and seat id, `exitVehicle`,
   `pickupKit`, `setTeam`, `createPlayer` by player and name, `control`,
   `projPool`, chat by text, radio by speaker and message. A spawn's weapon
   and a non-kill's victim are uninitialised and stay out of the key.
2. Events inside a file's own opening are left out: the database a joining
   client is sent (up to its `dbComplete`) and the records a mid-round file
   opens with (`ago`) are the world as it stood, not events as they happened.
3. Every pair of copies of a key either file has at most 4 of proposes an
   offset; the busiest 50 ms bin wins.
4. Copies are then paired per key, in order, within 0.25 s. Pairs that cross
   the file order are dropped (the longest chain in both files' order): two
   events of one key in one file are 0.4 s apart at the closest.
5. `t_first = a + b t_other` by least squares, rejecting residuals more than
   four standard deviations from the median (estimated from the median
   absolute deviation, never under 50 ms). Pairs spanning under 120 s fit
   the offset alone; a rate more than 0.1% from 1 is refused.

Three or more files fit each onto the first, or onto another already fitted
when that one shares more of its round. A file sharing fewer than 8 events
with every other falls back to the world clocks, to within a second; with no
world clock either, the merge refuses it.

Two checks the report makes without any event:

- **The 10-second timer (0x29)** carries the world time truncated to the
  second, sent every 10 s and a server tick. Each tick bounds the file's
  world-time offset to a second, and as the tick's phase creeps round the
  second the bounds close in: in `replay_20260928-133433` they close to 39 ms
  over 536 s (one wrap of the phase). Both files' bounds, on the merged
  clock, must meet.
- **The join's world clock (0x04)** is exact but late by however long the
  client took over the join: 0.17 s in `replay_20260928-133433` against the
  timer's bounds. Reported, not used.

Records with no counterpart (a player's own hits, refills and trigger
presses, team chat, radio) and continuous state are moved by the same fit.

### The guard

The vote finds the offset most rare shared events agree on, and eight can
agree by chance. The first real pair shared to the feed (below) was two
rounds of Bocage on one server, a day apart, which an admin had linked by
hand: the fit lined them up by 58 events, 55 of them the server's adverts,
which come round on one timer, and every kill of the stretch both recorded
was left unmatched. So once every file is fitted, and before anything is
merged, `checkAlignment` (`replay-merge-guard.js`) looks at each file against
the one it was fitted to, over the stretch both recorded (each from its join,
or its start, to its end):

1. **The scores decide.** Kills and every other score (`score`, any kind)
   reach every client, so one round's files share nearly all of theirs there,
   and two rounds' almost none. Paired by key on the fitted clock (within the
   event window; within 1.5 s for a fit by the world clock alone, which is
   good to a second), fewer than `minScoreShare` (half) of the fewer either
   file holds, where both hold at least `minScoreEvents` (8), is two rounds.
2. **Where the scores cannot decide** (a short or quiet overlap, or a
   recorder that wrote raw events), the world clock: each file's world-time
   offset from its 10-second timer (0x29) over the overlap, on the fitted
   clock, more than `worldClockSlack` (5 s) apart is two rounds. The offset is
   the bounds' lower edge, `max(v - t)`, which a tick held up on its way never
   raises (a late tick lowers `min(v - t) + 1`, the upper edge: one round's
   files' upper edges crossed by 99 ms). One round's files: 0.001 s apart.
3. Where neither can, the fit stands, as before the guard.

Where the scores decide, the world clock does not overrule them: files whose
kills line up event for event at a few milliseconds are one round, whatever a
round restart does to the timer's runs. A refused set throws `MergeRefused`
with what was measured (`guard`); `force: true` merges it anyway and says so
in the report's warnings. Of three or more files, one refused refuses the set:
the page's comments map onto the merge file by file.

| pair | overlap | kills and scores matched | world clocks apart | verdict |
|---|---|---|---|---|
| kqqaqxdwtr (skandia, 2026-09-28, 536 s) with nj2dyh58te (Instant Replay, 2026-09-29, 2732 s): two rounds, linked by an admin | 8:44 (the fit's, 1377.5 s in) | 1 of 551 (0.2%) | 2147.4 s | refused, by the scores |
| nj2dyh58te with `replay_20260929-063300` (skandia, 21.5 min, Axis): one round | 21:22 (791.2 s in) | 1330 of 1332 (99.9%) | 0.001 s | one round |
| nj2dyh58te with `replay_20260929-063209` (skandia's 37 s before he rejoined) | 26 s | 24 of 24 | 0.006 s | one round |
| the Bocage split fixture (35 s) | 22 s | 23 of 23 | 0.031 s | one round |
| the whole Bocage round split by side | 446 s | 474 of 474 | 0.023 s | one round |
| the Kursk round of 2026-09-27 split three ways, in the page | 79 s, 64 s | 53 of 53, 44 of 44 | 0.016 s, 0.017 s | one round |
| the synthetic pair, its scores taken out, its timers agreeing / 300 s apart | 170 s | none to decide | 0.001 s / 300 s | one round / refused, by the world clock |

The thresholds sit far from both sides: 0.2% against 99.9%, 2147 s against
0.001 s. `test_replay_merge.py` pins the rows (`ReplayMergeGuardTests`, from
the `merge_guard_*` fixtures, whose cut of the one-round pair has 710 of 713
kills and scores in its 1124 s and the same 1 of 551 for the two rounds, at
the same offsets), and the command line's refusal, exit status and `--force`
(`ReplayMergeCommandLineTests`). The refusal reads, in the page and on the
command line:

```
not merged: These look like different rounds: of the 551 kills and scores both recorded, 1 lines up, and the server's clock puts them 35:47 apart.

Guard (are they one round?)
  nj2dyh58te.ndjson -> kqqaqxdwtr.ndjson (events): kills and scores 1 matched of 551 and 670 (0.2%), world clocks 2147.397 s apart; REFUSED by scores
  needs 50% of the kills and scores to match where both hold 8 or more, else world clocks within 5 s
```

Neither of the report's world-clock lines could have refused alone at its
tolerance: on the one-round pair "world clock (0x29): DISAGREES, their bounds
miss by 99 ms" (the upper edges, above) and "world clock at the joins (0x04):
23.7 s apart" (one client's join took that much longer).

### Events

- **Shared events**: one copy each. The earliest copy is kept, except for a
  removal (`destroyObject`, `destroyPlayer`), where it is the latest, so that
  nothing a file recorded before its own copy lands after the merged one.
- **Each client's own connection** (the join, `serverInfo` to `dbComplete`,
  `simStart`, `welcome`, the rules, the status, the 10-second timer) comes
  from one file at a time, the **owner**: the first file (in the order given)
  that is sampling the world then. The file that began first opens the merged
  file with its own opening; the others' openings are left out.
- **Each recording player's own**: his hits (`hitFrom`, 0x3C), his refills
  (`special`) and his trigger presses (`fire`) are kept from every file,
  each given `pid`, his.
- **Radio** gets `to`: the recording players who heard it. Team radio reaches
  the speaker's side, a shout anyone within 70 m.
- **Chat-box lines** (`chat`): one copy of each within 2 s. A player's own
  line shows on his screen 0.07 to 0.6 s before the server relays it, so the
  earliest copy is his.
- **The players' records, the flags and the tickets** (`p`, `cp`, `tk`) come
  from the owner. When the owner changes, the new owner's view is written
  where it differs from the merged file's.

### State: one file per object per stretch

Per object, per stretch of time, one file: every `s`, `a`, `st`, part (`j`)
and engine (`g`) record of that object in that stretch is that file's.
Mixing two files' samples of one object would mix two clients' extrapolation.
While several files have an object in range:

1. **riding**: the file whose recording player controls it or one of its
   seats. His own client's view of what he drives is the one without
   latency.
2. **nearest**: the file whose recording player is nearest it. The server
   ghosts by priority, which falls with distance, and a teammate across the
   map at a flat 0.03.
3. **hysteresis**: a nearer file takes an object over only when it is 50 m
   nearer for 2 s, looked at every 0.5 s. A file that has lost the object
   hands it over at once. A file with under 0.5 s of the object left does not
   take it.

Where the file changes, the new file's current state is written at that
moment (its last pose, hit points, body, parts and engines), and its own
changes follow. `o` and `d` follow the union: an object is in range while
any file has it.

While no file has an object in range, its parts and engines run on in the
file that last had it, as they do in a single file (the client keeps a
distant object's children registered and steps them at zero input, §19). An
object no file ever had in range takes the owner's.

A file's objects still in range when the file ends are in range until then.
A stretch that ends at a removal gets its `d` there, as the recorder writes
one.

### Parts and engines

`jn`/`j`/`g` child ids are numbered once per file by each recorder, so they
differ between files. The first plan was to renumber them into disjoint
ranges per file. That breaks the viewer whenever an object changes files
within one life:

- `replay-hulls.js` `applyJoints` puts each part on one model node, one to
  one. The second file's twin of a turret finds its node taken and is never
  applied, so the turret freezes where the first file left it.
- `replay-recording.js` `engineAt` folds every engine of a hull (the loudest
  revs, running if any runs). The first file's last record of an engine,
  running, keeps the hull's engine note on after the second file says it
  stopped.

So each file's parts and engines are mapped onto one set of ids, per life of
the object. A part matches by its template and its rank among that
template's parts on the object (the recorder walks one object's children in
the order the object created them, the same on every client); an engine by
its rank. `childMatch: 'position'` matches parts by where `jn` places them on
the object, and `'disjoint'` keeps the recommendation, with its limits. The
report counts where rank and position disagree.

### Rounds

A round (`f`) is in every file whose client had its shooter in range, each
client firing it from the trigger flags the server sent. A recording
player's own rounds are kept from his own file, where they come from his
input (`local:1`), and everybody else's from the file whose view of the
shooter's object is used then.

### Several recording players in the viewer

- `replay-chapters.js` `recordingPlayers(rec)` lists them: the header's
  `merged` locals, else the one client's. `recordingPlayer(rec)` is the
  first, the one the replay follows first.
- Each gets the REC badge on his card and in the scoreboard, and his spawns
  in the chapters.
- The hit indicator washes only the followed recording player's own hits,
  in his first person.
- Each refill plays at the player it names.
- A radio line is heard by the followed player if he heard it, else by the
  first who did.
- The battle map draws each one's recorded range and dims outside them all.
- The card's out-of-range note reads "every recording player's view
  distance".
- The status line adds "merged from N recordings".

## Measured: a real round split by side and merged back

`tests/replay_split.mjs` derives from one real recording the files other
clients of the round would have written, by the server's rule: every event;
an object's state only while it is the controlled object of a living player
on the file's player's side, or within the view distance plus 20 m of him
(Bocage's view distance is 400 m, so 420 m). The original is the truth: a
split file holds a subset of it, and the merge must give it back where the
two cover it.

**The whole Bocage round** (`replay_20260928-133433`, public, 34 players,
536 s), `test_the_whole_round_comes_back` when the file is on this PC:

- A: the original's own player (Allies), from the join, stopping 30 s early.
- B: the Axis player the original had in range longest, begun 60 s in (so it
  opens with held `ago` records and a roster), its clock 40 ppm fast, its
  events up to 30 ms off, its parts numbered its own way.

| | |
|---|---|
| offset error | -0.8 ms |
| drift | -35.7 ppm fitted, -40 injected |
| events matched | 3130 |
| residual \|r\| | median 14.2 ms, p95 28.1 ms, max 31.2 ms (the injected jitter is uniform to 30 ms) |
| unmatched | A's 3 team chat lines and 11 team radio messages, which B's side never got |
| world clock (0x29) | agrees (their bounds miss by 1 ms, the jittered ticks) |
| merged samples the original has at that moment | 103,152 of 103,152 |
| merged part values the original has | 34,847 of 34,847 |
| events | every one once: none missing, none extra; 182 kills and 349 deaths as the original |
| merge time | 1.2 s for two 10 MB files |

Player-time in the world that a file had in range (the original's players'
records, a leaver's time after he left counted as out of range, as §19
counted it):

| | Axis | Allies |
|---|---|---|
| the original (the Allies player's own file) | 78.1% | 95.4% |
| A alone | 73.9% | 89.9% |
| B alone | 72.7% | 72.2% |
| the union of A and B | 78.1% | 94.0% |
| merged | 78.1% | 94.0% |

The merge had 0.28 s in range that the original did not (rounding), and
left 17.7 s of the union out: the sample period after each removal at the
round's end, which the original's own `d` covers and the merged file ends at
the removal. The report's own count, with a leaver's time after he left left
out, gives the merged round 77.9% Axis and 97.7% Allies.

**The fixture** (35 s at 350-385 s; B from 8 s, A stopping 5 s early),
`test_the_fixture_comes_back`, always run: offset error -2.1 ms (an offset
alone: 35 s is too short for a drift), 95 events matched, residual median
13.9 ms; Axis 92.2% and Allies 97.6% merged, as the union, against A's 81.0%
/ 87.9% and B's 69.8% / 58.9%; every sample, part value and event the
original's.

**The Bocage file merged with itself** reads, in `parseRecording`, exactly as
the file does (lives, samples, hit points, kills, deaths, bodies, clocks,
tickets) but for 7 parts and 2 engines of a Sherman and a Kubelwagen the join
removed in its queued burst and the sampler saw once more 18 ms later, which
the merge leaves out with their objects.

**In the page** (headless Chromium, the merged whole-round split): "bocage ·
159 vehicles · merged from 2 recordings · soldiers drawn by the map · tickets
recorded"; following each recording player at 260 s, the orbit on his hull
(9.9 m) and on his soldier (6.0 m), REC on both cards, 44 hulls and 27 bodies
drawn, no page errors. The original file gives the same 18 requests for
optional assets the tree does not have (pose sidecars, wrecks).

## Options

`MERGE_DEFAULTS` in `viewer/replay-merge.js`; `--set name=value` on the
command line.

| option | default | what it decides | settled by |
|---|---|---|---|
| `eventWindow` | 0.25 s | how far apart two copies of an event may lie once fitted | `alignment[].residualMs.p95` |
| `chatWindow` | 2 s | the same for chat-box lines | `duplicates.chat` against each file's own |
| `rareKey`, `voteBin` | 4, 0.05 s | the offset vote | `alignment[].method` stays `events` |
| `minMatches` | 8 | fewer shared events and the files are not one round | |
| `minScoreShare`, `minScoreEvents` | 0.5, 8 | the guard: fewer of the kills and scores both hold over the overlap lining up, where both hold that many, and they are two rounds | `guard.files[].scores` |
| `worldClockSlack` | 5 s | the guard, where the scores cannot decide: the world clocks further apart and they are two rounds | `guard.files[].worldClock` |
| `force` | false | merge what the guard refuses (`--force`) | `warnings` |
| `minDriftSpan`, `maxDrift` | 120 s, 0.1% | when a drift is fitted, and how large one may be | `alignment[].driftPpm` |
| `outlierFloor` | 0.05 s | residuals never rejected | `alignment[].rejected` |
| `prefer` | `riding`, `nearest` | how an object's file is chosen | `rates`, `pose.moving` |
| `hysteresisMetres`, `hysteresisSeconds` | 50 m, 2 s | how much nearer, for how long, a file must be to take an object | `selection.switches.nearest` |
| `evalStep` | 0.5 s | how often nearest is looked at | |
| `minSwitchSpan` | 0.5 s | a file about to lose an object does not take it | |
| `childMatch` | `rank` | how a part is found in another file: `rank`, `position` or `disjoint` | `children.rankVsPosition`, `children.partOffsetM` |
| `shotSource` | `shooter` | a recording player's rounds from his own file (`state`: from the object's file) | `duplicates.f` |
| `stateShift` | 0 | seconds added to the continuous records of every file after the first | `pose.lag` |
| `local` | read off each file | each file's recording player | `sources[].localFrom` |

## What the first real pair must confirm

Run `merge_replays.mjs <allies file> <axis file> -o merged.ndjson --report
report.json` and read, in order:

0. **The guard says one round** (`guard.credible`, the lines after the
   report): nearly all the kills and scores of the stretch both recorded
   line up. Refused, the files are two rounds, whatever an admin linked.
1. **`sources[].local` and `localFrom`**: each file's recording player is
   found (`roster`, `own rounds` or `trigger presses`). A file whose player
   never fired and that began at the join says `unknown`: pass `--local`.
2. **`alignment[].method` is `events`**, with hundreds `matched` and
   `residualMs.median` in the tens of milliseconds. Two clients' latencies
   vary independently, so expect more than the split's 14 ms; a `p95` near
   `eventWindow` means widening it.
3. **`alignment[].unmatched` and `events.missing`** hold only team chat, team
   radio and shouts. Any other kind is an event the server does not send
   every client, and its class in `replay-merge-read.js` is wrong.
4. **`guard.files[].worldClock.apartSeconds`** is a fraction of a second, and
   `driftPpm` is within about 100 ppm: the fit and the server's clock agree.
   (`alignment[].worldClock.agree` compares the bounds' upper edges too,
   which one late tick drags down: the one-round pair of 2026-09-29 "missed"
   by 99 ms there, and its lower edges were 0.001 s apart.)
5. **`pose.lag`** is 0 within 0.02 s. Events and ghost state reach a client
   in the same packets (round-replay-capture §2.1), so it should be; if not,
   set `stateShift` to it.
6. **`pose.moving` and `rates[].movingHzByDistance`**: how far the two
   clients' views of one moving object differ, and whether the file farther
   from it writes it less often (the server's priority falls with distance,
   and a teammate across the map is sent at 0.03). If the far file is as good,
   `nearest` matters less than `riding`.
7. **`selection.switches.nearest`**: switches per object per minute. Many
   switches of the same objects is flapping: raise the hysteresis.
8. **`children.rankVsPosition` is 0 and `children.partOffsetM` near 0**: the
   two recorders walk an object's parts in one order. Otherwise use
   `childMatch: 'position'`.
9. **`anim.tables`** are `identical`: both clients run the same mod.
10. **`coverage`**: merged, each side near the own-side figure of one file
    (95-99%), and above either file alone.

## For the players

1. Install bf42++ with the recorder (`dsound.dll` from the bf42plus
   `v2.0-round-replay` release or later) in the game folder.
2. Before joining the server, set `recordReplays = on` under `[general]` in the
   game folder's `bf42++.ini`, or type `plus.recordReplays 1` in the console
   (it saves the setting) and rejoin. A file begun at the join is the most
   complete.
3. At least one player on each side records; more is fine.
4. Everyone plays the same round on the same server, and stays until it ends.
5. Send the `replay_<date>-<time>.ndjson` from the game's `replays` folder
   whose time matches the round. Nothing else is needed.

## Does v5 need a recorder change before the session?

No. The events already align the files to a few milliseconds, below the
recorder's own 100 ms sample period:

- From events alone, the split recovers each file's offset to 1-2 ms and
  its drift to 5 ppm under 30 ms of jitter; a round shares thousands of
  events (3130 in Bocage's 536 s).
- A client receives events and ghost state in the same packets, so the fit
  that lines up the events lines up the state too, and the report measures
  what is left (`pose.lag`).
- A periodic stamp of the client's own world time would carry each client's
  latency exactly as its events do, so it would add nothing the events do
  not. The 10-second timer (0x29) already gives an independent check, to
  39 ms over a Bocage round, and a stamp from the join (0x04) is late by the
  join's own processing (0.17 s there).
- What limits fidelity is the sampling, not the clock: the recorder samples
  the applied world at 10 Hz, out of step with the ghost updates (§19).
  Writing each object as its ghost is applied would fix that, and it is a
  fidelity change, not an alignment one.

What does matter for the session is point 2 above: record from the join.
