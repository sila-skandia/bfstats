# hud

## Summary

33 ledger rows plus a sweep of the client's message keys (lexicon `lexiconall.dat`, 1656 keys,
each grepped against `viewer/` and `server/`) and the Mac dump's `BfMenu::output*`,
`GameClient::handleGameEventManagerEvent`, `MenuMapNode::*`, `FreeCamera::*DeathCamera`.

Rows: BUILT 27, NOT-GAME 2, MISSING 2 (HFD-12, FONT-5), DIFFERENT 1 (FONT-3), UNREAD 1 (XHIT-9; HUD-4 counts as BUILT, but its nation key is open).
Sweep: MISSING 6, DIFFERENT 1, PARTIAL 1, UNREAD 1.

Top findings by impact:
1. DIFFERENT, high: the death camera follows the corpse for 1.2 s of house framing. Retail's `FreeCamera::updateDeathCamera` runs its own timed shot (corpse, then a rise from 3 to 5 s), moves on to the next player after 10 s, and shows "CHASE CAMERA <name>" plus "<key> TO TOGGLE BETWEEN PLAYERS".
2. MISSING, medium-high: the "<name> entered your vehicle" and "<name> left your vehicle" game-info lines (event 7 and event 8).
3. MISSING, medium: the "<name> joined the axis team / allied team" game-info line when a player's team is set.
4. MISSING, medium: an explosion on a hull also splashes each seated occupant as a soldier (HFD-12). Our splash covers soldiers on foot only.
5. UNREAD, medium: the minimap blinks a radio sender's mark yellow (`addPlayerToFlashList`, `game.setRadioFlashTime`). We do not do this, and its default count is unread.
6. MISSING, medium: pause with P in single player, with "PAUSED" on screen (`Setup::toggleGamePause`, `GAME_PAUSE`).
7. MISSING, low-medium: online votes (map vote, kick vote, team-kick vote) and their `VOTEMSG_*` lines. The scoreboard draws the buttons and the console has the aliases, but nothing runs a vote.
8. MISSING, low: the single-player tooltip boxes (`ToolTipManager`, `TOOLTIP_CLOSE_TO_*`). The shipped profile turns them off (`game.setToolTip 0`).

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [DIFFERENT] [impact: high] [effort: M] The death camera: retail's timed shot, then following teammates with a toggle
- Retail: `dice::ref2::world::FreeCamera::updateDeathCamera` (lnxded `0x081b0350`, 0xebe bytes; `setDeathCamera(bool, IObject*)` `0x081afce0`; `followNextPlayer(bool)` `0x081b0150`). Mac dump body: the timer is at `+0x15c`. With type 1 (`Setup+0x484` = `getServerDeathCameraType`, shipped as 1) the camera holds on the body until 3 s, then from 3 to 5 s rises 30 m on `(t-3)*0.5`, with a second branch built on `(t/3)*pi/2` and `t*0.5` terms. At `t > 10` with no one followed (`+0x170 == -1`) it calls `followNextPlayer`, and it calls it again whenever the followed player is gone or dead (`+0x89`). `BfMenu::updateHud` draws the player's name next to `DEATH_CAMERA_RIDING_WITH` ("CHASE CAMERA") and `getToggleCameraKey() + DEATH_CAMERA_TOGGLE` ("TO TOGGLE BETWEEN PLAYERS"). This is the view behind the spawn screen while dead. Retail opens the spawn screen at once (death-cam-deploy.md) and the player can close it to watch.
- Ours: `viewer/local-player.js` `DEATH_CAM`: foot 1.2 s, vehicle 3 s, seat 1.2 s. Its own comment marks the framing as `[HOUSE RULES]`, "never decoded past `FUN_004933d0`". Then `openDeploy()`. Nothing follows a teammate, there is no toggle key, and no "CHASE CAMERA" text is drawn (`DEATH_CAMERA_*` has 0 hits).
- A player notices: on every death. Dead players in retail watch the corpse rise and then ride along with teammates while they wait to respawn. Ours shows a short fixed shot and then the map.
- To build: decode `updateDeathCamera` and `followNextPlayer` from lnxded into the ledger (a new CAM or DIE row). Port them to `local-player.js` / `soldier-view.js`, add the follow-and-toggle on `c_PIToggleCameraMode`, add the two text lines to the respawn HUD (`soldier-hud.js` or deploy-screen's group), and let the spawn screen close to the death cam.

### [MISSING] [impact: medium] [effort: S] "entered your vehicle" / "left your vehicle" lines
- Retail: `GameClient::handleGameEventManagerEvent` case 7 (enter). When the player is not the local player and their vehicle id equals the local player's vehicle (`+0x48`), it calls `outputGameInfoMessage(name + ENTERED_YOUR_VEHICLE)` ("entered your vehicle"). Case 8 (exit) does the same with `LEFT_YOUR_VEHICLE` ("left your vehicle").
- Ours: none. Both keys have 0 hits, and `comms.js`'s SECTION_INFO writers are radio, capture, all-points and CTF only.
- A player notices: whenever a bot or player climbs into or out of their tank, jeep or bomber. That is constant in Instant Battle.
- To build: in `comms.js`, on the occupancy enter and leave events for the hull the local player sits in, add `chat.add(SECTION_INFO, { text: name + ' ' + strings.ENTERED_YOUR_VEHICLE, team: 0 })`. Add the builder to `chat-log.js`. Team 0, because the call passes 0.

### [MISSING] [impact: medium] [effort: S] "<name> joined the axis team / allied team"
- Retail: client event 0x36 (`handleGameEventManagerEvent`) and `GameServer::setTeam` (the listen server, so single player too). They build `name + JOINED_THE + AXIS_TEAM|ALLIED_TEAM` ("joined the" / "axis team" / "allied team") and send it to `outputGameInfoMessage` with the player's team, so the line carries that side's colour and flag.
- Ours: none. `JOINED_THE`, `AXIS_TEAM` and `ALLIED_TEAM` have 0 hits. `netcode-client.js:218` writes "joined the room", which is a page line, not retail's.
- A player notices: at round start and whenever someone picks a side or switches. Whether bots go through `setTeam` at round start in single player is not read (the guard is `this[0x2e8] == 0`).
- To build: a `joinLine(name, team, strings)` in `chat-log.js`. Call it from `comms.js` on a room's team-set row and on a bot's team assignment if `setTeam` covers bots. Check that guard first.

### [MISSING] [impact: medium] [effort: M] A blast on a hull also splashes its seated crew (HFD-12)
- Retail: lnxded `handleExplosion` `0x08156ef0`. After `handleExplosionOnObject(root)` it walks the seat map and calls `handleExplosionOnObject(occupant)` for each seated soldier whose flag bit 0 is clear and who has an Armor among his parents (`0x08157167`..`0x08157271`). The occupant takes soldier splash damage and their own wash.
- Ours: `server/room-hits.mjs` splashes "every soldier on foot", and the page's splash is the same. Seated crews take only the hull's wash (`vehicle-hits.js` `washSeatedCrew`), with no damage.
- A player notices: a grenade or shell landing on a jeep or an open gun seat kills or wounds the crew in retail. Ours leaves them untouched until the hull dies. Which seats have bit 0 clear is unread, so this may be limited to exposed seats.
- To build: settle which objects carry flag bit 0 (lnxded `[obj+4] & 1` writers). Then add the occupant pass to `applySplash` in `server/room-hits.mjs` and to the offline page path (`vehicle-damage.js` / `soldier-exposure.js`).

### [UNREAD] [impact: medium] [effort: S] Radio sender blinks on the minimap
- Retail: `menu::Radio::outputRadioMessage` and `outputLocalMessage` call `MenuMapNode::addPlayerToFlashList(senderId, BfMenu+0x5d4)` for any sender who is not the local player. `MenuMapNode::update` toggles `+0x128` on while `+0x100 <= +0xf4`. Past `+0xf8`, `decreaseFlashTimeFlash` takes 1 off each entry and resets the clock. `onPaint` (three sites: the soldier, the vehicle and the self mark) draws a flashing player's mark in yellow `(1,1,0,1)` while `+0x128` is set. `BfMenu+0x5d4` is `game.setRadioFlashTime` (`setRadioFlashTime`, a float count of blinks).
- Ours: none (no flash or blink in `map-friendlies.js` / `bfmap.js` / `radio.js`). The console table lists `Game.setRadioFlashTime` as "data" only.
- Unread: the default count. No `.con` in vanilla `Menu.rfa`/`Game.rfa` or `Settings/` sets it, and the Mac `BfMenu` constructor does not visibly write `+0x5d4`. If the count is 0, retail never blinks. To settle it, read the client's `BfMenu` constructor or `setRadioFlashTime`'s default (`console-commands.json` names ctor `0x0041c5f0`, static `0x00963790`) and `MenuMapNode`'s `+0xf4`/`+0xf8` initialisers.
- A player notices: if the default is nonzero, a teammate who calls "need backup" or "spotted" blinks yellow on the minimap.
- To build: a flash list in `map-friendlies.js`, fed from `comms.js`'s radio path.

### [MISSING] [impact: medium] [effort: S] Pause in single player ("PAUSED")
- Retail: `c_GITogglePause` (P, shipped `Controls.con`) leads to `Setup::toggleGamePause`. Outside a status-2 game, and only where the game allows it, this sets game status 4, mutes the "Default" volume group, and `BfMenu::outputPauseMessage` shows `GAME_PAUSE` ("PAUSED"). Pressing again restores the status and the volume.
- Ours: the key is listed in the controls screen (`controls-rows.js` `CONTROLS_COMMON_PAUSE`) but nothing handles it in play. `admin.toggleGamePause` exists only as a console command (`console-commands.js:413`).
- A player notices: pressing P in Instant Battle does nothing.
- To build: handle `c_GITogglePause` offline in `page-input.js` by freezing the sim clock (the same seam the console's toggleGamePause uses), muting the master group and drawing the PAUSED text from `menu/InGame`'s pause node.

### [MISSING] [impact: low-medium] [effort: L] Online votes (map, kick, team-kick)
- Retail: `VOTEMSG_*` (progress, success, non-conclusive, inactive), `VOTEFEEDBACK_*`, `MAPVOTE_*`, the scoreboard's VOTE KICK / MAP VOTE buttons, `c_PIVoteYes/No` (7/8), and `c_PIShowMapVote` (Insert).
- Ours: the scoreboard draws the buttons (`scoreboard*.js`), `console-aliases.js` maps `kick`/`mapvoting`, and keys 7/8 are kept free (`page-input.js:204`). No vote runs on the room server and no `VOTEMSG` line is printed.
- A player notices: online only, when they try to vote off a griefer or change map.
- To build: vote state in `server/room-rules.mjs`, the `VOTEMSG` lines into SECTION_INFO through `comms.js`, and the map-vote list screen.

### [MISSING] [impact: low] [effort: M] Single-player tooltip boxes
- Retail: `menu::ToolTipManager`. `MenuMapNode::onPaint` enables `TOOLTIP_CLOSE_TO_VEHICLE` (id 0x17, 10 s), `_FLAG` (0x18), `_CONTROLPOINT` (0x19, 15 s), `_REPAIR` (0x1b), `_HEAL` and `_RELOAD`, each once (latches `+0x1ac..+0x1af`). `BfMenu::updateHud` enables `TOOLTIP_ENTER_GAME`, `_INTERFACE`, `_RESPAWN`, `_COMMUNICATION` and the `_SOLDIER_<kit>` boxes. T toggles them (`c_PIToolTip`), and they are gated on `menuManager+0xc +0x1c` (`game.setToolTip`).
- Ours: none. Every `TOOLTIP_*` key has 0 hits; only the radio tooltip is built (`comms.js`).
- A player notices: only with tooltips turned on. The shipped `Profiles/Default/GeneralOptions.con` says `game.setToolTip 0`, so a stock player never sees them.
- To build: a tooltip plate in `hud.js` from `menu/InGame`'s tooltip group, with triggers in the pad, flag and supply proximity code.

### [DIFFERENT] [impact: low] [effort: S] HUD and menu text metrics do not follow the display width (FONT-3)
- Retail: FONT-3. The nine stock faces' glyph metrics are rescaled by `game.setGameDisplayMode` width: at 1920, `roundHalfUp(m*1.5)/1.44`, so Trebuchet MS8's A advances 9.03 instead of 8. This was checked against a 1920 capture: the native metrics drift 49 px across "SPAWN POINT SELECTED".
- Ours: `bitmap-text.js` and `play/menu-screen.js` use the native `.dif` metrics at every size. No `fontRatio` or display-width table exists.
- A player notices: spacing on HUD and menu text is slightly tighter than a 1920 retail screen. Most players will not notice.
- To build: a width-to-(A, B) table in `bitmap-text.js`, with the page's pixel width standing in for the display mode.

### [MISSING] [impact: low] [effort: S] Glyph pixel snap in the list and text field (FONT-5)
- Retail: FONT-5. The list `0x007d1390` and the text field `0x007deb10` place `.dif` glyphs at `roundHalfUp(x*s)/s`.
- Ours: none (the row says "read, not built").
- A player notices: barely. Scoreboard and chat glyph edges are a little softer at non-800 widths.
- To build: round the pen in `bitmap-text.js` for list and field callers.

### [PARTIAL] [impact: low] [effort: S] Connection-problem and flood warnings as HUD lines
- Retail: `GameClient::update` calls `outputDisconnectMessage(GAME_MESSAGE_CONNECTION_PROBLEM)` ("Warning! Connection problems detected!") and `GAME_MESSAGE_DISCONNECTED`. It also prints `CHAT_FLOOD_ERROR` ("Warning: Sending messages too fast, discarding") into the game info section.
- Ours: `map.html:408` has its own "Connection problem" dialog, and `net-room.js` handles a disconnect. Neither uses retail's red HUD line, and there is no flood line.
- To build: route `net-room.js`'s stall detection to a HUD text line; add a chat rate limit on the room.

### [UNREAD] [impact: low] Rows left open by the ledger
- XHIT-9 (does the HUD quad renderer alpha-test the hit marks): open in the ledger. Settle it by tracing `D3DRS_ALPHAREF` (0x18) writers to the meme 2D batch.
- HUD-4's nation key for `Icon_<nation>_soldier_<pose>.tga`: open. Ours maps the team's nation (`soldier-hud.js:141` `STANCE_NATION`, which it calls an approximation).

## From the sweep: retail behaviour with no ledger row

- `FreeCamera::updateDeathCamera` / `followNextPlayer` / `setDeathCamera` and `Setup::getServerDeathCameraType` (`+0x484`): no ledger row (`xref.py sym` finds nothing). See the first finding.
- `ENTERED_YOUR_VEHICLE`, `LEFT_YOUR_VEHICLE`, `JOINED_THE`: no row.
- `MenuMapNode` flash list and `game.setRadioFlashTime`: no row.
- `Setup::toggleGamePause` and `GAME_PAUSE`: no row.
- `ToolTipManager` and the `TOOLTIP_*` triggers: no row.
- Present and built (checked on the sweep): kill lines, team kill and "is no more" (`chat-log.js` `killLine`/`teamKillLine`/`deathLine`); the centre local kill message (`chat-log.js`); control point capture lines (`captureLine`, `allPointsLine`); CTF stole, dropped, returned and captured (`ctf.js`); the combat-area "Deserters will be shot" warning (`combat-area.js`, `announcer.js`); "ADDITIONAL PLAYERS NEEDED" and "GAME IS RESTARTING" (`status-message.js`); TIME TO SPAWN and TIME UNTIL GAME STARTS (`spawn-timer.js`); "You called for artillery!" (`comms.js`, `map-spotter.js`); the scoreboard's columns, totals, medals and `<id>` (`scoreboard.js`); the static minimap and minimap transparency (`bfmap.js`, `map-surfaces.js`); crosshair colour (`soldier-hud.js`); radio tooltip (`comms.js`); nametag distances (`nametags.js`, `nametag-layer.js`); the crew list with its 3 s timeout and keys 1-6 (`vehicle-players.js`).

## BUILT and NOT-GAME, one line each

- VHUD-1: BUILT. `viewer/vehicle-players.js` (the `VehiclePlayersText` slots, `ShowVehiclePlayers`) and `vehicle-hud.js` (the vehicle icon and HP).
- VHUD-3: BUILT. `vehicle-hud.js:153-158`, the AmmoBar enum with the bare `ABAmmoBar` falling to the default.
- VHUD-4: BUILT. `vehicle-hud.js` ammo panel and the layout's per-copy exclusion (the decoded `menu/InGame` cull nodes in `hud.js`).
- VHUD-5: BUILT. `vehicle-hud.js` crosshair style (only CHTCrossHair/CHTIcon draw, typos draw nothing); periscope gate in `soldier-hud.js:377` / `submarine-hud.js`.
- VHUD-6: BUILT. `hud.js` CullNode evaluation (a named bool shows while true).
- VHUD-12: BUILT. `soldier-hud.js` keeps the soldier group in a seat (`471ced32`).
- VHUD-15: BUILT. `vehicle-hud.js` / `vehicle-occupancy.js` `NumberOfWeaponIcons` 0 means no panel.
- VHUD-17: BUILT. `vehicle-players.js` `observe` (enter and leave), `press` (keys 1-6), `leave`.
- VHUD-19: BUILT. `seat-dots.js`, `vehicle-hud.js` `OccupiedData`.
- HUD-2: BUILT. `soldier-hud.js` Soldier group variables.
- HUD-4: BUILT for stance. `soldier-hud.js` pose icon (the nation key is UNREAD above).
- HUD-5: BUILT. `hud.js` fill nodes.
- HUD-6: BUILT. `hud.js` Size/Maximum fill fraction.
- HUD-7: BUILT. `hud.js:790` `fillOrder`.
- HUD-8: BUILT. `hud.js` TransformNode rect accumulation.
- HUD-26: BUILT. `nametags.js` `setOwnNameTagDistances`, `nametag-layer.js` `setServerDistances` (the row says so).
- XHIT-2: BUILT. `soldier-hud.js` / `hud.js` `HitIndicationTime`.
- XHIT-8: BUILT. `hud.js` hit marks turned about their own centre (crosshair-hit-marks).
- XHIT-13: BUILT. `camera-dof.js`, `gun-groups.js` `fireInCameraDof`.
- XHIT-17: BUILT. `net-relay.js` server-confirmed marks.
- XHIT-19: BUILT. `camera-dof.js` / `bot-rounds.js` launch pose.
- HFD-7: BUILT. `soldier-hud.js` / hit-direction-wash, a constant-alpha on/off wash.
- HFD-14: NOT-GAME. Server-side octant work for bots with no client; nothing for the page to draw.
- FONT-1: BUILT. `bf42/font.py`, `viewer/fonts/bf1942.json`.
- FONT-2: BUILT. `bf42/font.py` `.dif` reader, `bitmap-text.js`. The kerning section is read but not applied, which matches FONT-4.
- FONT-4: BUILT. `bitmap-text.js` pen (left, then width plus right, no kerning).
- LDPIC-2: NOT-GAME (extractor). `extract_loading_assets.py` and `maps.json` `loading.background` carry the placeholder names.
- LOAD-29: BUILT. The page drops an unloadable water layer pair (`extract_map` water layers).
- LOAD-31: BUILT. `console-commands.js` `lensFlare.enable`, `lens-flare.js`.
