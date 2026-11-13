# seams-players

The cells between players, bots and the mode. Each was checked against the ledger and against
lnxded (`~/bf1942-lab/linux-src/bf1942_lnxded.static`, read with objdump this session; the full
disassembly is cached at `inverse/lnx.dis`). Our side was read in `tools/bf1942-models/viewer`,
`server` and `sim`. Nothing in the repo was edited.

## Summary

Counts: MISSING 4, PARTIAL 1, DIFFERENT 2, UNREAD 2, BUILT 17, NOT-GAME 3.

Top findings by impact:

1. **DIFFERENT, high.** A bot medic heals at a rate taken from the wrong function. It heals one
   friend in a 20 deg cone at 0.3 HP a round. Retail's `useMedPack` heals every soldier within
   10 m at 0.25 HP a round, enemies included, and heals the medic at 0.15.
2. **MISSING, high.** Bot engineers never repair a vehicle, a human's or a bot's. Retail's
   MedicAssist picks repair targets by the RepairPack's own AI strengths (armour 2, infantry 0).
   Our friend list holds soldiers only, and a bot's RepairPack fire heals soldiers.
3. **MISSING, medium-high.** Bots hear 19 of the 22 radio messages and act on none of them.
   Retail reads Fire, Cover me and Hold fire in Fire; Medic and Need repairs in MedicAssist; Go,
   Hold position and Wait in MoveTo; Check your six and the seven "spotted" calls in Scout; Take
   cover in TakeCover. We read only Bail out, Get in and Abandon ship, the three wired today.
4. **MISSING, medium (online).** A room's server has no heal path. Medic packs, wrenches and
   supply depots heal only the page's own copy, and the next server row puts the old value back.
5. **DIFFERENT, medium.** Bots hold fire when a teammate is in their line. This is our own
   invention. Retail bots fire straight through a teammate (FF-7).
6. **UNREAD / DIFFERENT, medium-low.** How bots are split between the sides. Retail's
   `getTeamToAddPlayer` counts every player already on a side, humans included, and breaks a tie
   at random. We alternate, starting with the human's side, so an odd bot count puts the spare bot
   on the human's side.
7. **MISSING, medium (online).** A room has no bots. A retail co-op server fills itself with bots.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [DIFFERENT] [impact: high] [effort: S] A bot medic heals one friend at the wrench's rate, not the medic bag's sweep
- Retail: a bot fires its MedPack through the same `BFSoldier::handleMessage` Fire branch a human
  does. The branch compares the held item with the template named `MedPack` and runs
  `useMedPack` 0x082768d0 (SUP-27). `useMedPack` heals every soldier within `healDistance` by
  `healFactor` per round, with no team test. It then heals the holder by `selfHealFactor`
  (SUP-15). Vanilla `CommonSoldierData.inc` sets 10.0 m, 0.25 and 0.15. At 10 rounds a second
  that is 2.5 HP/s to everyone in reach and 1.5 HP/s to the medic. AI-42's "Where" cell names
  `useRepairPack` and `+0x2e0` 0.1 as the bot's heal, but SUP-27 later showed the MedPack never
  reaches that function. The row was not corrected.
- Ours: `viewer/bot-referee.js` `fireRound`. A healing round calls `referee.resolveHeal`, which
  finds the closest same-side player within `maxRange` (2.5) and inside a 20 deg cone, and gives
  that one player `BOT_HEAL_PER_ROUND` = 0.3 (3 HP/s). It never heals the medic itself, the other
  wounded around it, or an enemy. A human's pack in `hand-fire.js` `useMedPack` does follow retail,
  so a bot medic and a human medic heal differently.
- A player notices: a bot medic beside a wounded squad heals one soldier at a time, 20 % faster
  than a human medic would heal that soldier, and never heals the others standing with it.
- To build: make the bot's healing round call the human's sweep (the `useMedPack` body in
  `hand-fire.js`, moved to a pure helper over `world.players`), using the holder's
  `healDistance`, `healFactor` and `selfHealFactor` (`kit-loadout.js` `MEDIC_PACK`). Drop
  `BOT_HEAL_PER_ROUND` and `MEDIC.healPerRound`. Correct AI-42's "Where" cell.

### [MISSING] [impact: high] [effort: M] Bot engineers never repair vehicles, a human's tank included
- Retail: MedicAssist (AI-42, `BBMedicAssist::calculateUrgency` 0x08573840) takes the best
  healing weapon for each target type from that weapon's `strength` table. It scores every
  friendly unit the environment lists (`IAIEnvironment`+0xc). Vanilla's `RepairPackAI` rates
  Infantry 0 and LightArmour, HeavyArmour, NavalArmour, Submarine and Air 2.0
  (`_shared/loadouts.json` `aiWeapons.RepairPack`). So the RepairPack is the engineer's weapon
  for every hull and for no soldier. The plan walks to `R + 0.9 x 2.5` m, looks at the hull and
  holds the trigger. That runs `useRepairPack` 0x08276100: the nearest wounded hull within
  `getRadius() + repairDistance` gets `repairFactor` per round (SUP-15, SUP-27). MedicAssist
  also reads the "Need repairs" radio message, 0x36 (sweep, below).
- Ours: `viewer/bot-decision.js` `urgencySpecial` builds friends from `world.players` only, as
  `type: 'Infantry'`, and skips anyone seated. So the RepairPack (Infantry 0) never has a target.
  If it did, `bot-referee.js` `resolveHeal` would heal a soldier, not a hull. The only repair code
  is the human's `hand-fire.js` `useRepairPack`.
- A player notices: in single player, with a damaged tank next to an engineer bot of their own
  side, the bot never comes to fix it. Bot tanks are never repaired in the field either, only at
  depots.
- To build: in `urgencySpecial`, add friendly hulls (from `bot-units.js`, the hull's `strType`
  as the type, the hull's radius) beside the soldiers. Allow a hull with a crew; MedicAssist's
  "not inside an object" test drops the crew, not their hull. Then route a bot's RepairPack round
  through a pure `useRepairPack` (nearest wounded hull within its radius plus 2 m, `repairFactor`),
  shared with `hand-fire.js`. Touches `bot-decision.js`, `bot-referee.js`, `bot-plans.js`
  (`planMedic`'s 95 % test reads the target's Armor; a hull's Armor is `vehicleDamage`) and
  `hand-fire.js`.

### [MISSING] [impact: medium] [effort: M] Bots ignore every radio message but the three seat ones
- Retail: every caller of `AIRadio::getMessageStrength` 0x084825c0 in lnxded, found by a sweep of
  the call sites (ids from `bot-radio.js`'s table; 0x86ba8d4 = 1.0 per the brief):
  - `BBFire::calculateUrgency` (0x085652b6..0x08565329), and the same three reads in `BBFire3d`,
    `BBFireLargeBore`, `BBFireUnarmed` and `BBFireGuided`:
    `(1 + s[Fire 0x25]) x (1 + s[CoverMe 0x2b]) x (1 - s[HoldFire 0x26])`.
  - `BBMedicAssist` (0x08573d56, 0x08573d80): `1 + s[Medic 0x28]` and `1 + s[NeedRepairs 0x36]`.
    These are the "x (1 + radio)" of AI-42. Which term goes with which target type was not traced.
  - `BBMoveTo` / `BBMoveToFixed` (0x08575036..0x08575096):
    `(1 + s[Go 0x31]) x (1 - s[HoldPosition 0x2c]) x (1 - s[Wait 0x24])`.
  - `BBScout` (0x0857a81b..0x0857a98a): `(1 + s[CheckYourSix 0x34])` times
    `(1 + s[id])` for each of the seven spotted messages 0x0f..0x15.
  - `BBTakeCover` (0x0857d060) and `BBTakeCoverInfantry` (0x0858103a): `1 + s[TakeCover 0x29]`.
    `BBTakeCover3d` (0x0857e651): `1 + s[CheckYourSix 0x34]`.
  - `BBChangeLandingCraft` (0x085604c1): `1 - s[AbandonShip 0x35]`.
  Vanilla `radio.con` subscribes all of these (`bot-radio.js` `VANILLA_SUBSCRIBED`), so a shout
  within 70 m lifts a bot's strength up to 0.8, and more inside 56 m. It fades at 0.1/s (AI-169,
  AI-170). Where each factor multiplies into its urgency was read only as far as the store.
- Ours: `bot-referee.js` `radioMessage` already feeds every message into `createAIRadio`, but
  only `bot-mount.js` reads the store (`changeRadioStrength`, `teleportRadioStrength`). `Fire`,
  `Special`, `MoveTo`, `Scout` and `TakeCover` in `bot-decision.js` / `bot-behaviours.js` never
  call `referee.radio.strength`.
- A player notices: "Hold fire!", "Hold position", "Medic!", "Cover me!", "Go go go!" and "Take
  cover!" do nothing in single player. In retail, nearby bots on the same side visibly fire more
  or less, hold or move, and medics come running. Retail bots never answer on the radio (BBRadio
  is never constructed, below; RADIO-8), so the only response is in their behaviour.
- To build: one helper in `bot-radio.js` per behaviour (`fireRadio`, `medicRadio`, `moveRadio`,
  `scoutRadio`, `coverRadio`) that returns the products above. Multiply each into its urgency in
  `bot-decision.js`, at the point retail does; read that point from the five functions first,
  since this pass read only the factors. Tests go in `tests/test_bot_ai.py` next to the Change
  cases.

### [MISSING] [impact: medium] [effort: M] Online, heals and repairs never reach the server
- Retail: `useMedPack`, `useRepairPack` and every SupplyDepot run on the server and change the
  server's own Armor (SUP-15, SUP-21; the server's event log writes `beginMedPack` and
  `beginRepair` once per heal applied).
- Ours: `server/` has no heal path. `grep -i 'heal|pack|depot' server/*.mjs` finds only a P3-seam
  comment in `server/level.mjs` ("supply depots ... P3 seams"). On the page, `hand-fire.js`
  heals the page's copy (`page.applyHeal`, `vehicleDamage.heal`). `net-room.js` lets the
  server's soldier HP only lower the page's copy ("HP drops apply (never heals"). For a hull,
  `takeServerHp` / `applyHull` pull the copy back to the server's value on the next `hull` row,
  and that row is sent only when the server's hull HP moves.
- A player notices: in a room, a medic heals a teammate, but only on the medic's screen. The
  teammate's own bar never rises, and the server kills them at their old HP. A wrench-repaired
  tank snaps back to its old damage on the next hit.
- To build: run the medic sweep, the wrench and the depot field in `server/authority.mjs` from the
  player's fire input (the room already authorises hand fire through `net-server-rounds.js`).
  Send the soldier's HP as the hulls' HP is sent (`room-pads.mjs` `hull` rows), and let
  `net-room.js` apply a rise as well as a drop.

### [DIFFERENT] [impact: medium] [effort: S] Bots hold fire for a teammate in the line; retail bots fire through them
- Retail: FF-7. No fire condition tests a team or casts a ray, so a bot fires through a teammate,
  and the friendly-fire ratio alone decides the damage (100 % shipped, FF-3). FF-8: being hit by
  a teammate never makes that teammate a target.
- Ours: `bot-plans.js` `holdFireFor` / `friendly-fire.js` `friendInLine`, switched on by default
  (`bot-referee.js` `bot.holdFire = env.holdFire !== false`) and marked INVENTION in the code.
  `?holdfire=0` and the runner's engine-parity runs turn it off.
- A player notices: a human who walks into a bot's line of fire is never shot. In retail they
  would be hit and counted as team-killed.
- To build: this was a deliberate choice (`features/bot-friendly-fire`). Either make `?holdfire=0`
  the default or keep the invention and list it as one. The owner decides.

### [UNREAD] [impact: medium] [effort: S] Which side each bot joins, and whether the human counts
- Retail: `gameStatusPlaying` tops bots up while players are under max players and the bot
  count is under its maximum (0x08150e92..0x08150f4c). Each new bot's side is
  `PlayerManager::getTeamToAddPlayer(serverAlliedTeamRatio, serverAxisTeamRatio)` 0x08261670,
  called at 0x08150ee3 with `GameServer+0x2bc` / `+0x2c0`. That function counts every player
  already on team 1 and on team 2, humans and bots alike, and compares their ratio-weighted shares
  with one more player on each side. It returns the side that keeps the shares closer, and
  `rand() & 1` + 1 on a tie (0x0826179e). So with the human already on a side, an odd bot count
  comes out even (human plus 7 bots against 8 bots for 15 bots), and an even count leaves a spare
  bot on a random side.
- Ours: `map.html` (`teams: [friendly, enemy]`) and `bot.js` `spawnBots`
  (`teamList[i % teamList.length]`). The split alternates starting with the player's side, so
  15 bots come out 9 against 7 counting the human. A campaign's `?enemyBots=` follows its own
  difficulty ratio, which is a separate rule.
- A player notices: in Instant Battle with an odd bot count, the human's side has two more
  soldiers than the enemy.
- Settle it: whether the human already has a side when the first playing tick tops the bots up.
  A lab run with an odd `setMaxNBots` and the client joining before the round starts would
  answer it, or the client's Instant Battle path that sets the player's team before `startServer`.
  If the human counts, `spawnBots` should run `getTeamToAddPlayer` with the human pre-counted.

### [MISSING] [impact: medium] [effort: L] A room has no bots; a retail server can run co-op with bots
- Retail: AI-7. The dedicated server tops itself up to `setMaxNBots` every tick, so humans and
  bots share an online co-op round. Every cell of this report then applies between remote humans
  and the server's bots too.
- Ours: `server/authority.mjs` and `room*.mjs` run no bots (no `bot` in `server/*.mjs` outside
  comments). Bots exist only in a page that is its own server (single player, Instant Battle).
- A player notices: there is no online co-op.
- To build: run `bot-referee.js` inside the room's world (the referee is already DOM-free enough
  that `sim/` runs it under node). Add a bot's player row and inputs to the snapshot stream.
  Large, and it is the owner's call.

### [PARTIAL] [impact: low] [effort: S] The team-kill punish vote
- Retail: `GameServer::TKPunish(int)` 0x081593d0 and `TKForgive(int)` 0x081592e0, behind
  `game.serverTKPunishMode` (`setTKPunishMode` 0x0813e1a0). The console aliases are `punish` and
  `forgive`. The shipped `serverTKPunishMode` is 0 (`features/bot-friendly-fire`), so it is off
  unless a host turns it on.
- Ours: `console-aliases.js` registers the aliases. Nothing behind them punishes or forgives, in
  a room or in single player.
- A player notices: only on a server whose host turned punish mode on.
- To build: read `TKPunish(int)` (what punishing costs the killer) before building it. Low
  priority.

### [UNREAD] [impact: low] [effort: S] `BotManager::getBotRequestedPlayerControlObject`
- Retail: 0x0849c880 returns, for a human, the unit a bot holds that the human asked for (the
  request of `bug-bot-seat-yield.md` (b)). Its callers are virtual and were not traced. It could
  feed a HUD hint or the seat finder.
- Ours: nothing. Today's seat-yield build stores the request on the bot only.
- Settle it: find the vtable slot (`IBotManager` +0x44 likely) and its callers in lnxded and in
  the client.

## From the sweep: retail behaviour with no ledger row

- **Every radio read the AI makes** (the 38 `getMessageStrength` call sites listed above). Only
  the three read by Change have a row (AI-169, AI-170). The Fire, MedicAssist, MoveTo, Scout,
  TakeCover and LandingCraft factors deserve one row each.
- **Bot side assignment**: `getTeamToAddPlayer` 0x08261670, called from the top-up loop at
  0x08150ee3, with the team ratios at `GameServer+0x2bc` / `+0x2c0`. AI-7 says only "topped
  up".
- **Behaviour classes that exist and are never built.** No call to their constructors exists
  anywhere in lnxded (each has 0 call sites): `BBRepair`, `BBResupply`, `BBMine`,
  `BBExplosives`, `BBManWpn`, `BBIndirect`, `BBCombatMovement`, `BBRadio`. So retail bots never
  walk to a depot to resupply or repair, never lay mines or charges as a behaviour, and never
  speak on the radio. `BFEnvironment::getRadioedObjects` 0x085e31d0 clears its vector and
  returns, so nothing a player radios as spotted becomes a known object. `BBBailOut`, `BBRoam` and
  `BBMedicAssist` do have create functions (`BBCreateFunction*`), registered by name from the AI
  data.
- **No score for heals, repairs or resupply.** The only `handleScore` (vt+0x68) calls in lnxded
  are: `_giveDamage` 3 and 6 (kill, team kill), `killPlayer` 5, `ControlPoint::handleFrameUpdate`
  1 (Attack, 0x08283d5c), `Flag::handleUpdate` 2, `Flag::handlePickup` 1 and `Flag::handleDrop` 0,
  plus the objective awards. A medic, an engineer, a depot and a driver who carries others
  score nothing. `ScoreManager` has no heal or repair field (its getters: kill, death, capture,
  TK, attack, defence, objective, objectiveTK). Conquest has no Defence award; Defence is the CTF
  flag return only.

## BUILT and NOT-GAME, one line each

- BUILT: a human's seat request or "Bail out" radio to a bot's seat -> `bot-radio.js`,
  `bot-mount.js` `seatRequestAge`, `bot-referee.js` `radioMessage` (built today).
- BUILT: a human pressing E at a bot-driven hull with a free seat takes that seat (SEAT-30/32)
  -> `entry-points.js`, `vehicle-entry.js`.
- BUILT: bots board a human-driven hull's free seats, with no x2.5 "moved by a bot" factor ->
  `bot-units.js` (`movedByBot: driver !== env.localPlayerId`), `bot-mount.js`.
- BUILT: a human medic heals bots and enemies in 10 m, and heals themself at 0.15 ->
  `hand-fire.js` `useMedPack`.
- BUILT: a human's wrench repairs the nearest wounded hull, any side's -> `hand-fire.js`
  `useRepairPack`.
- BUILT: bot medics find and walk to wounded friends, the human included (the heal itself is
  DIFFERENT, above) -> `bot-behaviours.js` `MedicState`, `bot-plans.js` medic plan.
- BUILT: no points for healing or repairing, as in retail -> `round-state.js` (no such key).
- BUILT: kill, team kill (-2), suicide, a death costing a ticket, the hull's crew killed by the
  lethal hit's owner -> `round-state.js` `kill` / `died`, AI-76, KILLSTAMP-1/2 in
  `net-relay.js` / `chat-log.js`.
- BUILT: a Conquest point's takers score `attack` (2), not `capture` -> `round-state.js`
  `capture` (the "Not implemented: attack and defence" line in
  `features/viewer-score-and-bleed/README.md` is stale).
- BUILT: a team kill gets no reaction from the bot that was hit (FF-8) -> nothing to build.
- BUILT: picking up a dead player's kit (G, 1.1 m, no team test, swap), bots never pick kits up
  -> `kit-drops.js`, `kit-drops-page.js` (KITDROP-1..9).
- BUILT: ammo comes only from depots, carried ones too (a supply truck any driver takes along);
  bots never seek one (BBResupply is dead in retail too) -> `supply.js`, `world-fields.js`.
- BUILT: a pad's vehicle left empty counts down `TimeToLive`, then loses `damageWhenLost` until
  it dies and the pad respawns it; it is never returned to its pad -> `deployables.js`
  `AbandonClock`, `level-statics.js` `stepVehiclePads` (SPAWN-13, SPAWN-18; SPAWN-20's
  out-of-area bill is the vehicles bucket's).
- BUILT: a pad waits while a live human stands within 2 m of it (SPAWN-14) -> `level-statics.js`
  `padSpawnClear`.
- BUILT: spawning into a seat, 5 m for a human and 15 m for a bot, by Use -> `spawn-seat.js`
  (SPAWN-25..27).
- BUILT: the round's end kills everyone, seated or not, with no score or ticket, and destroys
  every root hull and kit; the restart rebuilds from the pads -> `map.html` `clearWorld`,
  `round-end.js`, `server/authority.mjs` `clearWorld` (ROUND-7, ROUND-10, ROUND-11).
- BUILT: bots never reply on the radio, as in retail (RADIO-8; BBRadio is never constructed) ->
  `comms.js` sends only on a key press.
- NOT-GAME: `BBRepair`, `BBResupply`, `BBMine`, `BBExplosives`, `BBManWpn`, `BBIndirect`,
  `BBCombatMovement`, `BBRadio`: dead classes, never constructed.
- NOT-GAME: `BFEnvironment::getRadioedObjects`, an empty stub.
- NOT-GAME: `AIRadio::clearMessagesForBot` 0x08482480, with no direct caller.
