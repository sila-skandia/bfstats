# Round end: winner screen, reset, and the delay

Status: research complete 2026-09-26; design for approval, not yet built. The
research was done against the lnxded decompiles, the client binary, and the
shipped settings; every claim carries its address or file.

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
- The ticket drain loop's per-tick constants (region `0x08151300+` of
  `gameStatusPlaying`); the setters are all named
  (`setTicketLostPerMin` `0x08153820`, `setTicketLostAtEndPerMin`
  `0x081537f0`, `setNumberOfTickets` `0x081538b0`, `setTicketRatio`
  `0x081539c0`, `setTicketLosePerDeath` `0x0813d700`).
- The client's RoundWon/TicketBlink writer and the blink threshold.
