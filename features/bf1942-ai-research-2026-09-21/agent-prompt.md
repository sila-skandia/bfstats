# Implement Faithful BF1942 Bot AI

## Context

The research is fully documented in `features/bf1942-ai-research-2026-09-21/`. Every claim below is backed by binary analysis of `bf1942_lnxded.static` and `BF1942.exe`.

## What exists now (broken)

- `BotController` class in `tools/bf1942-models/viewer/bot.js` with a 55-channel PlayerInput — writes input but bots have no Soldier, so the world never simulates them
- `spawnBots()` creates players without soldiers — they stand still
- `sense()` scans `world.players` but filters out same-team (the human player is on the same team, so bots see nothing)
- `tick()` runs a toy urgency contest that always lands on Idle
- Bots spawn on neutral/uncapped flags instead of only team-capped flags

## What the binary says

### Tick order (README.md §1.3)
AI runs **first** in the tick: `simulateFrame` → `GameServer::updateAI` → `IAIMain::action()` → `BotManager::action()` → `actionExecutePlan()` → `bot->updatePlayerAction()` → `AIPlayer::addInput()`. Bot actions are in the buffer **before** `simulatePlayersUpdate` runs.

### A bot is a player (README.md §1.1)
`BotMain` owns `Input<PlayerInputMap, 55u>` at `BotMain+0x04`. `BotMain::updatePlayerAction(bool)` at `0x08526430` hands it to `AIPlayer::addInput(PlayerInput*)` at `0x085dcf10`. Bots go through `simulatePlayersUpdate` like everyone else — no separate bot update path.

### Behaviours (README.md §4.1)
8 behaviours, 18 vehicle types, one urgency contest:

```
0 Avoid  1 MoveTo  2 Idle  3 Fire  4 Scout  5 TakeCover  6 Change  7 Special
```

Per (vehicle type, behaviour): `setVehicleBehaviour <vehicle> <behaviour> <urgencyGenerator> <planGenerator> <prio> <parallelMask> <urgencyCurve> <inhibitors>`

Infantry rows:
```
Infantery Avoid     BBAvoid          BBPAvoidCollisionInfantery  1  0 UCUnion AvoidInhibit
Infantery MoveTo    BBMoveTo         BBPGotoWaypointInfantery    4  0 UCUnion UnitWeights
Infantery Idle      BBIdle           BBPIdleInfantery            5  0 UCUnion UnitWeights
Infantery Fire      BBFireInfantery  BBPFireInfantery            4  0 UCFire  UnitWeights
Infantery Special   BBMedicAssist    BBPMedicAssist             12  0 UCUnion UnitWeights
Infantery Scout     BBScout          BBPScoutInfantery           8  0 UCUnion UnitWeights
Infantery TakeCover BBTakeCoverInfantry BBPTakeCoverInfantry     4  0 UCUnion UnitWeights
Infantery Change    BBChange         BBPChange                   6  0 UCUnion UnitWeights
```

Urge curves:
- `UCUnion` — constant 1.0
- `UCFire` — linear: `-0.22 * dist + 1.3`
- `UCScout` — XInverse: `2.5, 0.9, 1.0, 0.5`

Weights (`StandardWeights`): Fire 7.5, TakeCover 2.0, Change 1.9, MoveTo 1.5, Idle 0.1

**The engine's own warning:** "NEVER ALLOW IDLE's urgency to become 0. The AI will CRASH in that case."

### Plan interpreter (README.md §4.2)
A plan is a `BotScript` of `BAPStatement`s. 40 instruction classes total. Infantry's registered set:
`MoveToMediumSoldier(Medium)`, `MoveToObjectMediumSoldier(Medium)`, `InfoWrapper`, `InfanteryMoveTo`, `InfanteryMoveToDirection`, `InfanteryMoveToObject`, `Trigger`, `TriggerContinously`, `MouseTurretAimAt`, `InfanteryResetControls`, `MouseTurretLookAt`, `Sense`, `SoldierPose`.

**That is how basic it is**: a bot's entire per-tick output is "point at X, move toward Y, hold or tap the trigger, pick a pose", each of which is one of thirteen functions writing a handful of floats into a 55-slot array.

### Spawning (README.md §2.1-2.3)
`GameServer::gameStatusPlaying(float)` runs a top-up loop each tick, guarded by `game.isAiLevel` and `game.autoSpawnBots`. Bots spawn on team-capped flags via `BotSpawner::findSuitableSpawnGroup()`. Kit selection via `BotSpawner::findKitDiff()` using weights from `Objects/Items/BaseKit/Ai/Objects.con`.

### Sensing (ai-22-sensing-decoded.md)
- Vision: square frustum, aspect 1.0, near 0.8m, far=viewDist (default 600), FOV ~53° infantry / ~113° vehicles
- AIInformationGrid: 32×32 spatial hash grid
- Target selection: closest visible non-blocked enemy → `BotMain+0x1b4` (firingTarget)
- Hearing: weapon fired within 0.5s, `soundSphereRadius` (soldier: 15m outer)

### Deviation (README.md §6.2)
`dev = (1 - 0.75*A) * C + F30 * (F38 * max(0, F34*(1-A) - (now - B)) + 0.25*(1-A))`
Default botSkill = 0.75 (HARD). Default deviation = 5.0, deviationCorrectionTime = 10.0.

## What you must do

### 1. Fix `world.js` `addBotPlayer()`
Give bots a real `Soldier` so `#soldierTick` simulates them. They must move, cap flags, and be visible. Call `spawnPlayer()` with a team flag so they spawn on the correct side.

### 2. Rewrite `sense()`
In single-player, the human (`id === 'local'`) is the only non-bot entity. Bots should target the human regardless of team. Use the frustum params from `ai-22-sensing-decoded.md`.

### 3. Rewrite the urgency contest
Match the engine's actual behaviour system from README.md §4.1:
- `Scout` — look for enemies (high urgency when no target in memory)
- `Fire` — engage target (urgency from UCFire curve)
- `MoveTo` — navigate toward flag/objective
- `TakeCover` — when under fire
- `Idle` — default (urgency must NEVER be 0)
- Use `StandardWeights`: Fire 7.5, TakeCover 2.0, Change 1.9, MoveTo 1.5, Idle 0.1

### 4. Implement plan execution
From README.md §4.2, the 13 infantry instructions. At minimum: `InfanteryMoveTo`, `InfanteryMoveToDirection`, `InfanteryMoveToObject`, `MouseTurretAimAt`, `Trigger`, `InfanteryResetControls`, `Sense`, `SoldierPose`.

### 5. Sync bot position from soldier
The world now steps bots, so `tick()` must read `player.soldier.x/y/z` and `player.soldier.yaw` for the bot's position and facing.

### 6. Fix spawning
`spawnBots()` must use `world.addBotPlayer(playerId, { team, flag })` with flags filtered by `flag.team === botTeam` (only capped flags, not neutral).

## Files to read first

- `features/bf1942-ai-research-2026-09-21/README.md` — especially §4.1-4.2 (behaviours, plan interpreter)
- `features/bf1942-ai-research-2026-09-21/ai-22-sensing-decoded.md` — sensing pipeline
- `features/bf1942-ai-research-2026-09-21/pathfinding-raw-format.md` — nav grid format
- `tools/bf1942-models/viewer/world.js` — `addBotPlayer()`, `#soldierTick()`, `spawnPlayer()`
- `tools/bf1942-models/viewer/soldier.js` — `Soldier` class, `step()`, `spawn()`
- `tools/bf1942-models/viewer/nav-grid.js` — `buildNavGrid()`, `findPath()`, `isWalkable()`
- `tools/bf1942-models/viewer/bot.js` — current broken implementation (replace it)

## Constraints

- Do NOT change `map.html` except to remove the duplicate flag filtering and manual position setting (spawnBots now handles both).
- Do NOT change `world.js` except `addBotPlayer()` to give bots a Soldier.
- All changes must be in `bot.js` (and `spawnBots` export).
- Mark INVENTION where the research is open (AIInformationGrid, raycasting, hearing).
- Syntax check with `node --check bot.js` before finishing.
