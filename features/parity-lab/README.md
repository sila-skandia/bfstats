# Parity lab: real-game scenarios, replayed and compared in the viewer

Goal: a repeatable loop that runs a scenario in the real game, replays it in
the viewer, and puts numbers on how the viewer differs. The recorder and the
replay already exist (`features/round-replay-capture/`). This feature adds the
controlled real-game side (a lab server with bots) and the comparison.

```
scenario (tools/bf1942-models/lab/scenarios/*.json)
  |
  +-- real game: lab server (bf1942_lnxded, coop bots) + client (bf42plus recorder)
  |     `-- run dir: event log, client recordings, settings, run.json        lab.py stop     [built]
  |           +-- replay: map.html?replay=...&serverlog=...&mode=CoOp                        [exists]
  |           `-- real summary: the sim's summary.json metrics, from the run  [phase 2]
  |
  `-- viewer: sim/run.mjs, same map, layer and bots a side, N seeds -> summary.json    [needs --mode]
        `-- compare real rounds with sim seeds -> findings -> fixes                          [phase 2]
```

## Status

| date | |
|---|---|
| 2026-09-26 | Bots run on a lab copy of the LAN server in `GPM_COOP`; the bot count is set per scenario. `lab.py` starts a scenario, reports the round and collects the run. First finding: round tickets scale with max players and the viewer does not scale them. Next is the first client recording of a bot round, which needs someone at the client. |
| 2026-09-27 | The first join landed on server1: the game ignores `+port`. Joining is `+joinServer <ip>:<port>` (see "The rig"); the monitor's `bf1942://` handler is fixed, and `lab.py stop` leaves out a recording made on another server. |

## Where to begin (the order, and why)

1. **Bots on a server we control.** Done; see "Bots on the dedicated server" below.
2. **One bot round recorded from the client, replayed in the viewer.** The
   existing recorder and replay at 30 players, with nothing new built.
   Checklist: `lab.py start lab/scenarios/wake-coop.json`, launch the client
   with the printed join line straight away (the 90 s pregame gets it in
   before the round), stay on the spawn screen for the round (free camera;
   relevance follows it), let the game close itself at the round's end,
   `lab.py stop`, open the printed URL. It answers four things at
   once: how the replay copes with 30 players, how far ghosts reach with
   bots spread across the island (T2 in round-replay-capture §5), whether a
   dead bot's soldier lingers and keeps its network id (T3), and whether the
   recording's `cp` records carry every flag change.
3. **The first comparison, from what already exists.** The event log covers
   the whole map (every bot's spawn, kit, vehicle entry and exit, and kill,
   each with a position) and the client recording carries every flag change.
   That is enough for a real-run summariser that writes the sim's own
   `summary.json` metrics, and for comparing N real rounds with N sim seeds.
   Needs `sim/run.mjs --mode CoOp` (the sim loads the default layer only).
4. **The server recorder.** Continuous whole-map truth: every object every
   tick, projectiles, and bot intent. It is the capture that makes trajectory
   and physics comparisons possible (see "Capture sources").

## The rig on this PC

| | server1 | lab |
|---|---|---|
| process | `bfsmd.static` running `bf1942_lnxded` as `bf1942_user`, systemd `bfsmd-server1`, always on | `bf1942_lnxded` under the desktop login, started and stopped per run by `lab.py` |
| install | `/home/bf1942_user/instances/server1` | `~/bf1942-lab/server`: binary and `lib/` copied, `archives/` linked to server1's, settings snapshotted at `setup` |
| ports | 14567 game, 22000 / 23000 GameSpy, 14723 ASE, 4744 console, 14700 bfsmd | 14568, 22001 / 23001, 14724; no console |
| map | wake `GPM_CQ`, no bots | per scenario |
| event logs | `mods/bf1942/logs/`, mode 0600, owner `bf1942_user`: unreadable without sudo | the run directory, readable by the desktop login |
| to change it | sudo: every file belongs to `bf1942_user`, and bfsmd rewrites `maplist.con` from `servermaplist.con` on start | edit a scenario |

The lab exists because a scenario needs its own settings, a clean restart per
run, logs it can read and (phase 3) `LD_PRELOAD`, none of which server1 allows
without sudo. server1 keeps running as it is.

Join the lab with the port on the address:

```sh
~/.wine/bf1942-monitor/collector/bf1942-monitor.sh +joinServer 192.168.1.226:14568 +isInternet 0
```

That is the line BF1942.exe writes itself when it restarts to join a server
(its strings `+joinServer %s:%s +isInternet 0` and `... +isInternet 1`). The
game ignores `+port`: the first attempt went through the monitor's
`bf1942://` handler, which passed `+joinServer <ip> +port 14568`, and the
recording shows the client on server1 (event 0x1B `BF1942 server1`,
`conquest.con`). The handler now passes `+joinServer <ip>:<port> +isInternet
0|1` (private addresses 0), fixed 2026-09-27 with the old script kept as
`bf1942-monitor.sh.bak-20260927`. The site's Connect button goes through the
same handler, so it could not reach a server off 14567 before this either.

## Bots on the dedicated server

Measured on the lab, 2026-09-26, against `bf1942_lnxded.static` sha256
`18237721…55b2e6` (server1's binary):

- **The switch is the game mode.** `game.addLevel wake GPM_COOP bf1942` in
  `maplist.con`, nothing else. The server's own level archives carry what coop
  needs: `wake.rfa` / `wake_003.rfa` hold `Coop.con`, `AI.con`, `AI/*`,
  `AIpathFinding.con`, `Pathfinding/*.raw` and `SinglePlayer/*`.
- **What turns the AI on.** The binary runs `Bf1942/Game/AIDefault.con` from
  `game.rfa` itself (the path is a string in the binary; no script runs it):
  `game.isAiLevel 1`, `aiSettings.setMaxNBots 64`, `game.autospawnbots 1`.
  `GameServer::gameStatusPlaying` 0x08150df0 then creates bots while the bytes
  at `this+0x64` and `+0x468` are set and `this+0x18 < this+0x1c`, until
  `getMaxNBots() == getBotCount()` (ledger AI-7).
- **The bot count.** `aiSettings.setMaxNBots N` in `ServerAutoExec.con` gives
  N bots split evenly between the sides: 8 gave 4 + 4 and 30 gave 15 + 15, both
  at 32 max players. Without it the bots fill every slot: 16 + 16 at 32 max
  players, 4 + 4 at 8.
- **Coop plays the `SinglePlayer/` layer, not `Conquest/`.** Of the first 35
  spawn events, 17 are on a SinglePlayer soldier spawn and 1 on a Conquest one;
  the other 17 are on the Shokaku's and the Hatsuzuki's decks, spawns the ships
  carry (the layer's `vehicleSoldierSpawns`). The viewer's name for the layer
  is `?mode=CoOp`.
- **The event log's header is wrong for coop.** It says `game mode GPM_CQ` on
  a coop round; the spawns settle which layer ran.
- **Skill.** `game.serverCoopAiSkill` and `serverCoopCpu` are stored and
  reported only (ledger AI-22). Vanilla never calls `aiSettings.setBotSkill`,
  so the dedicated server runs `AISettings::reset()`'s 0.75 (0x08484450),
  which is also `sim/run.mjs`'s default.
- **Identity.** Bots take player ids from 255 downwards. The event log has no
  `createPlayer` for them, so during a round ids and teams come from
  `spawnEvent`. Their names (from `SinglePlayer/Bots.con`'s lists) arrive in
  the client stream's `CreatePlayer` (`ai: 1`) at the join, and in the log's
  `<bf:roundstats>` at the round's end (`player_name`, `is_ai 1`, score,
  kills, deaths, captures per player).
- **Behaviour in the first two minutes of Wake:** the Japanese board the
  Daihatsus and man the Hatsuzuki, the Shokaku AA, a Zero and an Aichi Val;
  the Americans take the Sherman, the M3A1, the Corsair and the AA gun. The
  first kill landed 43 s into the round.
- **Cost.** 30 bots take about a fifth of one core and 60 MB on the server.

### The first recorded bot round (2026-09-27)

Run `20260927-000617-wake-coop`, recording `replay_20260927-001120.ndjson`:

- **The client joined 5 minutes into the round and recorded 160 s:** event
  0x1B `bfstats-lab`, `setLevel` mode file `coop.con`, 31 `CreatePlayer`s (30
  bots, 15 a side, and the human).
- **The server log lines up with a bot round:** the viewer's own
  `alignServerLog`, run in Node on the collected files, puts the log at +299.2
  s from the recording, with 80 of 136 shared events matched and a mean error
  of 0.18 s. The 31 `setTeam`s the join-time snapshot replays cannot match,
  because the server logged them five minutes before the client joined. The
  window holds 167 server rows (joins, kills, deaths, vehicle kills with
  positions) for the feed and the level markers.
- **The round ended on tickets, 434 s after `roundInit`:** Americans (team 2)
  192, Japanese 0, `victorytype 4`. Coop Wake bleeds the Japanese all round
  (`Game.setTicketLostPerMin 1 15`), so a 32-player round lasts about seven
  minutes.
- **The client closed itself 3 s after the round-end status** (`gameStatus 2`),
  with exit code 1 and nothing in the Wine log, and did not come back. BF1942
  restarts its process between maps, and with one round a map every round end
  is one. That restart does not return under the monitor's Wine launch. So a
  recording is one round, and it ends with a clean `end` record. To record a
  whole round, `wake-coop` has a 90 s pregame (`serverGameStartDelay`): launch
  the client as soon as `start` prints the join line and it is in before the
  bots spawn.

### Finding: round tickets scale with max players

| max players | bots | `roundInit` tickets |
|---|---|---|
| 32 | 30 | 200 / 200 |
| 32 | 8 | 200 / 200 |
| 8 | 8 | 50 / 50 |

The level sets 100 a side, so a side starts with `Game.setNumberOfTickets` ×
max players / 16. The bot count plays no part. `GameServer::setNumberOfTicketPerPlayer`
0x08153920 reads `this+0x1c`, the field the bot top-up compares the player
count against, and halves it before multiplying; the rest of its formula is not
traced. (`measured`; the formula `inferred`.)

It also shows which script coop runs: 200 / 200 is the root `Coop.con` in
`wake_003.rfa` (100 / 100), not `GameTypes/Coop.con` in `wake.rfa` (140 / 100),
which would give 280 / 200.

The viewer (`round-state.js`) starts a round at the level's value unscaled,
and for Wake CoOp it reads `GameTypes/Coop.con`: 140 / 100 where the game
starts a 32-player server at 200 / 200. That is two parity items: the
max-player scaling, and which script supplies coop's tickets. Neither is fixed.

## Capture sources

| source | covers | rate | gives | lacks | state |
|---|---|---|---|---|---|
| server event log (XML) | the whole map | per event | spawns (position, team), kits, vehicle entry and exit (position), kills (both positions), vehicle destruction, round start and tickets, chat | motion between events; bot names | on in the lab |
| client recording (bf42plus v3) | ~520 m around the recording client's viewpoint; flags everywhere; every object's creation | 10 Hz, on change | transforms, hit points, seats, flag owners, named players, chat; `fire` events in the uncommitted bf42plus work | distant motion; any projectile with a mesh (round-replay-capture §13); bot intent; the recording player's own soldier is client-predicted | deployed |
| server recording | the whole map | every server tick | every object's transform and velocity, projectiles, hit points, seats, flags, bot state (behaviour, target, route) | effects, sound, animation | phase 3 |
| screen capture | what the player sees | video | effects, sound, animation | numbers | manual |

A spectating client sees what is near its camera, so it cannot follow the
whole of a bot round. The event log can, sparsely. The server recorder is what
makes whole-map motion and projectiles comparable.

## What gets compared

**A. Round behaviour (bots).** A round is not reproducible, so a comparison
is between distributions: N real rounds against N sim seeds with the same map,
layer and bots a side. The metrics are the sim's own `summary.json` ones
(`ticketsOverTime`, `flagsHeldOverTime`, `timeToFirstCapture`, `captures`,
`kills`, `deaths`, `vehicleUtilisation`, `vehicleKills`), plus what the event
log gives cheaply: kit mix per side, spawn choice, vehicle uptake in the
opening, kill distances, round length and winner. A real-run summariser
writes the same schema from a run directory, so `sim/compare.mjs`-style tables
cover both.

**B. Controlled micro-scenarios.** One vehicle or one weapon, driven by a
person with the input stream logged (bf42plus already hooks
`GameClient::registerPlayerAction`, 0x004904F0): top speed, acceleration,
turning circle, climb rate, shell flight time and drop, damage per hit. The
viewer is driven with the same input and the trajectories are compared. Needs
the server recorder for truth.

**C. Presentation.** Effects, sound and animation: a screen capture beside
the replay at the same instant. Stays manual.

## Phase plan

- [x] **0. Bots on a server we control.** Lab copy of server1, `GPM_COOP`,
      bot count per scenario (2026-09-26).
- [x] **Lab tool.** `tools/bf1942-models/lab/lab.py`: `setup`, `start`
      (renders the scenario, waits for the round), `status`, `stop` (collects
      the event log and the client recordings opened during the run, stages
      them under `viewer/replays/<run>/`, prints the viewer URL), `summary`.
      Tests: `tests/test_lab.py`.
- [ ] **1. First bot recording**, replayed (step 2 above).
- [ ] **2. First comparison.** Real-run summariser into the `summary.json`
      schema; `sim/run.mjs --mode`; the replay picking its layer from the
      mode file in the recording's `setLevel` (a Conquest round's reads
      `conquest.con`; a coop round's is unrecorded yet); it loads the level's
      default layer, Conquest on Wake, unless `&mode=` says otherwise.
      Candidate first question: the Wake coop opening (vehicle uptake,
      landings, first capture and capture order) over at least five real
      rounds and five seeds.
- [ ] **3. Server recorder.** A 32-bit `.so` under `LD_PRELOAD` in the lab's
      `bf1942_lnxded` (dynamically linked; `gcc -m32` builds here; 54,895
      symbols, but DWARF only for libstdc++, so struct layouts come from the
      engine-reference corpus). Sample after `Game::updateWorld(float)`
      0x0805d9b0: `ObjectManager::getAllRegisteredObjects()` 0x0819b590 and
      `getProjectileMap()` 0x081a34e0. Write the client recorder's NDJSON plus
      velocity and bot state, so `replay.js` plays it unchanged. A scenario's
      `preload` key already hands it to the server.
- [ ] **4. Micro-scenarios (B)** with the input stream logged by bf42plus and
      a viewer harness that plays it back.
- [ ] **5. Unattended runs.** A spectator client that joins by itself with
      recording on, so rounds can be batched without a person.

## Open questions

- **Joining a server the bots fill.** The top-up only runs while players are
  below max, and `AIMain::deactivateBot` is reached only through its vtable,
  so whether a human joining a full coop server displaces a bot or is refused
  is unknown. `wake-coop` leaves two slots free, so run 1 does not depend on it.
- **Does `setMaxNBots` survive a level load?** `AIDefault.con` sets 64 when a
  coop level loads. The autoexec value held for a single round on a single
  level; a second round or a map change is unchecked. Keep scenarios to one
  round of one level until then.
- **Coop's ticket bleed.** Both Wake coop scripts set the loss per minute at
  15 for team 1 and 10000 for team 2. Whether the bleed scales with max
  players as the starting count does is unmeasured; a full round's length and
  end tickets bound it.
- **Replay at 30 players.** Performance, and how much of the round the
  spectating client sees.

## Files

| | |
|---|---|
| `tools/bf1942-models/lab/lab.py` | the lab |
| `tools/bf1942-models/lab/scenarios/wake-coop.json` | the baseline: Wake co-op, one round, 15 bots a side |
| `tools/bf1942-models/lab/README.md` | usage |
| `tools/bf1942-models/tests/test_lab.py` | settings rendering, map list, console stripping, event-log summary |
| `~/bf1942-lab/runs/<run>/` | one directory per run |
