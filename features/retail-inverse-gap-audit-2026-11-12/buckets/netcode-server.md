# netcode-server

Scope: the 42 uncited NET/P/D/J/W/R rows, plus a sweep of every `game.server*` / `admin.*` word in
`bf1942_lnxded.static` against the page (single player and Instant Battle), the room server
(`tools/bf1942-models/server/`, the site's own multiplayer) and the relay path (a real lnxded server,
where the retail server enforces its own settings, so it is out of scope for most findings).

Three game paths matter for every finding below:
- **SP page**: `map.html` with bots, `bot-referee.js`, `round-state.js`.
- **Room**: `server/room*.mjs`, `authority.mjs`; joined by `net-room.js` / `netcode-client.js`.
- **Relay**: `net-relay.js`; the lnxded server owns the rules there.

## Summary

Rows: BUILT 27, NOT-GAME 14, PARTIAL 1 (NET-21). Sweep: MISSING 7, PARTIAL 3, DIFFERENT 3, UNREAD 3.

Top findings by impact:
1. DIFFERENT, high: no reinforcement waves off the relay. The local player respawns the moment they click (after a 3 s death cam), bots after a flat 8 s, and room players straight away. Retail makes everyone, bots included, wait for the next window: `serverSpawnTime` 20 + 5, so 5 to 30 s (SPAWN-35, NET-21).
2. MISSING, high: rooms have no bots, so there is no online co-op. Retail's dedicated server fills co-op with bots; the room has no referee at all.
3. DIFFERENT, medium: in a room, switching side on the deploy screen spawns the player on the other side on their own page, while the server keeps the side the player joined with. `onSpawn` ignores `row.team`, so friendly fire, tickets, capture and the radio all use the joined side.
4. MISSING, medium: no team-kill handling. Retail counts team kills, offers punish or forgive, adds the TK spawn penalty, and kicks at 5 team kills, which can turn into a ban.
5. MISSING, medium: no voting (map, kick, team kick), no kick or ban, no admin.
6. PARTIAL, medium: CREATE GAME lists 14 server settings that a room ignores, and the room's round ignores time limit, score limit and ticket ratio.
7. MISSING, low-medium: no pre-game delay (`serverGameStartDelay` 20 s, "TIME UNTIL GAME STARTS") in SP or a room.
8. DIFFERENT, low-medium: off a retail server the name tags use the client's own 75 m, but retail's own listen server caps them at 50 m (`serverNameTagDistance` 50). Same in rooms.
9. PARTIAL, medium: a late joiner's scoreboard in a room starts at their join. The board is built from the client's feed, and HELLO carries no scores.
10. MISSING, low: no map rotation or round count. A room restarts the same level forever; retail runs `serverNumberOfRounds` and then moves to the next map in `maplist.con`.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [DIFFERENT] [impact: high] [effort: M] Respawns ignore the reinforcement wave everywhere but the relay
- Retail: `killPlayer` 0x0814d920 with waves on (`GameServer+0x201 = 1` from `init` 0x08131cd0) sets the wait (`BFPlayer+0x8c`) as follows:
  - when the time to the next window is more than the window (0x0814dee8..0x0814defb), the wait is that time;
  - otherwise it is that time, plus the rest of the open window, plus `serverSpawnTime` (0x0814df01..0x0814df13);
  - the wait is clamped to 0..127.

  Windows are `serverSpawnTime` (default 20, NET-21; shipped dedicated `serversettings.con` 20) plus 5 s long, counted from the round start (SPAWN-35). This applies to every BFPlayer, bots too. `spawnPlayer` 0x0814c990 only exempts a bot from the game-status test, not from the wait. `serverSpawnDelay` 3 applies only with waves off. A retail listen server (SP, Instant Battle) runs the same GameServer.
- Ours:
  - SP: `local-player.js` gives a fixed 3 s death-cam beat (`DEATH_CAM_BEAT`), then the deploy screen spawns on the click (`spawning.js` `deploy`). `bot-referee.js` `BOT_RESPAWN_DELAY = 8` gives bots a flat 8 s.
  - Room: `room-control.mjs` `onSpawn` spawns at once (`authority.maySpawn` tests only the round status and tickets).
  - `spawn-timer.js` has the full wave law (`spawnWait`), but it only paints the relay's plate.
- A player notices: every life. In retail a death costs on average about 15 s and everyone comes back together in waves. On the page the player is back in 3 s and bots trickle back one by one every 8 s, which changes the pace of the whole game and makes a flag rush much cheaper.
- To build:
  - Move `spawnWait` from `spawn-timer.js` into the round, using `round.clock` as the GameServer `+0x208/+0x20c` pair.
  - SP: gate `spawning.js` deploy and `bot-referee.js` `respawnTick` on it, replacing `BOT_RESPAWN_DELAY`.
  - Room: gate `room-control.mjs` `onSpawn` (refuse with `spawnRefused` plus the wait) and send the wait in the player row, so `net-room.js` `spawnCountdown` paints the server's number as it already does for the relay.
  - The TK penalty (below) adds to the same wait.

### [MISSING] [impact: high] [effort: L] No bots in a room (no online co-op)
- Retail: a dedicated server in Co-op (GPM 4) runs the AI for every empty slot. `serverCoopAiSkill` and `serverCoopCpu` are stored and reported only (AI-22), but the bots themselves play. `CON-24`'s `listPlayers` prints "is an AI bot" for them.
- Ours: `server/` has no referee, no bot, no `createBot`; `git grep -i bot -- server/` finds only a comment. Bots exist only in the SP page and in `sim/`.
- A player notices: any online game on play.bfstats.io with fewer than a full room is an empty map. Retail Co-op online (humans with bots) cannot be played.
- To build: run `bot-referee.js` inside `server/room.mjs` against the room's `World` (as `sim/match.mjs` already does headless), give bots slots in the roster and snapshot rows, and drive their damage and deaths through `authority.mjs`. Large: CPU budget per room on the single node (CLAUDE.md deployment constraints), and bots must use the same input path as remotes.

### [DIFFERENT] [impact: medium] [effort: S] A room ignores a change of side on the deploy screen
- Retail: the deploy screen's team tab sends SetTeam. `GameServer::setTeam(BFPlayer*, int)` 0x08131800 does the following:
  - overrides the pick only when `forcePlayerToTeam` (`+0x2b8`) or `autoBalanceTeam` (`+0x1d0`) is set, through vt+0x60 with the team ratios `+0x2bc/+0x2c0`;
  - calls `BFPlayer::setTeam`;
  - logs the event;
  - kills a live player whose team changed (0x08131950).
- Ours: `spawning.js` `chooseTeam` lets the tab switch sides in a room, and the spawn row carries `team: spawning.deployTeamId` (spawning.js:207). But `room-control.mjs` `onSpawn` uses `connection.team` (set once at `room.mjs` `join`) and never reads `row.team`. `onSpawn` also accepts any flag index without checking that the flag is the player's side's.
- A player notices: in a room, someone who clicks ALLIED after joining as Axis spawns at the Allied base on their own screen and plays as Allied. Every other client, and the server's friendly fire, tickets, capture and team radio, still treat them as Axis.
- To build: in `onSpawn`, take `row.team` when it is 1 or 2 and differs, apply `setTeam` (kill a live body, broadcast a team row, update `connection.team`), and refuse a flag the side does not own. Also handle a team row in `net-room.js` for the roster.

### [MISSING] [impact: medium] [effort: M] Team-kill punish/forgive, the TK spawn penalty and the TK kick
- Retail (lnxded):
  - `_giveDamage` 0x0814b870, on a team kill: the victim's `BFPlayer+0x188 = TKer id + 0x100` (0x0814c1bc).
  - With `serverTKPunishMode` 0 (`GameServer+0x4e1`, ctor 0; the shipped client host file 0), the TKer's counts `+0x190` (since their last death) and `+0x18c` (total) go up at once. At `nrOfTKToKick` (`+0x4d8`, ctor 5.0 = 0x40a00000) the TKer is killed (0x0814c224).
  - With punish mode 1 (the shipped dedicated `serversettings.con`), nothing counts until the victim types `punish` (`TKPunish(int)` 0x081593d0, which increments both counts and kicks at the limit through vt+0x334 `kickPlayer(id, 0)`) or `forgive` (`TKForgive(int)` 0x081592e0, which clears `+0x188`).
  - `spawnPlayer` 0x0814c9c8 refuses and kicks a player whose total is at or over the limit (0x0814d841).
  - `killPlayer` adds `round(+0x190 * spawnDelayPenaltyForTK)` (`+0x4d4`, ctor 1.0) to the respawn wait, scaled by the wave cycle (0x0814df1f..0x0814df85; the exact product is worth one more read), then zeroes `+0x190`.
  - `destroyPlayer` 0x08133f4c bans the address when `banPlayerOnTKKick` (`+0x4e0`) is set and the total is at the limit.
- Ours: friendly damage at 100% is built (`friendly-fire.js`, FF-3/FF-4). The kill feed's team-kill line is built (`chat-log.js` `teamKillLine`). `console-aliases.js` aliases `punish`/`forgive` to `game.TKPunish`/`TKForgive`, which no console command implements, so they answer "Unknown object or method". The room keeps no TK counts.
- A player notices: in online rooms a griefer can team-kill without limit. Retail kicks them after 5, and with punish mode on the victim is prompted to punish or forgive.
- To build: keep counts per connection in `authority.mjs` `decreeDeaths` (the attacker's team equals the victim's and the round's `canTK` is true, FF-5). Add a `punish`/`forgive` action row in `room-control.mjs` and the console words in `console-commands.js`. The kick goes through `room.leave` + close. Add the penalty to the wave wait. SP needs only the counts if bots are to be kicked; retail would kick a TKing bot too, a low priority.

### [MISSING] [impact: medium] [effort: M] Voting, kick, ban and admin
- Retail:
  - Votes: `GameServer::voteMap` 0x0814a000, `voteKickPlayer` 0x0814a050, `voteKickTeamPlayer` 0x0814a0f0, `castVote` 0x081497c0 and `updateVoteSystem` 0x08149d60, run every frame (D-1). The `Vote` class issues, lays and sums votes. `VoteEvent` 0x12 goes to clients with target, yes, no, required, voter, time, action and type (NET-20).
  - Shipped `AdminSettings.con`: all three votes enabled, majority 0.6, `votingTime 60`.
  - Kick and ban: `kickPlayer(int,bool)` 0x08148d40, `banPlayer` 0x08148f00 / `banPlayerKey` 0x08149010, timed bans in `updateBanList` 0x08149210 (every frame), the list saved by `Setup::storeBanList` 0x080c0080.
  - Admin: `admin.*` words (`runNextLevel`, `restartMap`, `togglegamepause`, `listBannedAddresses`, `clearBanList`, `addAddressToBanList`, `enableRemoteConsole`/`enableRemoteAdmin` ...).
- Ours: `console-aliases.js` carries the aliases (`votemap`, `kick`, `kt`, `nextmap`, `restart`, `banlist`, ...). Only `admin.toggleGamePause` (`console-commands.js`, SP) does anything; the room has no vote, kick, ban or admin channel.
- A player notices: in an online room nobody can vote a map or kick an abusive player, and the room's creator has no admin powers.
- To build: a `vote` action in `room-control.mjs` with a per-room `Vote` (issue, lay, sum, 60 s, 0.6 majority of the side or of all players per type, as `calcVotesNeeded` 0x0814a430 would give, which still needs reading). Broadcast a VoteEvent-shaped row and draw the retail vote HUD (VHUD/`menu` vote text). Kick through `leave` + close, and a ban list keyed by connection address. Give the room creator admin.

### [PARTIAL] [impact: medium] [effort: S] A room's round has no server settings: CREATE GAME's settings rows do nothing
- Retail: `serverGameTime` (minutes, `startHostGame` times 60), `serverScoreLimit`, `serverTicketRatio` (TKT-1 `/100`), `serverNumberOfRounds`, `serverSpawnTime`, `serverGameStartDelay`, the four friendly-fire percentages, `serverMaxPlayers`, the password: all are taken from the host's CREATE GAME pages.
- Ours: `play/create-game.js` says the page's other fourteen rows "are the dedicated server's, and the room server takes none of them". `authority.mjs` builds `createRoundState` with no `gameTime`, `scoreLimit` or settings; `MAX_PLAYERS` is fixed at 16 (`netcode.js`); `round-state.js` `startingTickets` has no ticket ratio ("the viewer has no setting for"). SP takes `?gameTime=`, `?scoreLimit=` and `?maxPlayers=` from the URL only (map.html:1959-1970).
- A player notices: a host cannot make a timed round, a score-limited CTF, a no-friendly-fire game or a short-ticket game. Every room plays the defaults. This is visible only to a player who tries the settings, since the defaults match retail's 0/0/100/100.
- To build: carry the settings in the create-on-join row (`net-room.js` `sendJoin`), validate and keep them per room in `room-registry.mjs`, and pass them to `createRoundState` (`gameTime`, `scoreLimit`), `friendlyDamage` (`settings`), the ticket start (`ticketRatio`) and the wave law. Make the create-game rows editable.

### [PARTIAL] [impact: medium] [effort: S] A late joiner's scoreboard in a room misses everything before the join
- Retail: the joining client's database carries every BFPlayer with score, kills and deaths. The board is the server's from the first frame (J-1, `sendDatabase` 0x08134400).
- Ours: `room.mjs` `helloRow` sends `slots` with name and team only. `scoreboard-screen.js` `currentRows` builds a room's board from `page.roomClient.feed`, the rows seen since joining.
- A player notices: someone joining a room halfway through sees everyone at 0 kills and 0 score except what happened after they arrived, and the end-of-round best three can be wrong for them.
- To build: keep score, kills and deaths per slot in `authority.mjs` (it already sees every death), put them in HELLO's roster and in a periodic or per-change row, and seed the board from them.

### [MISSING] [impact: low-medium] [effort: S] No pre-game ("TIME UNTIL GAME STARTS")
- Retail: game status 3 (ROUND-1) for `serverGameStartDelay` (default 20, NET-21; shipped dedicated 20). Nobody spawns until status 1 (ROUND-11), and the plate reads `TIME_TO_START` (HUD-23). `HUD-24`'s status line covers "ADDITIONAL PLAYERS NEEDED" (min players) and "GAME IS RESTARTING".
- Ours: the relay paints it (`net-room.js` `serverPreGame`, `status-message.js`). A room's round and the SP round start at status playing at once (`authority.mjs`, `round-state.js`).
- A player notices: on a retail server the first 20 s of a map are a countdown on the spawn screen. In a room or SP the round is live the moment the level loads.
- To build: a `preGame` status in `round-state.js` with its countdown, refused spawns in `maySpawn` and SP deploy, and `serverPreGame` true for a room. Low value in SP, where the retail host's own file sets 3 s.

### [DIFFERENT] [impact: low-medium] [effort: S] Name tag distance off a retail server is 75 m, not 50 m
- Retail: near distance = `min(client 75, serverNameTagDistance)` (HUD-16). `Setup::initServerSettings` defaults `serverNameTagDistance` to 50 (0x080c0a55, NET-21) and both shipped files write 50. A retail single-player game is a listen server with those settings, so its tags read out to 50 m. The scope stays 300.
- Ours: `nametag-layer.js` takes the caps from the relay or a replay. Otherwise `serverNear = Infinity`, so `nameTagDistances` gives 75. A room client has no `serverNameTags`, so a room gets 75 too.
- A player notices: friendly name tags show out to 75 m in SP and rooms, 50% further than retail.
- To build: default `serverNear`/`serverScope` in `nametag-layer.js` to 50/300 (the server defaults) when no server has spoken, and have the room's HELLO carry the pair like the relay's SetLevel.

### [MISSING] [impact: low] [effort: M] No map rotation or round count; a room replays one level forever
- Retail: `serverNumberOfRounds` (`GameServer+0x2f0`, default 5, shipped 3) with `maplist.con`. `gameStatusFirstEndGame` 0x08152a60 calls `Setup::nextLevelInMaplist` (ROUND-9), and `admin.runNextLevel` / `changeMap` 0x081496b0 move the server on.
- Ours: `authority.mjs` `restartRound` always restarts the same level after 10 s. Rooms carry no map list.
- A player notices: a room never moves to a new map without everyone leaving and making a new room.
- To build: a per-room map list (CREATE GAME page), counting `roundsWon` totals against the round count, and a level change that reloads `LevelInstance` and sends a fresh HELLO-like row. That needs a mid-session level swap on the page, which is M at least. Which counter is tested against `+0x2f0` is unread; read the `getNrOfRounds` vtable callers in `gameStatusEndGame` 0x08152ca0 first.

### [MISSING] [impact: low] [effort: S] Auto-balance on death
- Retail: `killPlayer` 0x0814dc1f. With `serverAutoBalanceTeams` (`+0x1d0`) set, not in game status 2 or 5, and the team counts (PlayerManager vt+0x5c for teams 1 and 2) more than one apart, the dead player is moved by `setTeam` (vt+0x144) to the team that vt+0x60 picks from the ratios `+0x2bc/+0x2c0`. A bot is handled by the branch at `+0x64`. It is off by default (NET-21) and off in both shipped files.
- Ours: `room.mjs` `#autoTeam` places a joiner on the smaller side (a tie goes to team 1). There is no rebalance later.
- A player notices: only on a server that turns it on. Low.
- To build: one test in `authority.mjs` `decreeDeaths` once the room has settings.

### [MISSING] [impact: low] [effort: S] Welcome message, server password, reserved slots
- Retail: `game.setServerWelcomeMessage`; `WelcomeMsgEvent` 0x17 (NET-20) goes to a joining client. Also `serverPassword`, `serverReservedPassword` / `serverNumReservedSlots`.
- Ours: none in the room (create-game.js: the password row is the dedicated server's).
- A player notices: rarely. A private room is protected only by its code.
- To build: optional fields on the create row, a check in `room-registry.mjs` `join`, and a chat line on HELLO.

### [UNREAD] [impact: low] What `serverFreeCamera 0` forbids a dead player
- Retail: the client's wait view after commit is a FreeCamera object in death-camera mode. `FreeCamera::updateDeathCamera` (lnxded 0x081b73c0) returns at once while the static `m_enableFreeCamera` is set, and otherwise follows players (`followNextPlayer`). How `serverFreeCamera` reaches `m_enableFreeCamera` was not read. The Mac decompile shows no caller of `Setup::getServerFreeCamera`.
- Ours: `spawning.js` enters the page's free camera (`enterFreeCam`) while waiting for a server spawn, so a player can fly anywhere.
- A player notices: possibly as a scouting exploit, if retail limits the dead player's view to the death cam.
- To settle: xref the `serverFreeCamera` console setter (client `0x00423xxx` family, the same place HUD-16 found the name-tag ones) to its store, then the readers of that byte and `FreeCamera::m_enableFreeCamera`.

## From the sweep: retail behaviour with no ledger row

- `serverDeathCameraType` is stored and saved only. The Mac and WinPC decompiles show its getter called by nothing but `saveServerSettings`, and lnxded has no reader symbol. NOT-GAME, which confirms `server-settings.js`'s choice not to honour it. Worth a ledger row so nobody builds it.
- The TK fields: `GameServer+0x4d4` spawnDelayPenaltyForTK (1.0), `+0x4d8` nrOfTKToKick (5.0), `+0x4e0` banPlayerOnTKKick, `+0x4e1` TKPunishMode; `BFPlayer+0x188` the last TKer (+0x100 marks one pending), `+0x18c` total TKs, `+0x190` TKs since death. All are read above, with no row.
- `setTeam(BFPlayer*, int)` 0x08131800 kills a live player who changes side, and `forcePlayerToTeam` (`+0x2b8`) or auto-balance override the pick. No row.
- Auto-balance on death (0x0814dc1f). No row.
- Votes: `VoteEvent` layout is NET-20; the logic (`issueVote`, majority, `updateVoteSystemVote`) has no row. `calcVotesNeeded` 0x0814a430 is unread.
- `spawnPlayer` kicks a player at the TK limit (0x0814d831..0x0814d847). No row.
- The room has no chat (`net-room.js`: "a room has no chat"); only radio is relayed (`room-control.mjs` `onRadio`). Text chat (all/team) is a high-visibility online gap, probably also another bucket's (console-menus).

## BUILT and NOT-GAME, one line each

- NET-10 BUILT: `netcode-reconcile.js` `createHullReconciler` takes the server velocity with the transform.
- NET-12 BUILT: `netcode-reconcile.js` turret reconcile from the ack's `haim`, replaying servo ticks.
- NET-13 BUILT: `net-relay.js` (~692) decodes the recoil counter bits.
- NET-14 BUILT: `net-relay.js` `detonate` case ends the round on the detonate bool.
- NET-17 NOT-GAME: the lab server's fd_set crash.
- NET-18 NOT-GAME: the recorder's stats events. The page's round-end board uses the relay's or its own tallies.
- NET-19 BUILT: `page-audio.js` `playRefillSound` for the refilled player only.
- NET-20 NOT-GAME: event layouts, for relay and recorder decoding.
- NET-21 PARTIAL: `spawn-timer.js`, `friendly-fire.js`, `server-settings.js`, `room-rules.mjs` `CHOKE_CAP` carry the defaults. Spawn waves, start delay, name-tag 50 and round count are not applied (findings above).
- NET-22 BUILT: `room-rules.mjs` `HEARTBEAT_TIMEOUT_MS` 25 s, a documented departure.
- P-1 BUILT: `netcode-client.js` / `world.js`, the local player predicted from the same input record.
- P-2 BUILT: `netcode-client.js`, 100 ms interpolation over a ring.
- P-3 NOT-GAME: recorder (rings only advance while ghosted).
- P-4 BUILT: `net-relay.js` soldier record fields; the room's snapshot carries its own equivalent.
- P-5 BUILT: `netcode-render.js` / `ghost-draw.js`, remotes drawn behind and the control object on time.
- P-6 BUILT: `ghost-draw.js` `clientClockShift` (tick + actions in flight − interp).
- P-7 BUILT: `netcode-client.js`, newest-record states, held rotation.
- P-8 BUILT: `ghost-draw.js`, 500 ms pair gap and newest held; `netcode-render.js` angle wrap.
- P-9 BUILT: `netcode-client.js` / `ghost-draw.js` treat every record as a sample.
- P-10 BUILT: `room-rules.mjs` `STALL_COLLAPSE_TICKS` 9.
- D-1 BUILT: `room.mjs` loop order (input, step per tick, stream).
- D-2 BUILT: `world.js` trims the buffer to 4, dropping the oldest.
- D-3 BUILT: `world.js` consumes one action per tick.
- D-4 BUILT: `world.js` idle-zero, serial dedupe, collapse at 9.
- D-5 BUILT: the page's input path (map loop to `world.setInput`).
- D-6 BUILT: `world.js` pops one per local tick.
- D-7 BUILT: follows from D-2..D-4 in `world.js`.
- D-8 BUILT: no input-clock steering; `ghost-draw.js` eases only the draw clock (documented).
- J-1 BUILT: `room-rules.mjs` rate 20, floor 10, 1400-byte budget; `room-registry.mjs` handshake.
- J-2 NOT-GAME: a correction to a design note.
- J-3 BUILT: `netcode.js` `MSG_LEAVE` (0xd) and `room.mjs` `leave`.
- J-4 NOT-GAME: bf42plus patch history.
- J-5 NOT-GAME: recorder and relay (projectile pools for late joiners).
- J-6 NOT-GAME: recorder (destroy events). The room's wrecks are `room-pads.mjs` rows.
- W-1 BUILT: `netcode.js` six 12-bit channels plus a button mask (17-byte record, extended).
- W-2 BUILT: `mouse-input.js` `floatToFixed` (±16, 12-bit).
- W-3 BUILT: `mouse-input.js` `fixedToFloat` (rounded to 0.01).
- W-4 BUILT: the communication channel is not on the wire (radio rides `MSG_ACTION`).
- W-5 NOT-GAME: a correction to a design note.
- R-1 BUILT: `room-rules.mjs` / `room-stream.mjs` choke, cap 0 = off, budget floor 260, 10 s period.
- R-2 NOT-GAME: the 4-bit count. Our wire sends one action per input frame; nothing visible.
- R-2b NOT-GAME: open, server-side only.
- Sweep, BUILT: friendly-fire ratios and kickBack (`friendly-fire.js`, FF-3/FF-4); `serverExternalViews` / `serverAllowNoseCam` (`server-settings.js`, adopted from the relay's GameRules); `serverCrossHairCenterPoint` (`vehicle-hud.js`, `map.css`); `serverHitIndication` (`hud.js`, XHIT); the restart delay of 10 s (`round-state.js` `RESTART_DELAY`); tickets scaled by max players / 16 (`round-state.js`, TKT-1); `serverBandwidthChokeLimit` 0 (`room-rules.mjs`).
- Sweep, NOT-GAME: `serverCoopAiSkill` / `serverCoopCpu` (stored only, AI-22), `serverDeathCameraType` (stored only), `serverPunkBuster`, `serverContentCheck`, `serverEventLogging` / `Compression`, `serverInternet` / `IP` / `Port`, `serverMaxAllowedConnectionType`, `serverUnpureMods`, `serverDedicated`.
