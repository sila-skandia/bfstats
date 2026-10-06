# Round end: winner screen, reset, and the delay

Status: built 2026-10-06 (Desert Combat parity round, package `round-rules`);
ObjectiveMode's end, the end game's cleared field and the restart's fresh
hulls built 2026-10-07 (package `round-gaps`, section 6).
Section 5 is what was built and how it was checked. The engine law is now
ledger rows ROUND-1..ROUND-9, which supersede sections 1 to 3 where they
differ. Sections 1 to 4 are the research of 2026-09-26 and the design it led
to, approved for this round. The research was done against the lnxded
decompiles, the client binary and the shipped settings; every claim carries
its address or file.

The viewer counts score and tickets live (`viewer-score-and-bleed`,
`round-state.js`) but a round that reaches zero tickets just stops: no winner,
no reset, no result surface. This document is the engine's own round-end law
and the design that follows from it.

## 1. The server-side law (lnxded, decompiled)

**Status field.** The game status lives at `Game+0x58`;
`Game::getGameStatus` `0x080617b0` reads it, `Game::setGameStatus`
`0x080617c0` writes it. `GameServer::updateGameLogic` `0x081505c0` dispatches
every tick: 3 -> `gameStatusPreGame` `0x08150950`, 1 ->
`gameStatusPlaying` `0x08150df0`, 2 or 5 -> `gameStatusEndGame`
`0x08152ca0`. Playing is 1, which confirms the ledger's AI gate (AI-4).

**The transition to endgame.** Inside `gameStatusPlaying` at
`0x081515a8`-`0x081515fc`: the scoreManager's vtable+0x10 is called for team 1
then team 2, and the two `TeamScore+0x20` values (current tickets) are
compared. A winner byte is set (1: `0x081515d5`, 2: `0x08151a82`). Winner !=
-1 means: `ScoreManager::setWinner` `0x08161b80` (vtable+0x54) writes the
winner at ScoreManager+0x5c and bumps that team's win counter, then the call
at `0x081515fc` is `GameServer::setGameStatus` `0x08132b20` (vtable
`0x0871b0e0` slot 0x78) with status **2 (EndGame)**. `setGameStatus` logs
round stats (EventLogger `logRoundStats` + `endRound`) on the way in and fires
a `GameStatusEvent` (vtable+0x210) — the client-visible "round over" packet.

**What EndGame does.** `gameStatusEndGame` `0x08152ca0` on first entry (the
+0x119 flag) runs `gameStatusFirstEndGame` `0x08152a60`: `sendPlayerStats`,
`clearWorld`, `nextLevelInMaplist(true)`, `GameStatusEvent(5, nextMapName)`,
disconnect of lobby users, `giveMedal`. Then a countdown at `GameServer+0x21c`
ticks down by dt; when it expires, if the rounds-left counter
`GameServer+0x2f4` > 1 the call at vtable+0x274 is `restartMap`
`0x08157cb0` (via thunk `0x08159ad0`) and rounds-left decrements; on the last
round the dedicated server saves settings and restarts its own process
(PREEXIT event once, static `0x871b9ec`).

**restartMap — the round reset.** `0x08157cb0` fully decompiled: per-player
re-team/kick, `ControlPoint::reset` for all points, `SupplyDepot::reset`,
`ObjectSpawner::reset`, `clearWorld`, the score wipe (scoreManager vtable+100),
`ObjectiveManager::reset` (status 5), `BFPlayer::resetStats` for every player,
then ticket re-init: `round(N * ratio * param_1[7] * 0.0625)` per team, N =
`GameServer+0x31/0x32` (`setNumberOfTickets` per team), ratio = `+0x7d/0x7e`
(`setTicketRatio`; `0x86c08b4` = 0.0625 = 1/16), `param_1[7]` unidentified
(likely maxPlayers — open). Then the round-start EventLogger event, AI reset,
`GhostManager::reset`.

**Timers — the delay.** `GameServer::init` `0x08131cd0` sets both restart
timers `+0x218` and `+0x21c` to **10.0 s**; `roundDelayBeforeStartingGame`
(`+0x1b0`) inits 0. A static spawn-delay counter at `0x871b9e8` counts down
2->0 and gates early spawns after the reset.

## 2. The delay — shipped values (grepped, not guessed)

A whole-install grep for
`roundDelay|timeBeforeRestartMap|DelayBeforeStartingGame|GameStartDelay|NumberOfRounds`
hits only `Mods/bf1942/Settings/ServerSettings.con`, `AliasedCommands.con`,
and the binaries — the words live in server settings, not in any level rfa.
Shipped values: `game.serverNumberOfRounds 3`,
`game.serverGameStartDelay 3`, `game.serverGameRoundStartDelay 10`
(ServerSettings.con lines 7, 10, 11); AliasedCommands.con:81-82 aliases them
to `admin.delayBeforeStartingGame` / `admin.roundDelayBeforeStartingGame`.
The client console has `restartMap` / `runNextLevel` / `setNextLevel`
(exe `0x4cd9cc`/`0x4cda3c`/`0x4cdab4`).

So the post-round delay is the **10.0 s** `+0x21c` countdown (the
`serverGameRoundStartDelay 10` default), overridable by the admin word.
`game.setMinorVictory 0.40` / `setMajorVictory 0.80` (Game.rfa `Init.con`)
are the victory-class thresholds (how decisively a team won).

Per-level data while we are here: GameTypes tickets mostly 100/team (range
40-150), `setTicketLostPerMin` mostly 15; the score table is the one
`viewer-score-and-bleed` already ships.

## 3. The client's winner surface (partially pinned)

Registry var strings in BF1942.exe: `AlliedRoundWon` `0x524fa4`,
`AxisRoundWon` `0x525004`, `ShowAxisTicketBlink` `0x5259ac`,
`ShowAlliedTicketBlink` `0x5259c0`, `FromSpawnScoreboard` `0x524ef8`,
`GameStatusEndGame` `0x924ee4` (xref `0x2df852`). The end-screen text builder
sits around `0x6e2b60`-`0x6e2f00` and references the lexicon's
`DEBRIEFING_ALLIED_TOTAL_VICTORY` family (`0x51dab4`+) plus `StartingGame`
`0x52513c` and `CameraTimerText` `0x52514c` — the on-screen countdown text.

Not pinned (open, but not blocking the viewer design): the exact writer of
the RoundWon/TicketBlink registry vars (the VHUD-10-pattern writer), and the
ticket blink threshold. The extracted HUD packs
(`maps/_shared/hud/scoreboard/`) carry no RoundWon/TicketBlink entries — the
winner chrome is built from the lexicon keys + `CameraTimerText`, not reused
layout.

## 4. Viewer design

Reuse the deploy overlay wearing round-end chrome, driven by `round-state.js`
(no new screen):

1. **Winner determination** (S): when `round-state`'s tickets reach zero, the
   winner is the team with tickets > 0 at the comparison — the exact
   `0x081515a8` law. Single team dead-in-water on Conquest = tickets; TDM/CTF
   ride the same scoreManager comparison.
2. **Endgame state** (S): enter immediately on zero (the GameStatusEvent
   analogue). Freeze bot decisions (the engine gates AI on status ==
   Playing), stop ticket drain.
3. **The result surface** (M): the deploy overlay with a winner banner
   (lexicon `DEBRIEFING_*` text or the `setMinorVictory`/`setMajorVictory`
   class), the final scoreboard, and the 10 s `CameraTimerText` countdown —
   the retail delay, shown as the engine shows it.
4. **Round reset** (M): on countdown end, run the restartMap sequence through
   the existing systems: control points reset (the capture law already has
   reset paths), supply depots reset, score wipe, tickets re-init with the
   `N * ratio * players/16` formula, then respawn everyone through the spawn
   pipeline behind the 2-tick spawn-delay gate.
5. **Ticket blink** (S, needs the threshold read): feed the
   `Show*TicketBlink` vars when a team's tickets cross the retail threshold;
   leave false until read.

Non-goals: no map rotation (the viewer stays on its level), no
process-restart path (dedicated-server only), no medal/award system.

Phasing: 1-2-3 is one work session and already gives the visible feature
(winner banner + countdown + reset); 4 makes the round actually replay; 5
lands with the threshold.

## Open items before build

- `param_1[7]` in the ticket re-init formula (likely maxPlayers).
  **Answered: it is the max players** (ROUND-3).
- The ticket drain loop's per-tick constants (region `0x08151300+` of
  `gameStatusPlaying`); the setters are all named
  (`setTicketLostPerMin` `0x08153820`, `setTicketLostAtEndPerMin`
  `0x081537f0`, `setNumberOfTickets` `0x081538b0`, `setTicketRatio`
  `0x081539c0`, `setTicketLosePerDeath` `0x0813d700`).
  **Answered by TKT-4 and TKT-5.**
- The client's RoundWon/TicketBlink writer and the blink threshold. Still
  open.

## 5. What was built (2026-10-06)

The law is ledger rows ROUND-1..ROUND-9, read again in full this round. Two
of them change what section 1 says:

- Tickets end Conquest and Co-op only. ObjectiveMode ends when an objective's
  `TeamWinsAward` names a winner (ROUND-2).
- The debriefing is the level's own (ROUND-8). Section 3 took it for a
  generic text and section 4 put the medals out of scope. In fact the client
  writes its title by the local side's result and the victory type, puts the
  level's `game.set<Side>Debriefing*` line under it (Major for a total
  result, Minor for a major or a minor one), plays the win or lose cue once,
  and lists the best three with `giveMedal`'s medals (ROUND-9).

| Piece | File |
|---|---|
| The winner, the victory type, the restart, the medals (`medals`), tickets ending Conquest and Co-op only (`ticketsEnd`) | `viewer/round-state.js` |
| The debriefing: what it says (`debriefingOf`, `debriefingWords`), the plate, the best three, the countdown, the restart on the timer | `viewer/round-end.js` |
| The board held up in its EndGame state (no buttons) with the rounds won | `viewer/scoreboard.js` `boardVars`, `viewer/scoreboard-screen.js` `holdOpen` |
| The win and lose cues (`music/win.mp3`, `lose.mp3`, mod tree then vanilla) | `viewer/page-audio.js` `playRoundMusic` |
| `restartRound`: bots out of their seats and back on their flags, the human to the spawn screen, every point to its start holder with its clock cleared, kits and flags gone home, then `round.restart()`; no bot thinks while the round is over (AI-4); `?scoreLimit=`, `?gameTime=`, `?restartDelay=` | `viewer/map.html` |
| The level's eight lines and the titles, resolved per mod: `scene.json.briefing.debriefing` | `bf42/level.py` `parse_briefing`, `scene_layers.py` (game layer) |
| The medals and the plate (`mp_debriefing_512x512`) | `extract_hud_pack.py` |

The page's own round is a host's: it restarts 10 s after its end (`?restartDelay=`
changes it), as a multiplayer server does. A room's round is its server's; the
page shows nothing at a room's end yet.

Choices the game was not read for:

- **Placement.** The debriefing is laid out from the plate's own three bands,
  centred over the 800x600 virtual screen. The game draws it from
  `menu/LoadMenu`, whose TrueType text nodes (`Trebuchet MS18.dif`) the
  MemeFile flattener in `extract_menu_layout.py` does not read yet; the page
  uses Trebuchet MS too.
- **Medal ties.** How `getPlayersSortedByScore` orders a tie is not read. The
  earlier tally keeps its place.
- **Vehicles.** `ObjectSpawner::reset` is not run, so the hulls keep the state
  the round left: a hull a bot or the human was in stays where it was, and a
  Corsair the human was flying at 260 m over Wake hung there, unpiloted,
  through three restarts (review 2026-10-07). **Built 2026-10-07, section 6.**

### How it was checked

- `tests/test_round_state.py` (`round_state_harness.mjs`) covers:
  - a Wake Conquest round run to zero by kills and the bleed (a total
    victory, medals by score, the 10 s restart);
  - ObjectiveMode out of tickets playing on;
  - the existing cases: bled out, a draw, single player, the time limit,
    the CTF score limit.
- `tests/test_round_end.py` (`round_end_harness.mjs`) covers:
  - the title and line for every result and victory type, and the English
    fallback;
  - the medal art and the countdown text;
  - the flow: open, cue, board held, restart on the timer;
  - a new level closing the screen;
  - a draw with no cue;
  - a single-player round waiting.
- `tests/test_ctf.py` plays a CTF round to a cap limit of three.
- `tests/test_scoreboard.py` and `test_scoreboard_screen.py` cover the
  EndGame board, the rounds won and the hold that Tab cannot drop.
- `tests/test_level.py` covers the eight debriefing lines and their
  resolution, Wake's from the real archive among them.
- In the page, both run with `~/.cache/dc-sweep/round-rules/ctf_page.cjs`,
  with the scratch medals, plate and patched `scene.json` served by
  `page.route`:
  - **Vanilla Wake Conquest** (`?maxPlayers=1&botCount=2`, so 6 tickets a
    side): six kills ran the Japanese out. The board and debriefing showed
    TOTAL VICTORY, Wake's own Allied line, the gold, silver and bronze, and
    the countdown, and the win cue played. Five seconds later the round
    restarted on 6/6 tickets with the rounds won 0/1 and the spawn screen
    open.
  - **DC Desert Shield CTF** (`?scoreLimit=1`): the capture ended the round
    as a Coalition MINOR VICTORY with Desert Combat's own line, then
    restarted the same way.
- Review, 2026-10-07 (`~/.cache/dc-sweep/review-round-rules/restarts.cjs`,
  the page's own loop stopped, each round ended by `?gameTime=0.05` and
  restarted after `?restartDelay=1`, three restarts back to back): vanilla
  Wake Conquest with the human alive, dead on the death cam, seated in a
  Sherman, and flying a Corsair at 260 m; DC Desert Shield CTF with the human carrying the Iraqi flag at the
  end, and dying with it 30 m off the base; XPack1 Anzio Co-op; XPack2
  Eagle's Nest TDM and ObjectiveMode. After every restart the tallies, clock,
  tickets, flags and debriefing were fresh, the bots alive and out of their
  seats, the spawn screen open and the next spawn worked, with no page error.
  The seated human came back with neither a body nor a spawn screen:
  `restartRound` read the pilot box a seat checks as not playing. Fixed.

### Assets the trees need

These are not in the live trees yet. Without them the page still ends and
restarts the round, with the English titles, no level line and a plain plate.

1. **The level lines and titles**, a game-layer patch in every tree:
   `patch_scene.py --layer game --mod <M> --all`, then
   `publish-mesh-delta.py maps --hash`. Checked on copies of Wake, El Alamein
   and DC Desert Shield: only `briefing.debriefing` changes.
2. **The medals and the plate**: `extract_hud_pack.py --mod <M>` for each
   pack, then rebuild the mod packs' `pack.json` the way
   `extract_hud_mods.py` does.

### Still open

- The client's `Show*TicketBlink` writer and threshold (the counters do not
  blink).
- The `+0x473` override of the time-limit share comparison (ROUND-3).
- ~~ObjectiveMode rounds do not end on the page~~: built 2026-10-07,
  section 6.
- ~~ObjectiveMode's own debriefing~~: built 2026-10-07, section 6.
- What sets `GameServer+0xd0`, which a multiplayer server needs to give
  medals at all (ROUND-9).
- `menu/LoadMenu`'s own layout, for the exact placement.
- A room's end of round on the page.

## 6. ObjectiveMode, the end game and the restart (2026-10-07)

Package `round-gaps` of the Desert Combat parity round. The engine law is
ledger OBJ-1..OBJ-6 (the objectives, their awards, ObjectiveMode's tickets and
words) and ROUND-10 (the end game's `clearWorld`, the restart's
`ObjectSpawner::reset`), read out of the Linux server; ROUND-2 and ROUND-8 are
marked built.

**ObjectiveMode.** Every ObjectiveMode layer sets only one side's tickets
because the server gives the defender a flat 100 at the first pre-game, and
the round is won by an objective, never on tickets.

| Piece | File |
|---|---|
| The ObjectiveMode script's run graph read for its objectives, the spawners that stand them up, `objectiveManager`'s words and the pads a DestroyTarget watches; the pads join the layer as vehicle pads | `bf42/level.py` `script_files`, `parse_objective_setup`, `add_objective_targets`; `extract_map.py` `load_level` |
| `scene.json.modes.ObjectiveMode.objectives` (the game layer) and `briefing.debriefing.objective`, the `VICTORY` / `DEFEAT` titles | `scene_layers.py` `_objectives_report`; `bf42/level.py` `DEBRIEFING_VERBS` |
| The objectives' frame, completion and awards | `viewer/objectives.js` |
| The defender's 100, the deaths a side pays, the HUD's counts scaled by the enemy root objective, the win | `viewer/round-state.js` `objectiveStart`, `showObjectiveTickets`, `deathCosts`, `objectiveScore`, `objectiveWin` |
| The debriefing's ObjectiveMode branch | `viewer/round-end.js` `debriefingOf` |
| Each target found among the vehicle pads by spawner and position | `viewer/objectives.js` `matchTargets`; `viewer/map.html` `levelObjectives`; `viewer/vehicle-wrecks.js` `damageOfNode` |

**The end game.** On the first EndGame tick, once the debriefing has read the
medals, the page empties the field as `clearWorld` does: every bot is killed
in his seat or out, the human's soldier is taken (the camera stays where it
was; the engine moves it to the level's before-spawn camera), every hull goes
with no wreck left, the kits go. The human cannot spawn until the round plays
again (`spawning.js`). The pads keep running.

**The restart.** `restartRound` clears the field again and resets every pad
(`level-statics.js` `restartVehiclePads`): its slots empty, its pre-game team,
on as the round opened, its delay -1 or `spawnDelayAtStart`'s. Each stands a
fresh hull on its own spot on its next frame; a hull no pad names comes back
where it was placed (`vehicle-wrecks.js` `restartHulls`).

### How it was checked

- `tests/test_objectives.py` (`objectives_harness.mjs`): Battle of Britain's
  start (Axis 200 at 32 slots, the Allies' flat 100), the timer's win 3 s
  after 900 s, `objectiveAttackerTicketsMod` 50 halving it, the targets'
  completion on the Allied count (half the factory is 90), a destroyer paid
  `objective` or `objectiveTK` by side, the composite's win 3 s after the
  fifth target, deaths, the restart, an absent target, Eagle's Nest's swapped
  sides, the target matching, and Conquest unchanged.
- `tests/test_objective_setup.py`: the parser on Battle of Britain's own
  lines (the factory pad's redefinition, a malformed vector) and on the
  shipped archive; the report; the objective debriefing lines.
- `tests/test_round_end.py`: the ObjectiveMode titles and lines, and the field
  cleared once on the end game's first tick, after the medals.
- `tests/test_vehicle_pads.py`, `tests/test_vehicle_wrecks.py`: every pad
  standing its hull up again after a restart, back to its opening team; an
  intact, a burning and a wrecked hull all off the field at the end, and fresh
  after.
- In the page (`~/.cache/dc-sweep/round-gaps/objective_page.cjs`, vanilla
  Battle of Britain ObjectiveMode at 32 slots, a scratch bake served by
  `page.route`):
  - **The targets.** The five targets stood on their pads (the factory 1000 HP,
    the towers 600); half the factory took the Allied count to 90, all five
    destroyed took it to 0, and 3 s later the Axis won, a total victory. The
    Allied player read DEFEAT and Battle of Britain's Allied objective defeat
    line, with the lose cue. During the end game no player was alive and every
    target pad was empty; after the restart all five stood at full health,
    every objective was fresh and the counts were 198 / 100.
  - **The timer.** With the live tree's glb (no targets), the timer set to
    895 s ended the round 3 s after 900 s for the Allies: VICTORY, the Allied
    objective victory line, the win cue, a total victory; the restart made the
    objectives fresh.

### What the lead runs

The ObjectiveMode layers gain their target pads, so the eight levels need a
**scene re-bake** (`extract_map.py <level> --mod <M>`, `optimise_mesh.py`,
publish): vanilla `Battle_of_Britain`, DC Final `Battle_of_Britain`, and
XPack2 `Eagles_Nest`, `Essen`, `Hellendoorn`, `Kbely_Airfield`,
`Mimoyecques`, `Telemark`. Every tree then needs the **game layer**
(`patch_scene.py --layer game --mod <M> --all`: the objectives and the
objective debriefing lines and titles) and the **spawns layer** (the target
pads in `modes.ObjectiveMode.objectSpawns`). The models trees have no
`Factory_Objective.wreck.glb`, so the destroyed factory fades its intact mesh.

### Still open

- The objectives' HUD (the objective icons and their completion bars) is not
  drawn.
- The time limit's share in ObjectiveMode divides by the level's raw count,
  which Battle of Britain does not set for the defender (0); with a time
  limit set, the defender's share reads 0.
- The engine's before-spawn camera at the end game, and the pre-game between
  a restart and play, are not modelled.
- A room's round still has no end game or restart.
