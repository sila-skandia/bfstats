# console-menus

## Summary

Rows (35): BUILT 30, NOT-GAME 4 (MEME-1, MEME-2, MEME-3, CHAT-5 as a relay-only row; see below),
PARTIAL 1 (MEME-27). The console itself (CON-2..CON-24) and the controls editor (CTL-1..CTL-8)
match retail closely. Their rows carry no id in the code only because the code cites the
addresses and function names instead.

The sweep found what is missing. It is all the part of the console and menus that a host and
other players use, and almost all of it is in the browser game's own multiplayer room
(`server/`). The relay to a real BF1942 server gets most of it from that server.

Sweep findings: MISSING 4, DIFFERENT 1, PARTIAL 4.

Top findings by impact:
1. MISSING, high: **typed chat does not reach anyone in a room.** K/L opens the box and the
   line shows in your own log, but the room server has no chat action. Only the relay to a
   real server carries chat.
2. DIFFERENT, medium: **Instant Battle leaves out the death-ticket penalty and the bot ratio.**
   Retail's NORMAL default is 5 tickets per player death and a 3:4 friendly:enemy split. Ours
   is the level's per-death loss and a 1:1 split. The campaign already has both laws
   (`play/campaign.js`), but skirmish never passes them.
3. MISSING, medium: **no voting system.** There is no map vote, kick vote or team-kick vote.
   The 7/8 vote keys and the `votemap`/`kick`/`kt` aliases do nothing.
4. MISSING, medium: **no team-kill punish/forgive** (`TKPunishMode`, `punish`/`forgive`, the TK
   spawn penalty, kick after N TKs).
5. MISSING, medium: **a room has no host settings and no admin.** CREATE GAME takes only the
   name and shows max players. There is no time limit, tickets, rounds, FF, spawn time,
   password or autobalance, and no kick, ban, changeMap or serverMessage.
6. PARTIAL, low/medium: **there is no GENERAL OPTIONS screen.** Crosshair colour, minimap
   transparency and static minimap, tooltips, radio tooltip and its colour, and player name
   can be set only by importing a profile or from the console.
7. PARTIAL, low/medium: **a room restarts the same map.** There is no map cycle
   (`nextLevelInMaplist`, ROUND-9).
8. PARTIAL, low: **some client console words a player types are not registered.** `suicide`,
   `name`, `ignore`/`ignorelist`, `game.sayAll` answer *Unknown object or method!*; retail
   runs them.
9. PARTIAL, low: in a room the scoreboard's ping column is empty (MEME-27 works through the
   relay only).

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [MISSING] [impact: high] [effort: S] Typed chat in the browser game's own multiplayer room
- Retail: a player's line goes to the server (`StringManager::say`, CHAT-2: four lines queued,
  one piece every 0.5 s, cut to 63 bytes). The server relays it to everyone but the sender, or
  only to the sender's side for team chat (`handleChatMessage`, CHAT-4). Server lines name
  nobody (CHAT-5).
- Ours: `viewer/chat-input.js` and `viewer/comms.js` `sayLine` open and paint the K/L line.
  `viewer/net-room.js` `room.sendChat` sends only when the client has a `chat` method, and only
  the relay client (`net-relay.js`) has one. Its own comment says *"a room has no chat"*. Then
  `comms.js:633` falls through and writes the line into your own chat log only.
  `server/room-control.mjs` `onAction` handles spawn, seat, radio, reload, stab and impact, and
  has no `chat`. `git grep -i chat -- server` finds nothing.
- A player notices: in any room game on play.bfstats.io, every line you type looks sent in
  your own log, and nobody else ever sees it. Team chat is the same.
- To build: add a `chat` action to `server/room-control.mjs` (team-only goes to the sender's
  side, nobody gets their own line back, a 63-byte cut, and the CHAT-2 send pacing as a rate
  limit). Add a `chat` event row to `server/room-wire.mjs`. Add a `chat` method on the room
  client (`netcode-client.js`). `net-room.js` already draws the incoming `row.type === 'chat'`
  (line 1330).

### [DIFFERENT] [impact: medium] [effort: S] Instant Battle: no death-ticket penalty, no enemy-vs-friendly ratio
- Retail: `SkirmishMenu::continueStartSkirmish` (Mac `0x004ca5dc`) calls
  `SingleplayerMenu::convertSinglePlayerSettings(0, ...)` and then
  `Setup::startSinglePlayerGame(skill, team, 1, ratioA, ratioB, lives)`. The skirmish arm
  reads `SkirmishSettings+0x68` (BotRatio) and `+0x70` (NrOfLives). AI-20 says these become
  the ratio 1:1 / 3:4 / 1:2 / 1:3 and the per-death tickets 1 / 5 / 10 / 20. The shipped
  default is step 2 (NORMAL): 3:4 and 5 tickets (bf1942-ai-research-2026-09-21 section 5.1).
  Only AI SKILL is inert (AI-21).
- Ours: `play/skirmish.js` `launchUrl` passes only `botCount` and `botSkill`. `map.html`
  then splits the bots 1:1, with the odd bot on the player's side, and charges the level's
  plain `lossPerDeath` (`round-state.js:603`). The campaign already does this correctly: it
  passes `?enemyBots=` and `?deathPenalty=` (`play/campaign.js` `enemyBots`, `DEATH_PENALTY`).
  The column redesign in `play/bot-settings.js` is the owner's deliberate choice. These two
  rules were lost with it rather than redesigned.
- A player notices: in Instant Battle their own death costs their side one ticket instead
  of five, and the enemy is never outnumbering them. Instant Battle is easier than retail's
  NORMAL.
- To build: in `play/skirmish.js` `launchUrl`, add `enemyBots(botCount, 2)` and
  `deathPenalty=5` (the NORMAL defaults), or add two notched controls to
  `play/bot-settings.js`. `map.html` already reads both parameters. Owner's call whether to
  expose them.

### [MISSING] [impact: medium] [effort: M] The voting system (map vote, kick vote, team-kick vote)
- Retail (lnxded): `GameServer::updateVoteSystem` `0x08149d60` steps four `Vote` objects every
  server frame (D-1), at `+0x320`, `+0x360`, `+0x3e0` and `+0x420`: map, kick, and team kick
  per side. `calcVotesNeeded` `0x08148880` computes ceil(players × majority). It counts all
  players for map and kick (vt `+0x78`) and the target's team for team kick (vt `+0x7c`, team
  at `vote+0x38`). The rounding mode `0x800` is round up. Entry points are `voteMap(int)`
  `0x0814a000`, `voteKickPlayer` `0x0814a050`, `voteKickTeamPlayer` `0x0814a0f0`,
  `Vote::layVote` `0x0815dc30`, `getResult` `0x0815df80` and `VoteEvent` (de)serialize
  `0x0811e810`/`0x0811e8b0`. The server switches are `admin.enableMapVote`,
  `enableKickPlayerVote`, `enableKickTeamPlayerVote`, `vote*Majority` and `votingTime`. Its
  messages, verbatim from `.rodata`, are `Vote Failed: %s is disabled on server.`,
  `... already in progress.`, `Vote Failed: Map id outside Map Cycle`,
  `Vote Failed: Minimum %d seconds between issuing votes.`, `Player %s was kicked from the
  server.` and the names `Map Vote` / `Kick Vote` / `Kick Vote (Team)`. On the client,
  `c_PIShowMapVote`, `c_PIVoteYes` and `c_PIVoteNo` (default 7/8) and the aliases
  `votemap`/`vm`/`kick`/`kickteam`/`kt` (CON-25's alias file). `game.listMaps` prints
  ` NumVotes:%d` (CON-24).
- Ours: no ledger row. The keys are bound and shown on the CONTROLS screen
  (`controls-rows.js:49-51`), and `page-input.js:204` notes that 7 and 8 are the vote keys,
  but nothing acts on them. The aliases point at unregistered words, so they answer *Unknown
  object or method!*. The room server has no votes.
- A player notices: in a room game there is no way to kick a griefer or vote for another map.
  The 7/8 keys do nothing.
- To build: add a vote module on the room (`server/`) using the ceil(n × majority) law and
  `votingTime`, and a `VoteEvent`-shaped event row. Map vote and kick need the console words
  (`console-commands.js`), the map-vote list (`ShowMapVote`, `menu/InGame` has the plate) and
  the 7/8 handlers. First read `updateVoteSystemVote` `0x08149dc0` for the timing and the
  defaults, then write the ledger row.

### [MISSING] [impact: medium] [effort: M] Team-kill punish / forgive
- Retail: `GameServer::TKPunish(int)` `0x081593d0` runs only when TK punish mode is on
  (`cmpb $0, +0x4e1`). It reads the victim's last TK attacker (`BFPlayer+0x188`), moves the
  `+0x18c`/`+0x190` counters, applies `spawnDelayPenaltyForTK` (`flds +0x4d8`) and can kick
  (vt `+0x334`). The settings are `Admin.TKPunishMode`, `nrOfTKToKick` and
  `banPlayerOnTKKick`; `serverTKPunishMode` sits in serversettings. The client sends
  `game.TKPunish` / `game.TKForgive` (aliases `punish`/`ptk`/`forgive`/`ftk`).
- Ours: nothing. Friendly fire exists (bot-friendly-fire), but nobody counts TKs or acts on
  them. The aliases answer *Unknown object or method!*.
- A player notices: online, a teamkiller gets no penalty and the victim gets no
  punish/forgive prompt.
- To build: a per-player TK ledger in `server/authority.mjs` beside the kill book, the two
  console words, a spawn-delay add in the wave timer and a kick at N. First read the TK
  message the victim sees and the `+0x4d8` default.

### [MISSING] [impact: medium] [effort: M] Room host settings and admin
- Retail: CREATE GAME (`menu/CreateGameMenuPage1/2`) sets the `game.server*` words. NET-21
  gives their defaults (spawnTime 20, rounds 5, FF 100/100, ticketRatio 100, nametag 50/300,
  and so on), and SESS-1 sends some to the clients (external views, nose cam, crosshair dot).
  An admin has `admin.kickPlayer`, `kickPlayerByName`, `banPlayer`, `changeMap`,
  `restartMap`, `runNextLevel`, `setNextLevel`, `serverMessage`, `timeLimit` and
  `scoreLimit` (189 "server" words in `features/bf1942-in-the-browser/console-commands.md`).
  `setServerWelcomeMessage` reaches joiners as `WelcomeMsgEvent` (`0x0811f8c0`).
- Ours: `play/create-game.js` `ROOM_SETTINGS` shows two rows, the name (the room code) and
  max players read-only. Its comment says the other fourteen are not taken by the room
  server. Rooms have no host role and no kick or ban. `net-relay.js` only reports a kick that
  came from a real server.
- A player notices: whoever creates a room cannot set the time limit, tickets, friendly fire,
  spawn time, a password or the next map, and cannot remove anyone.
- To build: pass the settings in the room-create row (`server/rooms.mjs`), apply them through
  `round-state.js` and the authority, and give the first client (the creator) an admin flag
  with `admin.*` console words routed to the room.

### [PARTIAL] [impact: low/medium] [effort: M] No GENERAL OPTIONS screen
- Retail: OPTIONS > GENERAL (`dice::bf::menu::GeneralOptions`, Mac
  `registerMenuData`) holds `Options/General/PlayerName`, `CrossHair` (Red/Green/Blue),
  `MinimapTransparency`, `StaticMinimap`, `ToolTip`, `RadioToolTip`, `Radio/Color`
  (Red/Green/Blue), `LineSpeed`, and Skirmish/Campaign `PercentageOfBots`/`Cpu`. It has
  `Load`/`Save`/`DefaultGeneralOptions` and is saved as `GeneralOptions.con`.
- Ours: `play/controls-screen.js` `SECTIONS = ['controls', 'video', 'sound']`. The values
  exist and work (`bfmap.js` transparency and static minimap, `comms.js` radio tooltip,
  `game.setCrossHairColor` in `console-commands.js`), but they come only from an imported
  profile's `GeneralOptions.con` (`controls.js` `parseCrossHairColor`) or the console.
- A player notices: there is no menu to change the crosshair colour, rotate the minimap or set
  its transparency.
- To build: a fourth section in `controls-screen.js` painted from an extracted
  `menu/GeneralOptionsMenu` layout (the same pattern as `extract_controls_menu_layout.py`),
  wired to the existing setters.

### [PARTIAL] [impact: low/medium] [effort: S] A room restarts the same map; no map cycle
- Retail: `gameStatusFirstEndGame` `0x08152a60` calls `nextLevelInMaplist` (ROUND-9), and
  `game.serverNumberOfRounds` (default 5, NET-21) sets how many rounds the map runs.
  `Vote Failed: Map id outside Map Cycle` shows the cycle also bounds map votes.
- Ours: `server/authority.mjs` `restartRound` remakes the same level forever.
- A player notices: a room plays one map over and over.
- To build: a level list on the room (from create-game), and a next-level step in the
  authority after the restart countdown when the rounds are used up. The round-end bucket may
  own this.

### [PARTIAL] [impact: low] [effort: S] Client console words a player types that are not registered
- Retail registers these with access 1, so they work when typed (CON-20/21): `Game.suicide`
  (alias `suicide`), `Game.sayAll`, `Game.changePlayerName` (alias `name`),
  `Chat.addToIgnoreList` / `removeFromIgnoreList` / `ignoreList` (aliases `ignore`, `unignore`,
  `ignorelist`), `Chat.ignoreRadioText` / `ignoreRadioAudio`, `Game.TKForgive` / `TKPunish`,
  `Game.voteMap` / `voteKick*`, and the buddy list.
- Ours: `console-commands.js` does not register them; the census marks them "fits" or
  "server". `console-aliases.js` keeps the aliases, so they answer *Unknown object or
  method!*. Suicide is on the deploy screen (`deploy-screen.js` RESPAWN_SUICIDE), but the
  typed word does not work.
- A player notices: a veteran's `suicide` or `ignore <name>` at the console prints an error.
- To build: register `Game.suicide` against the deploy screen's suicide path,
  `Game.sayAll`/`sayTeam`-style words against `comms.sayLine`, and an ignore set in
  `chat-log.js`. All are small.

### [PARTIAL] [impact: low] [effort: S] Scoreboard ping column empty in a room (MEME-27)
- Retail: column six is the server's `BFPlayer+0x94`, ghosted in the stat block (MEME-27).
- Ours: `scoreboard.js:273` reads `server?.ping`, which only the relay supplies
  (`net-relay.js` statsOf). The room has `MSG_PING`/`MSG_PONG` (`server/room.mjs:228`), but
  does not publish each player's round trip.
- A player notices: the ping totals and the column read 0 or blank in room games.
- To build: the room records each connection's pong round trip and sends it in the roster or
  event rows.

### [UNREAD] Instant Battle tickets
- Campaign missions pass `?tickets=`/`?lossPerMin=` from `SinglePlayer<Side>.con`
  (`play/campaign.js:322`), and Instant Battle passes neither. Both start through
  `Setup::startSinglePlayerGame` in retail, so Instant Battle probably runs the same
  single-player ticket layer. Settle it by checking whether `map.html`'s `mode=CoOp` path
  already loads the SinglePlayer tickets, or by reading `Setup::startSinglePlayerGame` (Mac
  `0x008c...`, `dice_bf_Setup_startSinglePlayerGame.c`) for where the ticket counts come from.

## From the sweep: retail behaviour with no ledger row

- The vote system: four `Vote` objects, `calcVotesNeeded` = ceil(players × majority), the
  failure strings, `VoteEvent`. No row exists. A `VOTE` prefix is worth opening (see above).
- TK punish/forgive: `TKPunish` `0x081593d0`, `+0x4e1` mode, `+0x4d8` spawn penalty. No row.
- `WelcomeMsgEvent` (`0x0811f8c0`): the server's welcome message to a joiner. No row, and not
  built in rooms.
- GENERAL OPTIONS menu data (Mac `GeneralOptions::registerMenuData`): no row. The values are
  built, the screen is not.
- Instant Battle's `convertSinglePlayerSettings` mapping is AI-20 (it has a row), but the
  skirmish launch path is not built (see the DIFFERENT finding).

## BUILT and NOT-GAME, one line each

- CON-2 BUILT: Grave/Caps Lock open the console, no deploy key -> `page-console.js` (toggle),
  `controls.js:582` drops Caps Lock from game input.
- CON-3 BUILT: no animation -> `console-view.js` (no tween).
- CON-4 BUILT: band `(h+1)·n+4` -> `console-view.js` `bandHeight`.
- CON-5 BUILT: white at 0.8 -> `console-view.js` `WASH`.
- CON-6 BUILT: BF1942.font, black text, x 2 / y `(h+1)i+2` -> `console-view.js` `TEXT_COLOR`,
  font table.
- CON-7 BUILT: error pair -> `console.js:584-585`.
- CON-8 BUILT: constant N at the prompt -> `console.js` `lineNumber` (line 296).
- CON-9 BUILT: Up/Down/PgUp/PgDn only, any other key resets -> `console.js` key handler.
- CON-10 BUILT: sixty-`+` marker as an extra row -> `console.js` `SCROLL_MARKER`, `getLines`.
- CON-12 BUILT: `game.useHud` -> `console-commands.js` `Game.useHud`; the alias `hud` is in
  `console-aliases.js`.
- CON-13 BUILT: `"> "`, 77, page 8, 1024, 10 -> `console.js` `PROMPT`, `MAX_SCROLLBACK`,
  `PAGE_LINES`.
- CON-19 BUILT: a glued method word is dropped -> `bf42/level.py` `parse_static_objects`.
- CON-23 BUILT: showFPS/showStats/useHud/engineSpeed -> `console-commands.js` `boolProp`/
  `floatProp`.
- CON-24 BUILT: listPlayers/listMaps/chatInfo/setChatHistory -> `console-commands.js`
  `playerLines`, `Game.listMaps`, `Chat.*`.
- MEME-1 NOT-GAME: MemeFile header -> `bf42/meme.py` (extractor).
- MEME-2 NOT-GAME: object frame -> `bf42/meme.py`.
- MEME-3 NOT-GAME: node sibling nesting -> `bf42/meme.py`.
- MEME-5 BUILT: 800×600 virtual screen stretched x/y -> `play/stage.js`, `menu-screen.js`,
  HUD layout.
- MEME-6 BUILT: empty-picture PictureNode as a solid quad -> `extract_menu_layout.py`,
  `menu-screen.js` `paintElement`.
- MEME-9 BUILT: lexiconAll.dat strings -> `bf42/modmenu.py`, `extract_*_layout.py`.
- MEME-16 BUILT: AddData/SubData folded -> `extract_menu_layout.py`
  `MenuFlattener.coord`.
- MEME-18 BUILT: BfSelectButtonNode on one shared variable -> `deploy-screen.js`
  (`Kit/SelectedKit`).
- MEME-19 BUILT: vanilla lexicon, then the mod's -> `bf42/modmenu.py:180`.
- MEME-20 BUILT: server row cells and columns -> `play/multiplay-layout.js` `COLUMN_X`,
  `multiplay.js`.
- MEME-22 BUILT: server row colour -> `play/multiplay-layout.js` `ROW_COLOR` (favourites and
  grey).
- MEME-23 BUILT: mod badge -> `play/multiplay-layout.js` `modIcon`.
- MEME-27 PARTIAL: ping column through the relay only; see above.
- CTL-1 BUILT: trailing ` 1` alternate slot -> `controls.js` `parseCon`, `controls-edit.js`
  `triggerLine`.
- CTL-2 BUILT: mixed axis verbs -> `controls.js:233-254`, `controls-edit.js` `axisLine`.
- CTL-4 BUILT: setKey consistency (alternate to primary, partner clear, dedupe) ->
  `controls-edit.js` `createDraft().set`.
- CTL-5 BUILT: per-map conflicts and the COMMON naming -> `controls-edit.js`
  `findConflicts`, `conflictText`.
- CTL-6 BUILT: SAVE refuses on a conflict and rewrites all four files ->
  `play/controls-screen.js:116-117`, `controls-edit.js` `serializeFiles`.
- CTL-7 BUILT: DEFAULT reloads without writing -> `controls-edit.js` `reset`.
- CTL-8 BUILT: wheel pair only -> `controls-edit.js` `serializeCon` (line 387).
- CHAT-5 BUILT (relay) / not applicable to rooms: a server line names nobody ->
  `net-room.js:1333` (`row.slot == null`); rooms send no server lines at all (see the chat
  finding).
- Also built, from the sweep: the in-game Esc menu (`play/skirmish.js` as the Esc mount),
  `Admin.toggleGamePause`, team change on the deploy screen (`spawning.js` `chooseTeam`),
  campaign difficulty (`play/campaign.js`), CUSTOM GAME mod picker
  (`play/mod-picker-screen.js`), server-list filters (`play/multiplay.js`), OPTIONS
  CONTROLS/VIDEO/SOUND, scoreboard, typed chat box and chat log (`chat-input.js`,
  `chat-log.js`), radio relay in rooms (`room-control.mjs` `onRadio`).
