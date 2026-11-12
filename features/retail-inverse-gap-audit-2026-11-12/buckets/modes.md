# modes

## Summary

26 ledger rows, plus a sweep of `GameServer`, `PlayerManager::getTeamToAddPlayer`, `ControlPoint`,
`ObjectSpawner`, `BFSpawnPoint`/`BFSpawnGroup`, `ScoreManager` in lnxded.static.

Rows: BUILT 17, NOT-GAME 6, PARTIAL 1 (SUP-17), DIFFERENT 1 (SPAWN-35 outside a retail relay),
UNREAD 1 (CA-10). Sweep: 7 findings (1 DIFFERENT, 3 MISSING, 2 PARTIAL, 1 UNREAD).

Top findings by impact:
1. **DIFFERENT, high**: there are no reinforcement waves anywhere but on a retail relay. In solo or
   Instant Battle a human respawns as soon as they commit, and bots come back after a flat 8 s. The
   room server lets a human respawn at once. Retail runs SPAWN-35's 20 + 5 s waves for every
   player, bots included.
2. **PARTIAL, medium**: the room server leaves out TKT-5/TKT-8's stranded-side bleed. A side
   whose spawns are all destroyed never loses in a multiplayer room, though it does on the page.
3. **MISSING, medium**: the team-kill penalty is not built. Retail has punish/forgive, a kick
   after `nrOfTKToKick`, and extra spawn wait for each punished TK (`spawnDelayPenaltyForTK`).
4. **MISSING, medium (multiplayer)**: the room has no pre-game countdown (`gameStartDelay` 20 s,
   `roundStartDelay` 10 s); retail holds every wait at that countdown.
5. **DIFFERENT, low**: the room's auto-team on join is "fewer, tie goes to team 1". Retail's
   `getTeamToAddPlayer` weighs the sides by the team ratios and breaks a tie with `rand()&1`.
6. **MISSING, low**: `nrOfRounds` (5) followed by the next map in the rotation. The room
   restarts the same map forever.
7. **PARTIAL, low**: `ShowRepairIcon` is never set, and the depot icons are fed only on foot.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [DIFFERENT] [impact: high] [effort: M] No reinforcement waves in solo play, Instant Battle or the room server; bots respawn on a flat 8 s
- Retail: SPAWN-35, verified 2026-11-12. `GameServer::init` 0x08131cd0 turns waves on (`+0x201 = 1`)
  for every GameServer. That covers the local server that single player runs, since
  `Setup::initServerSettings` defaults `serverSpawnTime` 20 and `serverSpawnDelay` 3 (NET-21), and
  `singleplayersettings.con` sets neither. Windows open every 25 s, each 5 s long.
  `killPlayer` 0x0814d920 sets **every** player's wait (`BFPlayer+0x8c`) to the next window, or
  the one after it, clamped to 0..127. That includes bots: the same `killPlayer`, and
  `gameStatusPlaying` re-arms every dead player at 0x08152845. A human spawns only once their wait
  is spent and a window is open.
- Ours: `viewer/spawn-timer.js` `spawnWait` is the law, but it only paints a countdown, and only
  on a retail relay (`net-room.js` `spawnCountdown`, null unless `serverAuthority && roomJoined`).
  In solo play, `spawning.js` `deploySpawn` stands the body the moment the player commits, after
  the death cam's framing beat (`local-player.js` `DEATH_CAM`, house rule). Bots respawn after
  `bot-referee.js` `BOT_RESPAWN_DELAY = 8` (flat, line 61; `_respawnIn`, line 561). The room
  server's `room-control.mjs` `onSpawn` checks only `authority.maySpawn` (round status and
  tickets, ROUND-11), with no wait.
- A player notices: in every round. In retail, a death costs up to about 25 s and the sides come
  back in synchronized waves, which shapes the pace of a flag fight. Here the player is back at
  once and bots return 8 s after each death, so pushes never form waves and dying costs almost
  nothing (only the ticket).
- To build: put one wave clock on the round (`round-state.js`: `+0x208`/`+0x20c` from
  `resetTimers`, re-armed in `tick`), and have `spawnWait(diedAt)` give the wait per player.
  Gate the solo player's commit in `spawning.js` `deploySpawn` and paint `#spawn-timer` through
  `deploy-screen.js` `paintSpawnTimer` (which needs a `page.spawnCountdown` off-relay). Replace
  `BOT_RESPAWN_DELAY` with the wave wait in `bot-referee.js`, and have `sim/match.mjs` read the
  same clock. In the room, `authority.mjs` keeps the death time per slot, and `onSpawn` refuses
  (`spawnRefused`) until the wave, sending `sw` so the existing served path paints it.
  Watch out: a bot balance tuned around 8 s will change.

### [PARTIAL] [impact: medium] [effort: S] The room server leaves out the stranded-side end of a round (TKT-5, TKT-8)
- Retail: TKT-5 and TKT-8 (built on the page 2026-10-07). A side with no spawn groups, and nobody
  alive or nowhere to spawn, bleeds at the at-end rate whatever the weights (1000 a minute), and
  the other side's countdown runs at weight/100. DC Weapon Bunkers ends 17.9 s after the bunkers
  fall.
- Ours: `round-state.js` `tick(dt, points, sides)` builds it, and `map.html:4216` passes `sides`
  in solo play. `server/authority.mjs` `bleed` calls `round.tick(dt, points)` with no `sides`
  (line 467), and its own header says "TKT-5's two end-of-round rules ... are not built here".
  `sim/match.mjs:447` does not pass it either.
- A player notices: in a multiplayer room on a level with spawns that can be destroyed (DC Weapon
  Bunkers; any carrier-only side once its ships sink). The round never ends, and the stranded
  side waits forever.
- To build: in `authority.mjs`, compute `sides` with `spawn-flags.js` (the TKT-8 helper at
  line 433) over the room's flags and live players, and pass it to `round.tick`. Do the same in
  `sim/match.mjs`.

### [MISSING] [impact: medium] [effort: M] Team-kill punishment: punish/forgive, the kick, and the spawn penalty
- Retail: `GameServer::TKPunish(int victim)` 0x081593d0. With `TKPunishMode` on (`+0x4e1`; the
  shipped serversettings say 1), it takes the victim's last team-killer (`BFPlayer+0x188`), adds
  one to the killer's two TK counts (`+0x18c`, `+0x190`), and kicks the killer through vt+0x334
  once the count reaches `nrOfTKToKick` (`+0x4d8`, when that is not 0). It then clears `+0x188`.
  `TKForgive` 0x081592e0 is the other answer. `killPlayer` adds
  `ceil(tkCount * spawnDelayPenaltyForTK (+0x4d4)) * (waveTime + window)` to the wait
  (SPAWN-35, 0x0814df1f..0x0814df85). No ledger row covers punish, forgive or the kick.
- Ours: nothing. `console-aliases.js` only names `game.TKPunish`/`TKForgive`. The team kill
  itself is scored (`round-state.js` `SCORE_MSG.tk`), and that is all.
- A player notices: in multiplayer, a team-killer is never penalised or kicked, and the victim is
  never asked. In solo play it matters only once waves exist (the first finding).
- To build: add `lastTeamKiller` on the victim and a TK count on the killer in `authority.mjs`,
  and a punish/forgive control row in `room-control.mjs`. The prompt is client HUD. Its strings
  and keys are not read: settle them with `recorpus.py` for the punish prompt in the client
  before building the UI. The penalty term goes into the wave wait. Whether `killPlayer` raises
  the count on its own with punish mode off is UNREAD (read `killPlayer` 0x0814d920's TK
  branch).

### [MISSING] [impact: medium] [effort: S] Pre-game countdown in the room server (`gameStartDelay`, `roundStartDelay`)
- Retail: ROUND-1 says status 3 is pre-game. `gameStatusPreGame` 0x08150950 counts
  `+0x1ac` (`getDelayBeforeStartingGame`, 20 s by default, NET-21) down by dt, and every frame
  writes it into **every** player's spawn wait (`BFPlayer+0x8c`, the loop at
  0x081509e3..0x08150a08). `+0x1b0` is the round delay (10 s). The client labels the plate
  TIME UNTIL GAME STARTS (HUD-23, `spawn-timer.js` `respawnPlateLabel`). The same function
  balances teams during pre-game when `+0x64`/`+0x468` are set and `0x18 < 0x1c`, through
  `getTeamToAddPlayer` (0x08150a10..). The skip byte `+0x465` (it jumps over all of this) is
  unread, so whether single player waits is UNREAD.
- Ours: `round-state.js` opens straight into `playing`. `server/authority.mjs` `roundState` knows
  only `playing` and `endGame`. `respawnPlateLabel(preGame)` is wired only to a retail relay's
  status.
- A player notices: in a multiplayer room. A fresh map or a restart starts the fight at once,
  where retail gives a 20 s or 10 s warm-up in which nobody spawns.
- To build: add a `preGame` status with its own clock in `round-state.js` (the restart sets 10,
  the map load 20). `maySpawn` already refuses outside `playing`. Send it in the HELLO and the
  round rows so `serverPreGame` lights up off-relay too.

### [DIFFERENT] [impact: low] [effort: S] Auto-team on join, and team balance
- Retail: `GameServer::setTeam(BFPlayer*, int)` 0x08131800.
  - With `forcePlayerToTeam` (`+0x2b8`, `setForcePlayerToTeam` 0x0813d8e0) set, a request to
    change sides is ignored.
  - With team 0 asked, or with `autoBalanceTeam` (`+0x1d0`) on, the side is
    `PlayerManager::getTeamToAddPlayer(ratio1 +0x2bc, ratio2 +0x2c0)` 0x08261670. It counts both
    sides, every player including bots, compares how far each choice leaves the sides from the
    ratio split, and takes the closer one, with `rand()&1 + 1` on a tie (0x0826179e).
  - A live player whose side changed is killed (`killPlayer(p, false)`, 0x08131950).
  - Autobalance defaults to 0 (NET-21).
- Ours: `server/room.mjs` `#autoTeam`: "fewer first, tie lands on team 1" (it counts room
  connections only and ignores the ratios). `spawning.js` `chooseTeam` kills a live soldier who
  changes sides (built, matches). There is no autobalance or force-team switch.
- A player notices: the first player into an empty room is always Axis (team 1), where retail is
  a coin toss. On a level with unequal team ratios the join side may differ.
- To build: port `getTeamToAddPlayer` (the ratio arithmetic and the random tie) into
  `room.mjs`. Add `autoBalance`/`forcePlayerToTeam` as room options if wanted. Decode the exact
  float comparison before porting; this reading took the branches, not each operand.

### [MISSING] [impact: low] [effort: S] Rounds per map and the map rotation
- Retail: `setNrOfRounds` 0x0813dc90 writes `+0x2f0` and `+0x2f4` (5 by default, NET-21).
  `gameStatusEndGame` 0x08152ca0, once `timeBeforeRestartMap` (`+0x21c`) runs out: while
  `+0x2f4 > 1` (and `+0x467` is clear) it restarts the map through vt+0x274 and decrements
  `+0x2f4` (0x08153356..0x08153369). Otherwise it takes the next map (the ServerSettings copy and
  `changeMap` path at 0x08152d25). `gameStatusFirstEndGame` 0x08152a60 reads the same count.
  ROUND-9 notes `nextLevelInMaplist`. No row covers the round count.
- Ours: `server/authority.mjs` restarts the same map every time (`restartIn` -> `onRestart`).
- A player notices: only in a long-lived multiplayer room. It never moves on after 5 rounds.
  This may be deliberate, since a room is created for a level.
- To build: a room-level map list and a round counter in `authority.mjs`/`room.mjs`. A map change
  means a level reload for every client (`level-load.mjs`), so this is a product decision first.

### [PARTIAL] [impact: low] [effort: S] Depot HUD icons: `ShowRepairIcon` never set, and no icons while seated (SUP-17)
- Retail: SUP-17. Three HUD booleans, `ShowRepairIcon`, `ShowHealIcon` and `ShowReloadIcon`
  (client 0x006e3174.., registered by the in-game HUD). Their predicates are SupplyDepot's
  `showRepairIconInMenu` 0x083245d0 and the heal and ammo ones (SUP-5), with the same gates as
  the action.
- Ours: `soldier-view.js:181-182` sets `ShowHealIcon`/`ShowReloadIcon` on foot only.
  `supply.js` `canHeal` already answers for a hull (`target.vehicle`), but nothing calls it
  while seated, and nothing in viewer/ ever writes `ShowRepairIcon`.
- A player notices: a tank parked on a repair pad gets its hit points back, but no wrench icon
  lights up, and a seated gunner at an ammo depot gets no reload icon.
- To build: in the vehicle HUD's frame (`vehicle-hud.js`), set `ShowRepairIcon` from a
  `canRepair(hullTarget)` (a hull row with rate > 0) and `ShowReloadIcon` from `canRearm`.
  Whether retail lights the icons for a seated soldier (which writer runs per frame) is SUP-17's
  open half. Read the client writer first.

### [UNREAD] [impact: low] CA-10: bot-flown B17 outside the terrain loses no hit points
- Retail: an observation with no explanation. Two lab recordings show a B17 more than 3.5 s past
  the 10 s allowance, with hit points flat.
- Ours: `combat-area.js` follows CA-1 and CA-7 (the seated branch burns). If retail spares a
  seated bot, ours would burn a bot plane that retail does not.
- To settle: read the seated branch at 0x08152445 for an AI or seat gate, or record a human-flown
  plane past the edge on the lab.

## From the sweep: retail behaviour with no ledger row

- **Team switching and balance** (`GameServer::setTeam(BFPlayer*,int)` 0x08131800,
  `PlayerManager::getTeamToAddPlayer` 0x08261670, `setForcePlayerToTeam` +0x2b8,
  `setAutoBalanceTeam` +0x1d0): no row covers them. See the auto-team finding above. A change of
  side kills a live player: built (`spawning.js` `chooseTeam`).
- **TK punish/forgive/kick** (`TKPunish` 0x081593d0, `TKForgive` 0x081592e0, `+0x4d8`
  `nrOfTKToKick`, `+0x4e1` punish mode): no row. See the finding above.
- **Rounds per map** (`+0x2f0/+0x2f4`, `gameStatusEndGame` 0x08153356): no row. See above.
- **Pre-game writes the start delay into every player's wait** (`gameStatusPreGame`
  0x081509e3): no row; ROUND-1 names the status only. See above.
- **Conquest capture pays every taker inside the radius** (`ControlPoint::handleFrameUpdate`,
  the loop at 0x08283d23..0x08283d6f: distance <= template `+0x1dc`, player team == the new
  owner, ScoreMsg 1 through vt+0x68): BUILT. `bot-referee.js` pays `takers`, all of the taking
  side inside, and the comment's "INFERRED" can now cite this loop.
- **No heal or repair score in 1942**: `ScoreManager` has only capture, attack, defence, kill,
  death, TK, objective and objectiveTK. Our score table matches, so nothing is missing there.
- **`BFSpawnPoint::isOccupied(float)`** 0x08163da0 (the stamp `+0x130` + `+0x138` against 0.0)
  and `SpawnPoint::isOccupied` 0x081df400: `BFSpawnGroup::getSpawnPoint` 0x08166f60 does not
  call them (`rand()` over `getActive` only). Who calls them is UNREAD. If the bots' spawn choice
  does, two bots could be kept off one point. Low.
- **`ObjectSpawner::getHasUseButton` / `getUseButtonRadius`**: a spawner worked by the use key.
  Nothing in our code reads either. Whether any shipped level sets it is unread: grep the
  installed mods' `.con` for `hasUseButton` to decide whether this matters (likely mod-only).

## BUILT and NOT-GAME, one line each

- SUP-3 BUILT: `supply.js` matches `addVehicleType` names without regard to case, and an unknown
  name never matches, so it repairs nothing and says nothing, as in retail.
- SUP-6 BUILT: `SupplyField.update` runs every depot with no cross-depot state, so depots stack.
- SUP-9 BUILT (the local half): `page-audio.js` plays `Ammorefill` for `triggerRefillAmmoSound`.
  Whether other players hear the IGameServer broadcast from HandFireArms is not modelled (low).
- SUP-14 BUILT: `supply.js` keeps finite reserves, caps and regen for each `addVehicleType` row,
  with no pacing timer beyond the 0.5 s cycle.
- SUP-15 BUILT: `hand-fire.js` medic pack and wrench (`healDistance`/`healFactor`/
  `selfHealFactor`/`repairDistance`/`repairFactor`), with the values from `kit-loadout.js`.
- SUP-21 NOT-GAME: the server event log's begin and end pairs (a recorder detail).
- SUP-22 BUILT: `supply.js` `serveSoldier`/`serveVehicle` heal every cycle, and the clamp is
  `Armor.heal`'s.
- SPAWN-7 NOT-GAME: the extractor resolves a ship deck spawn's team (`extract_map.py`); the game
  reads the result.
- SPAWN-32 BUILT: `round-spawners.js` `logicObjectNode` stands a template with no glb as a logic
  object.
- SPAWN-33 BUILT: `spawned-craft.js` `hullHeldCraftUnder`, `hull-bodies.js`
  `holdSpawnedCraft`, `server/held-craft.mjs`.
- SPAWN-35: the law is in `spawn-timer.js` `spawnWait`, used only to paint the countdown on a
  retail relay. Elsewhere it is DIFFERENT; see the first finding.
- CTF-11 BUILT: the carrier state reaches the page (`ctf.js` carrier; replay `flagHeld`).
- CTF-12 BUILT: `ctf.js` `FLAG_DEFAULTS.timeToRespawn -1`.
- OBJ-4 BUILT: `objectives.js` (delay, team, Timer `timeLimit`, root spawners) and
  `round-state.js` (defender at 100 tickets, `defenderLoseTicketsOnDeath`, attackers lose by
  default).
- ROUND-4 BUILT: `round-state.js` `checkScoreLimit`.
- SIDE-3 NOT-GAME: `bf42/roster.py` nation tokens (extractor).
- SPAWNGRP-6 NOT-GAME: a group only `PreCache.con` creates keeps `groupTeam 0`; the extractor's
  `team_of_group` reads only placed points.
- TKT-7 NOT-GAME: `setNumberOfTicketPerPlayer`; no mode script uses it.
- CAMP-1 BUILT: `bf42/campaign.py` `parse_campaign_map_list`, `play/campaign.js` `launchUrl`.
- CAMP-2 BUILT: `play/campaign.js` `finishMission`, `statusBar` (floors and caps).
- CAMP-3 BUILT: `play/campaign.js` `finalGrade`, `campaignVictory`.
- CAMP-4 BUILT: `campaign-debriefing.js`.
- CAMP-5 BUILT: `play/campaign.js` `storageKey`, one browser save per side.
- CAMP-6 BUILT: `play/campaign.js` `PRESETS`, `AI_SKILL`, and NrOfLives -> `deathPenalty`.
