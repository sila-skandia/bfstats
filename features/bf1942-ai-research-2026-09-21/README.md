# Bots: how Refractor's AI works, and what parity would cost

Research only. No viewer or extractor code changed. This document exists so
that a future stream can build bots without rediscovering the subsystem, and so
that `SHOW_BOT_SETTINGS` in `viewer/play/menu-screen.js` can be switched on with
real semantics behind each control.

> **Second-reader pass, 2026-09-21.** Every claim below was re-derived from the
> binaries by an independent verifier. Three things changed: the tick order in
> §1.3 was wrong (the AI runs **first**, not last, and the one-tick bot latency
> it implied does not exist), the `IAIMain` secondary vptr is at
> `vtable for AIMain + 0x80` not `+ 0x78`, and the `C = 0/10/30` selection in
> §6.2 was read on the wrong object. Two open items closed: §5.3's skirmish
> AI-SKILL slider really is inert, and §6.2's `C` is an anti-aircraft penalty.
> The aim-error formula, its branch sense, its constants, the call-site argument
> order, the four-row skill table, the 55-entry `PlayerInputMap`, the 30-entry
> `InformationType`, the difficulty jump tables, the ten `getBotSkill` call
> sites, `AISettings::reset`'s 0.75, the `aiMeshes` binding rule and its
> `0x411` material flags, the `Pathfinding/` coverage table, the dead
> `precision` word, the `ai.rfa`-is-scaffolding finding and the 90-byte binary
> diff all reproduced exactly.

**Binary.** Every address below is `bf1942_lnxded.static` unless marked
*client*, in which case it is `BF1942.exe` (sha256 `60c9452d…cd3699`, the hash
`xref.py check` verifies). The copy read here is
`/home/dylan/Downloads/bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`.
It is **not** the same file as the corpus's
`/home/dylan/projects/public/bf42plus/bf1942_lnxded.static` — 90 of 15,218,900
bytes differ — but the two have **byte-identical symbol tables**
(`diff <(nm -C a) <(nm -C b)` is empty) and every differing byte lies in
networking, game-event and console code, none of it in `dice::bf::ai`:

```
$ bash scratchpad/w5d/diffmap.sh
08082a8b..08082a8f   ConsoleClass523::executeObjectMethod +0x4b
0810d912..0810d921   gcd_think +0x282
0810e114..0810e12f   send_auth_req +0x94
08135d17..08136d69   GameServer::handleGameEventManagerEvent (3 ranges)
084367fd             NetServer::checkVersion +0x2d
0843c150..0843c156   SWConnection::getPacketFromRecvQueue +0x50
087189e7..08718a51   keyval.0 (2 ranges)
```

So lnxded addresses in this document are interchangeable with the corpus's, and
`lnxded/decompile.sh` (which runs against the bf42plus copy) was used freely.

The AI subsystem is fully symbolised: 379 `BotMain::`, 275 `BotManager::`, 201
`AIPathfinding::`, 148 `Bot::`, 130 `SAI::`, 114 `AIInformationGrid::`, 105
`AIMain::`, 91 `AISettings::`, plus ~40 `BAPA*` and ~40 `Entry*` plan-action
classes.

---

## 1. The shape of it

### 1.1 A bot is a player, and it writes the same `PlayerInput` a human does

This is the single most important fact for a viewer build, and it is verified
end to end.

`BotMain` owns a `dice::ref2::io::Input<dice::ref2::io::PlayerInputMap, 55u>` —
the engine's `PlayerInput` — at `BotMain+0x04`. Every plan action writes into
it. Once per bot per AI pass, `BotMain::updatePlayerAction(bool)` **0x08526430**
hands it to `AIPlayer::addInput(PlayerInput*)` **0x085dcf10**, which is two
calls long:

```c
void AIPlayer::addInput(PlayerInput* in) {
    PlayerAction a;
    PlayerAction::set(a, *in);                  // the wire record's own packer
    ActionBuffer::pushBack(player->[0x144], a); // the same buffer the net fills
}
```

`BFPlayer+0x144` is the `ActionBuffer` the netcode research already documented
(ledger D-2/D-3): the server trims it to four dropping the oldest, and
`GameServer::simulatePlayerUpdate` **0x0815bd00** consumes exactly one entry per
player per tick. **A bot is therefore not a special case anywhere below the
input layer.** It is a player whose actions are synthesised locally instead of
arriving over a socket, and it goes through the same quantisation
(`PlayerAction::set` **0x081128a0**) as a networked human.

`updatePlayerAction(true)` first clears the one-shot buttons — `PIFire` (8),
`PIAltFire` (23), `PIReload` (24), `PILie` (28) — through
`Input<PlayerInputMap,55u>::isInputMapped`.

### 1.2 `PlayerInput` layout, and the complete `PlayerInputMap` enum

`EntryInfanteryResetControls::execute` **0x08617c40** does, at its end,
`*(u32*)(playerInput + index*4) = 0` after a bounds check that errors when
`index > 0x36` and prints the limit `0x37`. So **`PlayerInput` is a flat array
of 55 floats at offset 0**, indexed by `PlayerInputMap`, with a 55-bit "is this
channel mapped" mask at `+0xdc`/`+0xe0` (two u32s) that
`Input<PlayerInputMap,55u>::isInputMapped` tests. `0x37 = 55 = c_PINumInput`,
which is the template's `55u`.

Every index confirms this: `resetAllControls(drive, look, action)` **0x08526650**
zeroes `[0x00]`…`[0x0c]` for indices 0…3, `[0x10]`/`[0x14]` for 4/5, `[0x20]`
for 8, `[0x5c]` for 0x17, `[0x70]` for 0x1c — all exactly `4 * index`.

The enum itself is registered explicitly, one `addConstantHelper(name, value)`
call per name, in `dice::ref2::io::Module::init()` **0x083f8870**. Decoded with
`python3 scratchpad/w5d/enumdump.py 0x083f8870 0x083fa400`:

| # | name | # | name | # | name |
|---|---|---|---|---|---|
| 0 | `PIYaw` | 19 | `PIMenuSelect6` | 38 | `PIRadio5` |
| 1 | `PIPitch` | 20 | `PIMenuSelect7` | 39 | `PIRadio6` |
| 2 | `PIRoll` | 21 | `PIMenuSelect8` | 40 | `PIRadio7` |
| 3 | `PIThrottle` | 22 | `PIMenuSelect9` | 41 | `PIRadio8` |
| 4 | `PIMouseLookX` | 23 | `PIAltFire` | 42 | `PIScreenShot` |
| 5 | `PIMouseLookY` | 24 | `PIReload` | 43 | `PIToolTip` |
| 6 | `PICameraX` | 25 | `PIDrop` | 44 | `PISayAll` |
| 7 | `PICameraY` | 26 | `PIToggleCameraMode` | 45 | `PISayTeam` |
| 8 | `PIFire` | 27 | `PIToggleCamera` | 46 | `PINextItem` |
| 9 | `PIAction` | 28 | `PILie` | 47 | `PIPrevItem` |
| 10 | `PIUse` | 29 | `PICrouch` | 48 | `PICommunication` |
| 11 | `PIMouseLook` | 30 | `PICameraMode1` | 49 | `PIShowScoreBoard` |
| 12 | `PIWalk` | 31 | `PICameraMode2` | 50 | `PIMap` |
| 13 | `PIRun` | 32 | `PICameraMode3` | 51 | `PIZoomMap` |
| 14 | `PIMenuSelect1` | 33 | `PICameraMode4` | 52 | `PIShowMapVote` |
| 15 | `PIMenuSelect2` | 34 | `PIRadio1` | 53 | `PIVoteYes` |
| 16 | `PIMenuSelect3` | 35 | `PIRadio2` | 54 | `PIVoteNo` |
| 17 | `PIMenuSelect4` | 36 | `PIRadio3` | 55 | `PINumInput` = `PINone` |
| 18 | `PIMenuSelect5` | 37 | `PIRadio4` | | |

This extends the corpus's partial list in
[handweapon-view-and-deviation.md](../bf1942-engine-reference/subsystems/handweapon-view-and-deviation.md)
§2 (which had 0–5, 8, 9 and 23 from the client) to all 55, with a registration
address per name. The viewer's own `netcode.js` mask bits (Fire 8, Walk 12,
Run 13, AltFire 23, Lie 28, Crouch 29) all check out; its Jump = ch30 and
Pad = ch31 remain the documented departures — ch30 is `PICameraMode1` here.
There is no `PIJump` in the enum at all: the corpus already settled that the
engine's jump is **`c_PIAction` = 9**
([handweapon-view-and-deviation.md](../bf1942-engine-reference/subsystems/handweapon-view-and-deviation.md)
§2, "jump (c_PIAction) only"), so the viewer's ch30 is a departure from channel
9, not from a channel the engine lacks.

### 1.3 The tick

`GameServer::simulateFrame(float)` **0x0815c2a0** — the once-per-1/30 s
simulation tick the netcode research established (ledger D-1) — calls, in order:

| order | offset | call |
|---|---|---|
| 1 | +0x09 | `game->getGameStatus()` (`Game` vptr +0x74, **0x080617b0**, reads `Game+0x58`) |
| 2 | **+0x1b3** | **`GameServer::updateAI(dt)` 0x0813a3f0** — only when the status is 1 (`Playing`) |
| 3 | +0x28 | `simulatePlayersUpdate(dt)` **0x0815bfa0** — pops one buffered action per player, applies it |
| 4 | +0x72 | `simulatePlayersPhysics(dt)` **0x0815c0f0** |
| 5 | +0xa2 | `Game::updateWorldCollision(dt)` **0x0805da00** |
| 6 | +0xbe | `simulatePlayersCollisions(dt)` **0x0815c140** |
| 7 | +0xfd | `updateGameLogic(dt)` **0x081505c0** (skipped when the status is 4) |
| 8 | +0x125 | `Game::updatePortals(dt)` **0x0805daa0** (skipped when the status is 4) |

**The `+0x1b3` block is not the last thing that runs; it is the last thing that
is *laid out*.** `dec eax / je 0x0815c449` at **0x0815c2b8** sends control to
the cold block gcc parked at the end of the function, and that block ends
`jmp 0x0815c2be` (**0x0815c45b**) — back into the main body at +0x1e, one
instruction past the branch. So `updateAI` runs **before**
`simulatePlayersUpdate`, not after it. The status values come from
`GameServer::updateGameLogic` **0x081505c0**, which switches the same
`Game+0x58` field: 1 → `gameStatusPlaying`, 2 and 5 → `gameStatusEndGame`,
3 → `gameStatusPreGame`.

`Game::updateAI(float)` **0x0805da50** is three virtual calls on the singleton
`dice::bf::ai::IAIMain::instance` (**0x0874fb8c**): `isInitialised()`
(IAIMain vptr +0x1c), then `tick(dt)` (+0x24), then `action()` (+0x28).
`GameServer::updateAI(float)` **0x0813a3f0** is the server's identical twin.
Those slots resolve through the **secondary** vtable of `AIMain` —
`vtable for dice::bf::ai::AIMain` + **0x80** is the `IAIMain` sub-object's vptr
(the symbol carries the secondary offset-to-top `0xfffffffc` at +0x78 and the
typeinfo at +0x7c; the "+8" rule applies to the secondary table exactly as it
does to the primary) — to `AIMain::isInitialised` 0x08479520 through the thunk
at symbol +0x9c, `AIMain::tick(float)` 0x08479580 through +0xa4 and
`AIMain::action()` 0x084778d0 through +0xa8.

Bots go through `simulatePlayersUpdate` like everyone else:
**0x0815bfa0** walks the whole `playerManager` list and calls
`simulatePlayerUpdate` for a player when `GameServer::getClient(id)` returns 0 —
which is exactly the bot case, a player with no network client — as well as for
clients whose byte `+0x09` flag is set. There is no separate bot update path.

**The AI runs first in the tick, not last.** The whole chain —
`simulateFrame` -> `GameServer::updateAI` -> `IAIMain::action()` ->
`AIMain::action()` (0x0847798b) -> `BotManager::action()` (0x0849a166) ->
`actionExecutePlan()` -> `bot->updatePlayerAction(bool)` (Bot vptr +0xb8, called
at **0x0849a640**) -> `AIPlayer::addInput` -> `ActionBuffer::pushBack` — has
already pushed this tick's bot action into the buffer by the time
`simulatePlayersUpdate` runs. A bot therefore does **not** pay the extra tick of
latency an earlier draft of this document claimed; its freshly written action is
in the buffer the consumer reads in the same `simulateFrame`.

**UNVERIFIED**: whether `GameServer::simulatePlayerUpdate` **0x0815bd00** then
actually consumes that newest entry or an older one. It selects by a sequence
index (`cmp eax,0x36` at 0x0815bd3b, `cmp eax,0xffffffff` at 0x0815bd75) that
was not decoded here, so the *realised* bot latency is 0 or 1 ticks and the
buffer-selection rule decides which. What is settled is the ordering: the write
precedes the read.

### 1.4 `AIMain::action()` is a time budget, not a loop over bots

`AIMain::action()` **0x084778d0** computes
`budget = getTimeIncrease() * aiSystemQuotient` — `getTimeIncrease` is AIMain's
own primary vtable slot +0x0c (**0x08479440**) and `aiSystemQuotient` is the
double at `AIMain+0x10`, written by `AIMain::setAISystemQuotient(double const&)`
**0x08477840** (console word `aiSystemQuotient`, record `0x087c3600`) and
accepted unclamped.

`0.95 * budget` is then split by a second pair of quotients written by
`AIMain::setAISystemComponentsQuotient(a, b)` **0x08477880** as
`a/(a+b)` at `AIMain+0x18` and `b/(a+b)` at `AIMain+0x20` (`ai/hq.con`'s
`ai.setAISystemComponentsQuotient 9 1` → 0.9 / 0.1): the strategic AI gets
`0.95 * budget * [+0x20]` and `BotManager::action` gets `0.95 * budget * [+0x18]`.
Both scalings are applied only when the SAI-enabled flag at `AIMain+0x75` is
set; with SAI off, `BotManager` gets the full `0.95 * budget`. `AIMain::action`
also steps one *side* per call round-robin
(`i = (i + 1) % IAISettings::getNSides()`), and finishes with
`AILODManager::updatePlayers()`, `AILODManager::updateBots()` and
`AIRadio::update()`.

`BotManager::action(double const& budget)` **0x0849a130** splits that budget
across five phases, each of which iterates bots until its slice is spent:

```
actionDeadBots();  buildObjectMap();  updateDamages();
actionExecutePlan   (0x0849a320)  gets  0.40 * budget
actionDecisionMaking(0x0849aeb0)  gets  0.60 * budget * q_decision
actionPathfinding   (0x0849b790)  gets  0.60 * budget * q_path
actionHearing       (0x0849aaf0)  gets  0.60 * budget * (1 - q_decision - q_path) * 0.1
actionSensing       (0x0849b3a0)  gets  0.60 * budget * (1 - q_decision - q_path) * 0.9
```

`q_decision` (`BotManager+0x9c`) and `q_path` (`+0xa4`) come from
`AIBotManager.setSystemQuotient a b c` **0x08498cd0**, which stores
`a/(a+b+c)` and `b/(a+b+c)`; `c` is the implicit remainder. Vanilla Gazala's
`AI.con` sets `40 40 20`, so 0.40 / 0.24 / 0.24 / 0.012 / 0.108 of the budget.

The consequence for parity: **the engine does not sense, decide or path every
bot every tick.** Each phase has a per-bot LOD tick counter
(`AIBotManager.setLodLevelTicks 6 6 6`) and drops out when its wall-clock slice
is gone. Only plan *execution* — the part that writes `PlayerInput` — is cheap
enough to run for everyone. A viewer that runs everything for everyone every
frame will look *better* than the game, not worse; the engine's staleness is a
performance compromise, not a design feature.

---

## 2. Spawning and kitting

### 2.1 How bots appear

`GameServer::gameStatusPlaying(float)` **0x08150df0**, around **0x08150e8b**,
runs a top-up loop each tick, guarded by two byte flags at `GameServer+0x64` and
`GameServer+0x468` and by `GameServer+0x18 < GameServer+0x1c`. **INFERRED**: the
two bytes are what `game.isAiLevel` (console object `0x08780780`) and
`game.autoSpawnBots` (`0x08780300`) set — both console words go through
`GameServer` virtual setters (vtable +0x2b0 and +0xac) rather than writing a
field directly, so the identification was not read out:

```
while (IAISettings::getMaxNBots() != IBotManager::getBotCount()) {
    p = playerManager->createPlayer(...);          // vtable +0x60
    this->pickName(&name, ...);                    // GameServer vtable +0xf0
    id = this->registerBot(&name, p);              // GameServer vtable +0x13c
    pl = playerManager->get(id);                   // vtable +0x18
    IAIMain::instance->activateBot(pl, side, name) // IAIMain vptr +0x10
}
```

`AIMain::activateBot(IPlayer*, int side, std::string const&)` is **0x08478510**;
the creation proper is `AIMain::addBot` **0x08477f30** →
`BotManager::addBot(IPlayer*, side, BotMoralAdmin*, float* personality, IObject*)`
**0x08499060**, with `addUnspawnedBot` **0x08478160** / **0x08499820** for the
"exists but has not picked a spawn point yet" case.

Bot names come from `Bf1942/Game/common/{American,British,German,Japanese,Russian}Names.con`
in `Game.rfa`, loaded by `GameServer::loadBots(int mode)` **0x08131ef0**, called
from `GameServer::startServer` at **0x08133582**. `loadBots` runs one console
script per game mode: mode 2 runs `<levelPath>SinglePlayer/Bots.con`, every
other mode runs `<levelPath>SinglePlayer/Skirmish.con` (rodata `0x086bff2d`
and `0x086bff13`). Both files, in vanilla, do nothing but `run` two name lists —
that is their entire content.

### 2.2 How many, and of which side

`aiSettings.setMaxNBots` (console record `0x087bf040`, `ConsoleClass143`; impl
`AISettings::setMaxNBots` **0x08483e60**, read back by `getMaxNBots`
**0x08483a30** at `IAISettings` vtable +0x08) is the ceiling.

```
$ python3 scratchpad/w5d/grep_archives.py 'botSkill|setMaxNBots|autospawnbots|isAiLevel' .con
```

over vanilla plus 18 mods (61 hits):

| mod | `setMaxNBots` | `setBotSkill` |
|---|---|---|
| bf1942 (vanilla) | 64 | **never called** |
| bf1918 | 256 | one call, `aiSettings.setBotSkill<TAB>1` in `game.rfa`'s `AIbehaviours.con` |
| bfheroes, WarFront | 255 | 1.0 (WarFront also 0.7) |
| FH, FHSW | (inherited) | 1.0 (FHSW has two `rem`-ed 0.75 lines, in `Remagen` and `Remagen_jet`) |
| EoD | 64 | 1.0 (twice: `ai.rfa` and `game.rfa`) |
| bg42 | 64 | 0.8 |
| GCMOD, Pirates, FinnWars, interstate | 64 | never |
| XPack1/2, DC_Final, DesertCombat | (neither word appears in their own archives) | never |

Vanilla never sets `botSkill` from data at all, which makes
`AISettings::reset()`'s default (§6) the value that actually runs.

### 2.3 Kit and spawn point

`BotSpawner` picks both:

- `BotSpawner::findSuitableSpawnGroup(float*, float*, float*, float*, int, Bot*)` **0x0864ac80**
  and the by-id form **0x0864b3e0**
- `BotSpawner::findKitDiff(float*, float*, float*, float*, int*)` **0x0864ba30**
- `BotSpawner::sqrDistAndExcess(float*, int*, float&, float&)` **0x0864b9e0**
- `BotSpawner::m_kitWeightVector` (a file-scope global, ctor keyed at 0x0864bbe0)

The data those weigh is `Objects/Items/BaseKit/Ai/Objects.con` in
`Objects.rfa`, which is the whole vanilla kit model for the AI — five
`kitTemplate.create` blocks, each with a strategic-strength pair and six
battle strengths:

| kit | strat 0/1 | Infantry | LightArmour | HeavyArmour | Naval | Sub | Air |
|---|---|---|---|---|---|---|---|
| Medic | 1 / 1 | 6.0 | 3.0 | 1.0 | 0 | 0 | 0 |
| Engineer | 1 / 2 | 4.0 | 4.0 | 3.0 | 0 | 0 | 0 |
| AT | 2 / 2 | 2.0 | 8.0 | 4.0 | 0 | 0 | 0 |
| Assault | 1 / 1 | 8.0 | 3.0 | 1.0 | 0 | 0 | 2.0 |
| Scout | 2 / 1 | 4.0 | 0 | 0 | 0 | 0 | 0 |

`BotMain::getSpawnKit()` **0x0852c6b0**, `getSpawnPoint()` **0x0852c690**,
`getSpawnTarget(int&,int&)` **0x0852c6d0** and `getSpawnCoord()` **0x0852c7a0**
are the accessors the rest of the system reads.

The soldier's own AI template is `Objects/Soldiers/Common/AI/Objects.con`:
`maxSpeed 5.0`, `turnRadius 0.1`, `coverSearchRadius 20.0`,
`setSoundSphereRadius 0.0 15.0`, `setHearingProbability 0.01 0.1`,
`lodHeight 1.0`, and battle strengths Infantry 4 / LightArmour 2 /
HeavyArmour 1 / Air 1.

### 2.4 `ControlInfo`: the per-vehicle mapping from AI intent to input channel

Every drivable object's `Ai/Objects.con` carries an `aiTemplatePlugIn.create
ControlInfo` block that names **which `PI*` channel each AI intent writes** and
how it is scaled. Sherman
(`Objects/Vehicles/Land/Sherman/AI/Objects.con`):

```
driveTurnControl      PIYaw          aimHorizontalControl  PIMouseLookX
driveThrottleControl  PIThrottle     aimVerticalControl    PIMouseLookY
lookHorizontalControl PIMouseLookX   lookVerticalControl   PIMouseLookY
throttleSensitivity  -1.0            yawSensitivity        -2.5
pitchSensitivity      0.21817        rollSensitivity      -0.21817
lookVerticalSensitivity 0.21817      lookHorizontalSensitivity -0.21817
throttleScale 1.0  pitchScale 5.0  rollScale 5.0  yawScale 0.0020
setCameraRelativeMinRotationDeg -360/-20/0
setCameraRelativeMaxRotationDeg  360/5/0
```

Soldier (`Objects/Soldiers/Common/AI/Objects.con`) differs in exactly the way
you would expect: `driveTurnControl PIMouseLookX` (a soldier turns by looking),
`throttleSensitivity 1.0`, `yawSensitivity 1.0`, `pitchSensitivity 0.4363323`,
`rollSensitivity -0.5235988`.

This is a data table a viewer can read straight out of the archives; it needs no
engine read at all, and it is the bridge between "the bot wants to turn left"
and "write −0.4 into channel 0".

---

## 3. The level and object data

### 3.1 `ai.rfa` — vanilla's is developer scaffolding, not shipped content

`Mods/bf1942/Archives/ai.rfa` is 5,853 bytes, dated 2002-08-15, and holds 18
`.con` files. Nine of them (`AITest.con`, `smallWar.con`, `soldierWar.con`,
`spawnBot.con`, `spawnSoldier.con`, `spawnTank.con`, `spawnTankPos.con`,
`tank.con`, `vehicle.con`) are hand test harnesses that spawn a named bot at a
hard-coded coordinate on a map that no longer exists in that form. `hq.con` is
two lines of `ai.aiSystemQuotient 0.5`. `Behaviours.con` and
`GenericPathFinding.con` are superseded by `Bf1942/Game/AIbehaviours.con` and
each level's own `AIpathFinding.con`: the shipped `Behaviours.con` declares
6 behaviours and 4 vehicle types where the live `AIbehaviours.con` declares 8
and 18. Only four mods ship their own `ai.rfa` at all. **Reading `ai.rfa` for
gameplay intent is a mistake.** The live data is in `Game.rfa`, `Objects.rfa`
and the per-level archives.

### 3.2 What the shipped AI data actually is

Survey over vanilla plus 18 mods (`python3 scratchpad/w5d/survey_ai_files.py`,
13,997 matching entries; six level archives fail to open at all and are
reported — four in FHSW and two in FHSWEurope, none in bg42):

| normalised path | count | what it is |
|---|---|---|
| `<object>/Ai/Objects.con` | 4,571 | per-object `aiTemplate` + `aiTemplatePlugIn` |
| `<object>/Ai/Weapons.con` | 2,725 | per-weapon AI `weaponTemplate` |
| `<level>/AIpathFinding.con` | 853 | search-map and search-type declarations |
| `<level>/AI.con` | 848 | per-level AI settings and the strategy wiring |
| `<level>/ai/conditions.con` | 812 | `aiStrategy.create*Condition` |
| `<level>/ai/Strategies.con` | 812 | `aiStrategy.createStrategy` |
| `<level>/ai/prerequisites.con` | 809 | `aiStrategy.createPrerequisite` |
| `<level>/ai/StrategicAreas.con` | 807 | `aiStrategicArea.create` + neighbours |
| `aiMeshes/*.sm` / `*.rs` | 793 / 789 | simplified collision hulls, below |
| `<level>/ai/radio.con` | 11 | `AIRadio.subscribeToMessage` |

Plus, and this the earlier survey pattern missed because the directory is
`Pathfinding/` with no `AI` prefix, the **precomputed navigation maps**
(`python3 scratchpad/w5d/survey_pathfinding.py`, 11,715 entries):

| mod | levels | with `Pathfinding/` |
|---|---|---|
| bf1942 | 23 | 19 |
| XPack1 | 6 | 6 |
| XPack2 | 9 | 8 |
| EoD | 237 | 236 |
| FH | 73 | 55 |
| FHSW | 261 | 36 |
| bg42 | 200 | 160 |
| bf1918 | 134 | 112 |
| WarFront | 90 | 81 |
| bfheroes | 35 | 33 |
| FHSWEurope | 6 | 6 |
| DC_Final / DesertCombat | 48 / 35 | 7 / 8 |
| FinnWars | 70 | 1 |
| GCMOD, Pirates, interstate | 30 / 33 / 13 | **0** |

A mod with no `Pathfinding/` has no working bots on that level.

### 3.3 `<level>/AI.con` and `AIpathFinding.con`

Gazala's (from `Gazala_003.rfa` — the `_003` patch archive, not the base one;
the base archive's copies are the 2002 versions and the `ai/` subdirectory
exists only in the patch):

```con
aiSettings.setWorldMapSize 2048 2048
aiSettings.setViewDistance 300
aiSettings.setInformationGridDimension 32
ai.init 2
AIBotManager.setLodLevelTicks 6 6 6
AIBotManager.setLodLevelPriority 3 3 3
AIBotManager.setPlannedDecisionMakingThreshold   0.5 0.5 0.5
AIBotManager.setUnplannedDecisionMakingThreshold 0.3 0.4 0.4
AIBotManager.setDecisionMakingInterleave 2 2
AIBotManager.setSensingQuotient 1 1
AIBotManager.setSystemQuotient 40 40 20
ai.saiMapXDimension 64
ai.saiMapYDimension 64
ai.createSAI
ai.saiEnable 1
ai.botStatisticUpdateSpeed 3
run AIPathFinding.con        run ai/StrategicAreas
run ai/conditions.con        run ai/prerequisites.con     run ai/Strategies.con
ai.addSAIStrategy 1 north  … ai.addSAIStrategy 2 breakOut
```

```con
ai.numAStarResources 12
rem searchMap name/waterHeight/waterDepth/maxSlope/brush/lowClip/hiClip/considerAITypes
ai.addSearchMap Tank0      0 0   30 3.0 0.3 2.5 0     ai.addSearchType Tank      0 0
ai.addSearchMap Infantry1  0 1.5 30 1.0 0.4 2.0 1     ai.addSearchType Infantry  1 0
ai.addSearchMap Car4       0 0   20 3.0 0.3 2.5 0     ai.addSearchType Car       2 0
ai.addSearchType Boat        ai.addSearchType LandingCraft
ai.setMapSpawnPoints 0 1000/1000   ai.setSmoothing 0 20
ai.setMapSpawnPoints 1 1000/1000   ai.setSmoothing 1 10
ai.setMapSpawnPoints 2 1000/1000   ai.setSmoothin  4 6      rem sic: typo, no such word
ai.loadMaps
```

`ai.loadMaps` is **`AIPathfinding::loadMaps()` 0x0847c580** → `loadSearchMaps`
**0x0847c5c0** + `loadSearchTypes` **0x0847c6b0**. `loadSearchMaps` builds
`game->getLevelPath() + "Pathfinding/"` (rodata `0x086f3198`) and calls
`LocalMap::loadRawFile` **0x085fefb0** per map. So `loadMaps` **loads**; the
generator (`createMaps` 0x0847b2e0, `createAllSearchMaps` 0x0847bb60,
`LocalMap::floodLevelZeroMap` 0x085fbae0 seeded from `setMapSpawnPoints`) is the
editor path. A viewer reads the shipped `.raw` files; it does not need the
flood fill.

### 3.4 The `Pathfinding/*.raw` format

`LocalMap::loadRawFile` loops over levels calling `CellMap::loadRawFile(IStream*)`
**0x085f86a0**, which reads **five int32** and refuses the file unless they equal
the values the `CellMap(name, p3, p4, p5, p6, p7)` constructor **0x085f7af0**
derived:

| file field | checked against | ctor expression |
|---|---|---|
| 1 | `CellMap+0x18` | `p6 - p5` |
| 2 | `CellMap+0x20` | `p7 - p5` |
| 3 | `CellMap+0x10` | `p5` |
| 4 | `CellMap+0x2c` | `p3` |
| 5 | `CellMap+0x24` | `p4` |

then an int32 count of "special cells" and that many u32 ids
(`CellMap::addSpecialCell` 0x085f7f20), then
`(1 << (p6-p5)) << (p7-p5)` row records, each an int32 whose sign selects a
literal row or a reference to a special cell.

Observed headers agree exactly (Bocage_Day2, DC_Final):

| file | fields 1–5 | derived |
|---|---|---|
| `Car4Level0Map.raw` | 5, 5, 6, 0, 0 | p5=6, p6=p7=11, level 0, 32×32 rows |
| `Car4Level1Map.raw` | 4, 4, 7, 1, 0 | p5=7, level 1, 16×16 |
| `Car4Level2Map.raw` | 3, 3, 8, 2, 0 | p5=8, level 2, 8×8 |
| `Boat2Level3Map.raw` | 3, 3, 9, 3, 0 | level 3 |
| `Boat2Level4Map.raw` | 2, 2, 10, 4, 0 | level 4 |
| `Boat2Level5Map.raw` | 1, 1, 11, 5, 0 | level 5 |

So it is a pyramid: field 3 is `6 + level`, fields 1 and 2 shrink with it, and
fields 4/5 are the level index and a second index that is 0 in every sample
seen. `<veh>.raw` (e.g. `Car.raw`, 16,392 bytes, header `20 00 00 00
20 00 00 00`) is the **strategic** map, `StrategicMap::load` **0x08609b60**;
`<veh>Info.raw` is its cell-info table. The 8-bit variants
(`*8Bit.raw`, `load8BitRawFile` **0x085ff070** / `CellMap::load8BitRawFile`
**0x085f8f60**) are an editor debug dump — square, power-of-two, all-zero in
every sample; `loadSearchMaps` never asks for them.

**SETTLED 2026-09-22** (see `pathfinding-raw-format.md`):

- **Field 4** = `level_index`, always equals field 3 (`level`). Used by
  `LocalMap::loadRawFile` to iterate over levels and load the correct CellMap.
- **Field 5** = `reserved`, always 0. Stored in `CellMap+0x24`, validated on
  load, no other known use.
- **Per-row encoding**: non-negative = index into the special cell table
  (`special_cells[val]`). Negative = literal cell value — the engine allocates
  a new cell from its `MemoryPool` (`CellMap+0x48`) and stores the negative
  int32 as the cell's data. This is a sparse compression: most cells share one
  of a few special cell definitions, only differing cells carry their own value.
- **World-units-per-cell**: from `LocalMap::getLevelPixelSize(int)` @ 0x085ff170:
  `cell_size = 1 << level`. Combined with world map size W:
  `grid_width = W / (1 << (max_level - level))`. For Car4 at level 0 with
  W=2048 and width_bits=5: `units_per_cell = 2048 / 32 = 64`.

### 3.5 `aiMeshes.rfa` — simplified hulls, bound by name

Vanilla's `aiMeshes.rfa` is 180 entries: 90 `.sm` and 90 `.rs`. Parsed with the
project's own reader (`bf42.stdmesh.parse`), all 90 succeed: versions 9 (83)
and 10 (7), 140 material descriptors, **every one** with vertex `flags` 0x411
and `primitive` 4 (triangle list). They are ordinary StandardMesh files; the
paired `.rs` is a plain one-pass shader with a green `materialDiffuse 0 0.7 0.3`
— a debug colour, since nothing renders these on a server.

The binding rule is exact and verified.
`AIMeshLoader::getAIMesh(IGeometry*)` **0x08479940**:

1. take the geometry's template name,
2. truncate it at the **last** `_` (`std::string::rfind('_')`),
3. append `"_a1"` (rodata **0x086f315c**),
4. `getAIMesh(name)` **0x08479a10** prefixes `"AIMeshes/"` (rodata
   **0x086f3160**) and loads it as a StandardMesh.

So `Afrohouse_m1` → `Afrohouse_a1` → `AIMeshes/Afrohouse_a1.sm`. The archive is
mounted by `Setup::loadArchives` (the literal `"aiMeshes.rfa"` at
**0x086b9e2d**, referenced at **0x080c8ec2**).

Ten `.aim` files exist across the whole install (six in bf1918's `aiMeshes.rfa`,
four in FH's `Gold_Beach-1944`). **UNVERIFIED**: nothing in the 1.61 server
reads a `.aim` extension — `getAIMesh` asks for the bare name and the
StandardMesh loader supplies `.sm`. They look like leftovers from an editor.

Note `dice::bf::ai::AIMeshVertex::vertexFormat` at **0x0874f2f8** is `0x11`,
which is **not** the 0x411 the shipped `.sm` files carry; it belongs to
`AIMeshLoader`'s own vertex description, not to the file.

### 3.6 Strategic areas, conditions, prerequisites, strategies

Per level, four files, all plain console script. Gazala again:

`ai/StrategicAreas.con` declares vehicle groups (`land`, `any`, `sea`,
`infantry`) and assigns each of the 18 vehicle types to one, then declares 11
named areas as `aiStrategicArea.create <name> <x1>/<z1> <x2>/<z2> <radius>`
with, per area, `addAllowedVehicleGroup`, `addNeighbour` (an adjacency graph),
`addObjectTypeFlag` (`ControlPoint`, `North`, `South`, `Base`, `Remote`,
`Centre`, `Safe`), `setOrderPosition <vehicleType> <x>/<z>` and `setSide`.

`ai/conditions.con` declares fuzzy/crisp predicates over counts of flagged
objects:

```con
aiStrategy.createConstantCondition northCond  Crisp Equal        Friendly North 0
aiStrategy.createConstantCondition southCond  Crisp EqualSmaller Friendly South 2
aiStrategy.createConstantCondition minTwoEnemyFrontCond Crisp EqualGreater Enemy Front 2
aiStrategy.createConstantCondition timeCond   Fuzzy EqualSmaller Friendly StartTime 200
aiStrategy.setConditionStrength Required | AdvisoryNegative
aiStrategy.setIsAbortCondition 1
```

`ai/prerequisites.con` bundles conditions with weights
(`aiStrategy.addCondition northCond 10.0`), and `ai/Strategies.con` declares the
strategies themselves:

```con
aiStrategy.createStrategy north
aiStrategy.Aggression 0.8
aiStrategy.NumberOfAttacks 1     aiStrategy.NumberOfDefences 1
aiStrategy.TimeLimit 300         aiStrategy.setPrerequisite northPrereq
aiStrategy.setStrategicObjectsModifier North       10.0 Hostile
aiStrategy.setStrategicObjectsModifier North        0.3 Owned
aiStrategy.setStrategicObjectsModifier ControlPoint 2.0
```

Gazala ships six per side (`north`, `south`, `both`, `behind`, `finalPush`,
`breakOut`), each side adding them with `ai.addSAIStrategy <side> <name>`. The
strategic AI picks whichever strategy's prerequisite scores highest and
multiplies every strategic object's value by that strategy's modifiers; the
per-bot layer then takes orders against those weighted objects.

---

## 4. Behaviour: how basic it really is

### 4.1 Eight behaviours, eighteen vehicle types, one urgency contest

`Bf1942/Game/AIbehaviours.con` in `Game.rfa` (50,640 bytes, 765 lines) is the
whole model:

```con
aiSettings.setNBehaviours 8
0 Avoid  1 MoveTo  2 Idle  3 Fire  4 Scout  5 TakeCover  6 Change  7 Special

aiSettings.setNVehiclesTypes 18
0 Tank        1 Plane      2 Boat         3 Infantery   4 Fixed      5 Car
6 UnarmedTank 7 LandingCraft 8 Passenger  9 BoatFixed  10 LandingCraftPassenger
11 LandingCraftFixed 12 UnarmedBoat 13 FixedLargeBore 14 ArtilleryDriver
15 UnarmedPlane 16 AmphibiousCar 17 FixedGuidedMissileLauncher
```

and, per (vehicle type, behaviour), one row:

```
setVehicleBehaviour <vehicle> <behaviour> <urgencyGenerator> <planGenerator> <prio> <parallelMask> <urgencyCurve> <inhibitors>

Infantery Avoid     BBAvoid          BBPAvoidCollisionInfantery  1  0 UCUnion AvoidInhibit
Infantery MoveTo    BBMoveTo         BBPGotoWaypointInfantery    4  0 UCUnion UnitWeights
Infantery Idle      BBIdle           BBPIdleInfantery            5  0 UCUnion UnitWeights
Infantery Fire      BBFireInfantery  BBPFireInfantery            4  0 UCFire  UnitWeights
Infantery Special   BBMedicAssist    BBPMedicAssist             12  0 UCUnion UnitWeights
Infantery Scout     BBScout          BBPScoutInfantery           8  0 UCUnion UnitWeights
Infantery TakeCover BBTakeCoverInfantry BBPTakeCoverInfantry     4  0 UCUnion UnitWeights
Infantery Change    BBChange         BBPChange                   6  0 UCUnion UnitWeights
aiSettings.setVehicleDefaultBehaviour Infantery Idle
```

Three urge curves exist in the whole file:

```con
aiSettings.createUCConstant UCUnion 1.0
aiSettings.createUCLinear   UCFire -0.22 1.3
aiSettings.createUCXInverse UCScout 2.5 0.9 1.0 0.5
aiSettings.createUCConstant UCScoutLimit 1.0
```

and four behaviour-weight sets (`UnitWeights` all 1.0, `StandardWeights` with
Fire 7.5 / TakeCover 2.0 / Change 1.9 / MoveTo 1.5 / Idle 0.1,
`PlaneWeights`, plus per-situation inhibitor sets). The file carries the
engine's own warning in a comment: *"NEVER ALLOW IDLE's urgency to become 0.
The AI will CRASH in that case."*

The decision loop is therefore: each behaviour's `UrgencyGenerator` produces a
scalar; it is multiplied by the bot's behaviour-weight vector and its urge
curve; the highest wins; the winner's `PlanGenerator` emits a plan
(`BotBehaviour::generatePlan(Bot*)` **0x08583380**,
`getUrgency` **0x08583490**, `getActiveUrgency` **0x085834b0**,
`hasChangedTarget` **0x08583510**, `quotientChanged(Bot*, float, float)`
**0x08583540**). That is the whole contest. There is no planner, no search over
action sequences, no world model beyond `BotMemory` and the spotted-object list.

### 4.2 The plan is a short instruction list, and its instruction set is closed

A plan is a `BotScript` of `BAPStatement`s, interpreted by a `PlanInterpreter`
whose entries are registered per vehicle type with
`aiSettings.addInterpreterEntry <vehicle> <entry> [lodLevel]`. The full
instruction set is the `Entry*::execute(BotScript*, Bot*, bool&, bool&)` symbol
set — 40 classes:

```
BoatMoveTo/ToDirection/ToObject/ResetControls
CarMoveTo/ToDirection/ToObject/ResetControls
InfanteryMoveTo/ToDirection/ToObject/ResetControls
TankMoveTo/ToDirection/ToObject/TurnTo/ResetControls
PlaneMoveTo/ToDirection/ToObject/AimAt/Roll/ResetControls
MoveToLight, MoveToLightSoldier, MoveToMedium, MoveToMediumBoat,
MoveToMediumSoldier, MoveToObjectMedium, MoveToObjectMediumBoat,
MoveToObjectMediumSoldier, TurnToMedium
KeyTurretAimAt, MouseTurretAimAt, MouseTurretLookAt
Trigger, TriggerContinously, Sense, SoldierPose, InfoWrapper
```

`Infantery`'s registered set in vanilla is exactly:
`MoveToMediumSoldier(Medium)`, `MoveToObjectMediumSoldier(Medium)`,
`InfoWrapper`, `InfanteryMoveTo`, `InfanteryMoveToDirection`,
`InfanteryMoveToObject`, `Trigger`, `TriggerContinously`, `MouseTurretAimAt`,
`InfanteryResetControls`, `MouseTurretLookAt`, `Sense`, `SoldierPose`.

Thirteen instructions. **That is how basic it is**: a bot's entire per-tick
output is "point at X, move toward Y, hold or tap the trigger, pick a pose",
each of which is one of thirteen functions writing a handful of floats into a
55-slot array.

The parallel `BAPA*` classes (`BAPAAimAt`, `BAPAMoveToObject`, `BAPASense`,
`BAPATrigger…`, `BAPAChangeWeapon`, `BAPAUpdateVehicle`, `BAPALook`,
`BAPALookAhead`, `BAPATurn`, `BAPAPhysicsEnable`, `BAPANotifyBot`, `BAPAIdle`,
`BAPAEvaluate`) are the statement *actions* the entries execute.

### 4.3 The object type mask

`aiTemplate.addType ITxxx` (console object `0x087cc3c0`, handler
**0x08500980**) does exactly `template->[0x08] |= 1 << enumValue`. The
`InformationType` enum is 0..29 and was decoded from the jump table of
`dice::bf::ai::operator<<(ostream&, InformationType)` **0x08485290**
(`python3 scratchpad/w5d/enum_from_jt.py 0x086f3f5c 30`):

```
0 ITProduction  1 ITAmmunition  2 ITRepair    3 ITUnit       4 ITAir
5 ITGround      6 ITNaval       7 ITControlpoint 8 ITRadar    9 ITAirfield
10 ITTransportation 11 ITArtillery 12 ITFixed  13 ITCover    14 ITMobile
15 ITEditors    16 ITTopography 17 ITUnmanned 18 ITLowPriority 19 ITStructure
20 ITBiological 21 ITVegetation 22 ITSoldier  23 ITObstructedView
24 ITNoTemperature 25 ITNoRender 26 ITNoChildRender 27 ITScaleRender
28 ITSampling   29 ITTargetTemperature
```

The same mask appears to be mirrored into the runtime `Information` record at
`+0x04`, which is how two behaviour gates in `BotMain::resetAllControls`
**0x08526650** read. Taking the u32 at `Information+0x04` as the mask, byte
`+0x04` carries bits 0–7 and byte `+0x06` bits 16–23:

- `PIThrottle` is cleared only when `(byte[+0x04] & 0x10) == 0` — bit 4,
  **ITAir**. An aircraft keeps its throttle.
- `PILie` and `PICrouch` are cleared only when `(byte[+0x06] & 0x40) == 0` (or
  a virtual at `Bot` vtable +0xbc returns true) — bit 22, **ITSoldier**. Only a
  soldier has a stance to keep.

Both readings make sense, and the bit positions land on exactly the right two
enum values, but **`Information+0x04` as the mirror is inferred from those two
uses; its writer was not read.**

### 4.4 `AITemplateCover`

`aiTemplatePlugIn.create Cover <name>` + `aiTemplatePlugIn.coverValue <f>`.
Every building in `Objects.rfa` has one — `Afrhouse` is
`coverValue 50.0` with types `ITCover ITStructure ITNoTemperature`,
`degeneration 1`, `allowedTimeDiff -1`, `commonKnowledge 1`; a Sherman is
`coverValue 4.0`. It is a scalar "how much does hiding behind this help",
consumed by `AIObjectCover` / `AITemplateCover` (20 symbols) and by the
`TakeCover` behaviour's plan generator `BBPTakeCover`. `commonKnowledge 1` on
static cover is why bots know where buildings are without spotting them.

---

## 5. Difficulty: the Instant Battle screen, exactly

This is the answer `SHOW_BOT_SETTINGS` needs. Everything in §5.1 is read out of
the shipped MemeFile; §5.2 is read out of the client binary.

### 5.1 The controls, from `menu/SkirmishMenu`

`python3 scratchpad/w5d/sliders.py menu/SkirmishMenu` (decoded with the
project's own `bf42.meme` reader):

| variable | node | min | max | step | shipped default | labels |
|---|---|---|---|---|---|---|
| `Skirmish/SkirmishAiSkill` | `BfSliderNode` | 1 | 4 | 1 | 2 | 1 EASY, 2 NORMAL, 3 HARD, 4 IMPOSSIBLE |
| `Skirmish/SkirmishBotRatio` | `BfSliderNode` | 1 | 4 | 1 | 2 | same four |
| `Skirmish/SkirmishNrOfLives` | `BfSliderNode` | 1 | 4 | 1 | 2 | same four |
| `Options/General/SkirmishPercentageOfBots` | `BfFixedSliderNode` + `BfEditNodeInt` | 50 | 400 | 5 | 185 | `GENERAL_OPTIONS_PERCENTAGE_OF_BOTS` |
| `Options/General/SkirmishPercentageOfCpu` | `BfSliderNode` + `BfEditNodeInt` | 10 | 25 | 1 | 25 | `GENERAL_OPTIONS_PERCENTAGE_OF_CPU` |
| `Skirmish/SkirmishDifficultyLevel` | preset buttons | 1 | 4 | — | 1 | 1 CUSTOM, 2 EASY, 3 NORMAL, 4 HARD |
| `Skirmish/SkirmishTicketRatio` | (bound, no slider on this page) | | | | 2 | |
| `Skirmish/SkirmishOverallDifficulty` | derived | | | | 50 | |
| `Skirmish/SkirmishCustom` | `BoolData` | | | | true | |

The three sliders sit under `SINGLEPLAYER_AI_SKILLS`, `SINGLEPLAYER_BOT_RATIO`
and `SINGLEPLAYER_NR_OF_LIVES`; the two percentages sit under a
`SINGLEPLAYER_PERFORMANCE` heading. `slider.Number visible = 0.5` on the three
four-step sliders and `1.0` on the two percentage sliders, which is what makes
the first three read as discrete notches.

The three preset buttons write the sliders directly
(`python3 scratchpad/w5d/setvars.py menu/SkirmishMenu`):

| preset | DifficultyLevel | AiSkill | NrOfLives | BotRatio | OverallDifficulty | Custom |
|---|---|---|---|---|---|---|
| EASY | 2 | 1 | 1 | 1 | 25 | false |
| NORMAL | 3 | 2 | 2 | 2 | 50 | false |
| HARD | 4 | 3 | 3 | 3 | 75 | false |
| CUSTOM | 1 | — | — | — | — | — |

Moving any slider by hand sets `SkirmishDifficultyLevel = 1` (CUSTOM) through a
`CullVariableActionNode`. **IMPOSSIBLE (4) on any individual slider is reachable
only in CUSTOM** — no preset sets it.

The values persist in
`Mods/bf1942/Settings/Profiles/<profile>/SinglePlayerSettings.con` as
`Game.setSkirmishAiSkill`, `setSkirmishBotRatio`, `setSkirmishNrOfLives`,
`setSkirmishTeam`, `setSavedSkirmishMap`, `setSkirmishDifficulty`, and the
campaign equivalents.

### 5.2 What the numbers become

Client **`FUN_006dd910` @ 0x006dd910** converts all three, and its three jump
tables were read in raw disassembly (`disassemble_bytes` over 0x006dd910 and the
tables at 0x006dda18 / 0x006dda28 / 0x006dda38), not just in the decompiler:

| AiSkill | float produced |
|---|---|
| 1 EASY | **0.25** (`0x3e800000`) |
| 2 NORMAL | **0.5** (`0x3f000000`, the `default` arm) |
| 3 HARD | **0.75** (`0x3f400000`) |
| 4 IMPOSSIBLE | **1.0** (`0x3f800000`) |

| BotRatio | pair produced |
|---|---|
| 1 EASY | 1 : 1 |
| 2 NORMAL | 3 : 4 |
| 3 HARD | 1 : 2 |
| 4 IMPOSSIBLE | 1 : 3 |

| NrOfLives | int produced |
|---|---|
| 1 EASY | 1 |
| 2 NORMAL | 5 |
| 3 HARD | 10 |
| 4 IMPOSSIBLE | 20 |

The float goes straight into the AI: its caller **`FUN_0044e7b0` @ 0x0044e7b0**
takes it as its sixth argument and, in its first three instructions after the
prologue guard, does
`IAISettings::instance(0x00a78610)->vtable[+0x40](value)` at **0x0044e7f3** —
and slot +0x40 of `IAISettings` is `getBotSkill`/`setBotSkill` (the lnxded
`AISettings` vtable has `getBotSkill` at +0x40 and `setBotSkill` at +0xbc;
the client's interface vtable puts the setter at +0x40, which the client's own
`aiSettings.setBotSkill` console handler **0x006f3310** confirms by calling
exactly that slot). `FUN_0044e7b0` is called by the level-start paths
`FUN_004544c0`, `FUN_00450aa0`, `FUN_00450bc0` and the menu's
`FUN_006dc8c0`.

The ratio pair and the lives int are passed to the same function as arguments 3,
4 and 5; **INFERRED, not read**: they are the team ratios
(`game.serverAlliedTeamRatio` / `serverAxisTeamRatio`) and the ticket setting.
The caller swaps arguments 3 and 4 when the player picked team 1, which is what
a team ratio would need and a tickets value would not.

### 5.3 The one gap, stated plainly

`FUN_006dd910` has two branches. The **campaign** branch (`param_2 != 0`) reads
its AiSkill from `CampaignSettings+0x48` — which is exactly the field
`game.setCampaignAiSkill`'s console handler **0x006bd370** writes, so that path
is proved end to end.

The **skirmish** branch (`param_2 == 0`) reads a **byte** at
`SkirmishSettings+0x88`:

```
006dd926 MOV   EAX, dword ptr [ECX + 0xc]
006dd929 MOVZX ECX, byte ptr [EAX + 0x88]
006dd930 MOV   EDX, dword ptr [EAX + 0x68]
006dd933 MOV   EAX, dword ptr [EAX + 0x70]
```

`+0x68` is `Skirmish/SkirmishBotRatio` and `+0x70` is
`Skirmish/SkirmishNrOfLives` — both confirmed by the menu's own variable
bindings, read one per `LEA EDX,[ESI+off]` at 0x006dc526…0x006dc6a7:

```
+0x64 SkirmishAiSkill   +0x68 SkirmishBotRatio   +0x6c SkirmishTicketRatio
+0x70 SkirmishNrOfLives +0x74 SkirmishOverallDifficulty
+0x78 SkirmishDifficultyLevel +0x7c SkirmishCustom
+0x80 ShowSkirmishDisconnectConfirm  +0x84.. SkirmishLevelsList
```

but the skill is read from `+0x88`, **not** from `+0x64` where
`Skirmish/SkirmishAiSkill` lives (and where `game.setSkirmishAiSkill`'s handler
**0x006bc9e0** writes). The object's constructor at **0x006dc84b** sets
`byte [ESI+0x88] = 0`, and a scan of the whole `.text` for `mov byte [reg+0x88]`
in both `c6`- and `88`-encoded forms
(`python3 scratchpad/w5d/pescan.py 'c6 ?? 88 00 00 00'` and `'88 ?? 88 00 00 00'`,
ten sites total) found no other writer on this object.

That means the Instant Battle **AI SKILL slider does nothing** in 1.61 retail:
`+0x88` stays 0, `0 - 1` fails the `CMP ECX,3 / JA` range check, and the default
arm gives 0.5 whatever the slider says.

**SETTLED by a second reader, 2026-09-21.** The object is identified without
ambiguity: it is allocated `new 0x8c` at **0x006ddb74**, constructed at
**0x006dc800** (vptr `0x0092454c`, which occurs in exactly two places in the
whole image — that constructor and the destructor at 0x006dc866), and stored at
`[parent+0x0c]`. Its constructor sets `+0x64 = +0x68 = +0x6c = +0x70 = 2`,
`+0x78 = 1`, `+0x7c = 0`, `+0x80 = 0` and `+0x88 = 0` (`xor ebx,ebx` at
0x006dc804, so the `bl` stored at 0x006dc84b is 0). Over a full
`objdump -d` of `BF1942.exe`:

- **byte writes to `[reg+0x88]`**: ten sites in the image, the nine besides the
  constructor all on other classes (0x00490e86 / 0x00490f19 / 0x0049103a and
  0x004999af initialise objects with a string at `+0x8c` and `+0x80/+0x84 = -1`;
  0x0049681c writes `+0xc4` and `+0x180`; 0x0068d5b4 an object with
  `+0x6c = 3` and colour words; 0x007b300d / 0x007b30d0 / 0x007b314d a
  window-ish object linked through `[+0x64]+0x4`). None has the
  `+0x64..+0x70 = 2` / `+0x84` pointer layout.
- **writes of any width whose base was loaded from `[X+0x0c]`**: none.
- **`lea reg,[obj+0x88]`**: 25 sites; the only two that feed the menu variable
  registrar `0x0069eb50` bind the names `"Tickets"` (0x006bea9b) and
  `"GameKit"` (0x006cc3ce) on unrelated objects.
- **byte reads of `[reg+0x88]`**: eight in the image, exactly two of them on
  this object — `FUN_006dd910` at 0x006dd929, and a getter at **0x006ddb20**
  (`return this->[0x0c]->byte_0x88`) called from 0x006aab03 and 0x006abfbe.
  The field has a getter and **no setter**.
- **the value the slider does write**, `+0x64`, is read only at 0x006dd479
  (formatting it into `SinglePlayerSettings.con`) and 0x006dd6e8 (a
  save/restore pair with 0x006dd8c2). Nothing routes it to `setBotSkill`.

So AI SKILL in Instant Battle is inert in retail 1.61 and botSkill is always
0.5 on that path. A wine test is no longer needed to establish it, though one
would still be a nice confirmation.

**What the viewer should do meanwhile**: wire the slider to botSkill using the
§5.2 table (1→0.25, 2→0.5, 3→0.75, 4→1.0). That is the mapping the engine's own
conversion function implements, it is what the campaign path demonstrably does,
and it is the behaviour a player expects from the label. If the retail skirmish
path really is inert, matching the *intent* is the better parity choice and
should be labelled as a deliberate departure, the way the turret camera was.

### 5.4 Where the two percentages go — open

`SkirmishPercentageOfCpu` (10–25) is almost certainly the AI's share of the
frame, i.e. `ai.aiSystemQuotient` / `AIMain+0x10` (`ai/hq.con` sets
`ai.aiSystemQuotient 0.5`, and the local `ServerSettings.con` carries
`game.serverCoopCpu 20`). `SkirmishPercentageOfBots` (50–400 %) is presumably a
scale on `aiSettings.setMaxNBots`. **Neither was traced.** Note a firm negative
result on the way: `game.serverCoopAiSkill` and `game.serverCoopCpu` are
**stored and reported only** — in lnxded the only readers of
`Setup+0x2b4`/`+0x2b8` are `EventLogger::beginRound` and `bfRulesCallback`
(`bash scratchpad/w5d/freads.sh 8716b64 2b4`), and in the client the only
readers of the same fields at `[0x00971eac]+0x564`/`+0x568` are three
string-format sites (0x0040397b, 0x0040b71b, 0x00551b54). Neither binary feeds
them to the AI. Do not build a difficulty model on those two console words.

---

## 6. Aim and lethality

### 6.1 `AISettings` and its defaults

`AISettings::reset()` **0x08484450** sets, among others:

| offset | value | what | accessor |
|---|---|---|---|
| +0x1c | `0x44160000` = **600.0** | view distance | `getViewDistance` 0x084842c0 (`fld [eax+0x1c]`) |
| +0x20 | `0x44000000` = 512.0 | stats view distance | `getStatsViewDistance` 0x08484410 |
| **+0x24** | **`0x3f400000` = 0.75** | **`botSkill`** | `getBotSkill` 0x08484760 / `setBotSkill` **0x08484770** — a bare store, no clamp, no declared range (`objectHasRange()` **0x084c44d0** returns 0) |
| +0x28 | `0x40000000` = 2.0 | SAI update frequency | `getSAIUpdateFrequency` 0x08484920 |
| +0x2c | `0x20` = 32 | information-grid dimension | `getInformationGridDimension` 0x08484400 |
| +0x30 | `0` | number of sides | `getNSides` 0x08484440 (written by `reset` at 0x0848460c) |

So with vanilla data, which never calls `aiSettings.setBotSkill`, **the default
bot skill is 0.75 — the game's own HARD**. A level's `AI.con` overrides
`setViewDistance` (Gazala: 300, down from the 600 default) and
`setInformationGridDimension` (32, the same as the default).

`getBotSkill` has exactly **ten call sites** in the whole server
(`bash scratchpad/w5d/vcalls.sh 874fe8c 40`):

- `BotManager::actionExecutePlan` +0xff (0x0849a41f)
- `ConsoleClass177::executeObjectMethod` (the `getBotSkill` console word)
- `EntryInfoWrapper::execute` ×1
- `EntryTrigger::execute` ×4
- `EntryTriggerContinously::execute` ×3

That is the entire reach of the difficulty setting. It changes how fast plans
are stepped, and it changes trigger-pull accuracy. It does **not** change
health, damage, speed, reaction time, spotting range or anything else.

In `actionExecutePlan` its use is
`inclinationStep = (getBotSkill() * 0.1 + 0.1) * getTimeIncrease()` (0x0849a422
then 0x0849a442) — so at skill 0.25 a plan advances at 0.125 per second of
budget and at skill 1.0 at 0.2, a 1.6× spread.

### 6.2 The deviation formula

`EntryTrigger::execute` **0x086257d0** and `EntryTriggerContinously::execute`
**0x08625ff0**, immediately before pulling the trigger, call
`Weapon::setBotSkill(float,float,float)` through the weapon's vtable +0x84
(`WeaponFireArm::setBotSkill` **0x085ee580**, `WeaponBundle::setBotSkill`
**0x085ed050**). Argument order, read off the push sequence at
0x08625daf–0x08625dc9:

```
weapon->setBotSkill( A = IAISettings::getBotSkill(),
                     B = bot->getFiringTargetTime(),   // Bot vtable +0x84 -> BotMain+0x1b8
                     C = 0.0f | 10.0f | 30.0f )
```

`WeaponFireArm::setBotSkill` then computes one float and tail-jumps to
`FireArms::setAIDeviation(float)` **0x0828e350**. Worked out instruction by
instruction from the x87 at 0x085ee587–0x085ee60b (the `fucom`/`test ah,0x45`
arm was decoded from the flags, and the taken branch at 0x085ee610 is the
`> 0` side):

```
dev = (1 - 0.75*A) * C
    + F30 * ( F38 * max(0, F34*(1-A) - (now - B)) + 0.25*(1-A) )
```

with `now = IAITimer::instance->vtable[+8]()` and the three template fields:

| field | console word | handler | meaning |
|---|---|---|---|
| `WeaponTemplate+0x30` | `weaponTemplate.deviation` | **0x08510580** | the magnitude |
| `WeaponTemplate+0x34` | `weaponTemplate.deviationCorrectionTime` | **0x08510980** | the settle time |
| `WeaponTemplate+0x38` | — (same handler) | | `t == 0 ? 0 : 1/t` |

The constructor **0x085ef740** defaults them to **`deviation = 5.0`,
`deviationCorrectionTime = 10.0`, `+0x38 = 0.1`**, so every AI weapon has a
deviation even when its `Ai/Weapons.con` says nothing.

Substituting the defaults and dropping the `C` term:

| skill | at the instant the target is acquired | steady state | settle time |
|---|---|---|---|
| 0.25 (EASY) | 4.69 | 0.94 | 7.5 s |
| 0.5 (NORMAL) | 3.13 | 0.63 | 5.0 s |
| 0.75 (HARD, and the engine default) | 1.56 | 0.31 | 2.5 s |
| 1.0 (IMPOSSIBLE) | 0.00 | 0.00 | 0 s |

The units are the weapon's crosshair-radius units, the same ones
`handweapon-view-and-deviation.md` §2 uses: `setAIDeviation` stores into
`FireArms+0x190`, which `FireArms::updateDeviation` **0x0828d410** and
`HandFireArms::updateDeviation` **0x08293e80** **add into the total and then
zero** (`fadd [ecx+0x190]` at 0x0828d44c, `mov [ecx+0x190],0` at 0x0828d452;
the hand-weapon twin at 0x0829414d/0x08294153). It is a **one-shot additive
term on the next deviation update**, not a persistent state — which is exactly
what the corpus already recorded as the unexplained `aiPending` channel. That
row can now be closed.

`C` is 0.0, 10.0 or 30.0, and the selection **is** readable. Two different
`Information` records are involved, not one: `E` = the bot's own current
equipment (`bot->vt[0xd0]()` = `BotMain::getCurrentEquipment`, resolved through
the handle table at `0x087beee0` at 0x08625cf0) and `T` = the bot's firing
target (`bot->vt[0x80]()` = `BotMain::getFiringTarget`, resolved the same way at
0x08625dd7). Then, reading the branches at 0x08625d81 / 0x08625e18 /
0x08625e5c / 0x08625e64:

```
if (E.typeMask & ITAir)                      C = 0.0    // 0x08625d81
else if (T is null)                          -> no setBotSkill call at all
else if (!(T.typeMask & ITAir))              C = 0.0    // 0x08625e18
else if (E->[0x20]->vt[0x6c]())              C = 10.0   // 0x08625e54
else if (E.typeMask & ITNaval)               C = 10.0   // 0x08625e64
else                                         C = 30.0
```

So `C` is an **anti-aircraft penalty on the shooter**, not a property of the
target class as such: it is 0 for every ground-versus-ground engagement and for
any bot that is itself flying, 30 for an ordinary ground bot shooting at an
aircraft, and 10 for a naval bot (or one satisfying the unidentified predicate
at `E->[0x20]` vtable +0x6c) doing the same. The bit positions are `ITAir` = 4
(`0x10`) and `ITNaval` = 6 (`0x40`) in the §4.3 enum, read out of
`Information+0x04` under §4.3's inferred mirror. At skill 1.0 the term still
contributes `0.25*C`, so an IMPOSSIBLE bot shooting at a plane still carries
7.5 units of error. Dropping `C` in the table below is therefore correct for
infantry-versus-infantry, which is the case a viewer builds first.

**UNVERIFIED**: what `E->[0x20]`'s vtable slot +0x6c tests.

(The earlier draft of this section put both flag tests on the target's record
and cited `0x08625d91`, which is not an instruction boundary.)

### 6.3 The AI weapon table across the install

`python3 scratchpad/w5d/survey_ai_weapons.py` — 3,290 AI `weaponTemplate`s
across vanilla and 18 mods. **Scope caveat**: that script only opens archives
whose *name* contains `objects`. Re-running the same scan over every archive
finds a further **540** AI `weaponTemplate.create` lines in level archives and
`GCMOD/texture.rfa` (3,830 in all) — including 17 in vanilla's own
`Kasserine_Pass.rfa`. The per-word counts below are therefore the
`*objects*.rfa` subtotal, not the install total; the ratios and the
conclusions are unaffected, and no level-archive template sets `deviation` in
vanilla:

| word | uses |
|---|---|
| `setStrength` | 19,734 |
| `indirect` | 3,291 |
| `create` / `burst` / `minRange` / `maxRange` / `weaponActivate` | 3,290 each |
| `weaponFire` | 3,282 |
| **`deviation`** | **602** |
| **`deviationCorrectionTime`** | **556** |
| `setSoundSphereRadius` | 524 |
| `isThrown` | 126 |
| `exitVelocity` | 63 |
| `useAimerOnly` | 49 |
| `healing` | 33 |
| `precision` | 16 (15 by an all-archive rescan, all in `WarFront/Objects.rfa`) — **not a registered console word in 1.61; these lines are dead**. Verified by a case-insensitive byte scan of both binaries: the only `precision` tokens are `shadowPrecision` and libstdc++ symbols, while `deviation`, `deviationCorrectionTime`, `minRange`, `maxRange`, `burst` and `weaponFire` each occur exactly once |
| `drag` | 4 (registered: `ConsoleClass623`, record `0x087cf840`) |

Vanilla sets `deviation` on exactly four templates and
`deviationCorrectionTime` on none:

```
K98AI        deviation 5.0      SniperK98AI  deviation 2.0
No4AI        deviation 5.0      SniperNo4AI  deviation 2.0
```

— i.e. vanilla leaves everything at the constructor's 5.0/10.0 and only makes
the scoped rifles *tighter*. The `deviation` values across all mods cluster at
2.0 (197), 10.0 (178), 15.0 (77) and 5.0 (35), with a long tail of sub-1.0
values in mods that evidently rescaled the units.

A complete AI weapon template, for reference
(`Objects/HandWeapons/K98/AI/Weapons.con`):

```con
weaponTemplate.create K98AI
weaponTemplate.burst 0
weaponTemplate.deviation 5.0
weaponTemplate.indirect 0
weaponTemplate.minRange 0.0
weaponTemplate.maxRange 200.0
weaponTemplate.weaponActivate PIMenuSelect3
weaponTemplate.weaponFire     PIFire
weaponTemplate.setStrength Infantry 4.0   LightArmour 0.0  HeavyArmour 0.0
weaponTemplate.setStrength NavalArmour 0.0  Submarine 0.0   Air 1.0
weaponTemplate.setSoundSphereRadius 150.0
```

Note `weaponActivate` and `weaponFire` are `PlayerInputMap` **channel names** —
the AI weapon template says, literally, "to select me press MenuSelect3, to fire
me press Fire". Field offsets for the rest, from the console handlers:
`minRange` +0x18, `maxRange` +0x1c, `soundSphereRadius` +0x24,
`exitVelocity` +0x28, `weaponActivate` +0x40, `weaponFire` +0x44,
`setStrength` into an array at `*(+0x3c)`.

---

## 7. What parity would cost

Stated as stages, each of which is shippable on its own.

### Stage 0 — what the viewer already has

More than it looks. The netcode work (W-1…W-5, D-1…D-6) built the exact socket a
bot plugs into: `viewer/netcode.js` already implements `PlayerAction`'s
quantisation and `World.setInput(id, input, look, seq)` already enforces the
buffer law. The deviation pipeline (`viewer/deviation.js`) already models
`updateDeviation` at 30 Hz and already has a slot for an additive term. The
soldier, the weapons, the vehicles, the seats, the spawn screen, the scoreboard
and the minimap all exist. **Nothing in the bot path needs new rendering.**

### Stage 1 — "something to shoot", roughly 2 to 3 days

A bot that stands on a spawn point, faces the player when the player is in front
of it, and fires with the engine's own deviation.

- Needs from the engine, all in this document: the `PlayerInputMap` indices
  (§1.2), the per-vehicle `ControlInfo` channel mapping (§2.4), the deviation
  formula and its defaults (§6.2).
- Needs from the extractor: **`Ai/Weapons.con`'s `deviation`,
  `deviationCorrectionTime`, `minRange`, `maxRange`, `burst` and `weaponFire`
  per weapon.** These are not emitted today. It is a small addition to the
  existing weapon extraction — the files sit next to the ones already read.
- Needs from the viewer: a `bot.js` that owns a `PlayerInput`, a "who can I
  see" test against the existing world, and a call into `World.setInput` at the
  end of each tick. Spawn it through the existing spawn-point data.
- Must be invented: which spawn point, and the "can I see it" test. The engine's
  own sensing (`BotMain::sense` **0x08521cf0**, `event_SpottedEnemyObject`
  **0x08523ae0**, the vision frustum at **0x08526bf0**, `AIInformationGrid`)
  was not read in this round. **Say so in the build's own record.**

### Stage 2 — "it walks", roughly a week on top

Patrol between control points, take cover, change weapon.

- Needs a navigation source. Two options:
  1. **Read `Pathfinding/*.raw`.** 19 of 23 vanilla levels ship them, and EoD
     236 of 237. §3.4 has the header and the loader addresses but **not** a
     decoded grid; finishing that is a binary read of `CellMap::loadRawFile`'s
     row loop plus a validating survey. Call it two days.
  2. **Generate one.** The extractor already has the heightmap and the static
     collision meshes; a slope/height flood fill per vehicle class reproduces
     what `LocalMap::floodLevelZeroMap` does and sidesteps the format entirely.
     Probably cheaper, and it works on the mods that ship no `Pathfinding/`.
     This is an invention, not parity — label it.
- Needs from the extractor: `ai/StrategicAreas.con` (areas, neighbours, order
  positions, side) per level. Plain console script; the existing `.con` reader
  handles it.

### Stage 3 — "it plays the game", weeks

The urgency contest, plans, the strategic layer.

- §4 has the complete data model and the closed instruction set, so this is
  mostly transcription of `AIbehaviours.con` plus writing eight urgency
  generators and eight plan generators. The generators themselves
  (`BBFireInfantery`, `BBPTakeCoverInfantry`, …) were **not** read; they are
  ~40 more functions in the 0x0853–0x0862 range. Each is small.
- The strategic layer (`SAI`, `AIStrategicObjectManager`,
  `StrategyCondition`) is a second system of comparable size. It is what makes
  bots attack the right flag; it is not what makes them shootable. Defer it.

### Only a binary read can give

- The decoded `Pathfinding/*.raw` grid (§3.4).
- The sensing model: what a bot can see, at what range, through what, with what
  delay. `AISettings::getViewDistance` (default 600, Gazala 300) and
  `getStatsViewDistance` (default 512) exist; the frustum test and the `AIInformationGrid`
  sweep were not opened.
- What selects `C = 0/10/30` in the deviation formula (§6.2).
- Whether the skirmish AI-skill slider is live (§5.3).
- The per-behaviour urgency generators.

### Must be invented, and should be labelled as such

- Target selection below the strategic layer (the engine's is
  `calculateVehicleUrgency` + `BotMemory` + the spotted list; none read).
- Reaction time. The engine has none as such — it falls out of the LOD tick
  counters and the time budget, which a browser page has no reason to copy.
- Anything to do with bots in vehicles beyond the `ControlInfo` mapping.

### The honest summary

A bot that gives the player something to shoot at is **cheap** — a few days —
because the engine's own bot is cheap: thirteen plan instructions writing into a
55-float array that the viewer already consumes. A bot that plays Conquest is
**expensive** and is a different project. The value is almost all in stage 1.

---

## 8. Reproducing everything here

All helpers live in the scratch directory
`/tmp/claude-1000/-home-dylan-projects-skandia-bfstats/792e4718-d2c1-4282-91fc-863b6f4b3be3/scratchpad/w5d/`
and are self-contained (they import the project's own `bf42` readers by absolute
path).

| script | what it answers |
|---|---|
| `diffmap.sh` | which functions differ between the two lnxded copies |
| `dumpcls.sh` / `cls.sh <Class>` | a class's symbols |
| `xr.py str\|refs\|sym\|f32\|u32` | strings, 4-byte references, containing symbol, constants |
| `whichfn.py <regex>` | every disassembly line matching a pattern, with its function |
| `vcalls.sh <singleton> <slot>` | every call through one vtable slot of one singleton |
| `freads.sh <global> <offset>` | every read of one field of one global object |
| `enumdump.py <start> <stop>` | `addConstantHelper` enum registrations |
| `enum_from_jt.py <table> <n>` | an `operator<<` jump table → enum names |
| `consolescan.py` | every `ConsoleObject` registration in the binary (1,659 rows) |
| `eom.sh <vptr>…` | a console word's `executeObjectMethod` and the field it writes |
| `pescan.py <bytes>` | byte-pattern scan of `BF1942.exe`, with virtual addresses |
| `lsrfa.py` / `catrfa.py` / `cat_obj_ai.py` / `findentry.py` | archive listing and dumping |
| `survey_ai_files.py` | every AI-related archive entry across all mods |
| `survey_pathfinding.py` | `Pathfinding/` coverage and `.raw` headers |
| `survey_ai_weapons.py` | every AI `weaponTemplate` and its words |
| `grep_archives.py <regex>` | grep the `.con` files inside every archive |
| `skirmish_menu.py` / `sliders.py` / `setvars.py` | decode `menu/SkirmishMenu` |

Ghidra bridge calls against the client used `xref.py` plus raw
`POST /disassemble_bytes` and `GET /read_memory`; no function was created and no
analysis was re-run.

---

## 9. Open items, collected

| # | Open | Where to start |
|---|---|---|
| A | ~~Is the Instant Battle AI-skill slider live?~~ **CLOSED, it is not** — `SkirmishSettings+0x88` has a getter and no setter anywhere in `BF1942.exe` | §5.3 |
| B | Where `SkirmishPercentageOfBots` / `OfCpu` land | §5.4 |
| C | The `Pathfinding/*.raw` row encoding and world scale | §3.4, `CellMap::loadRawFile` 0x085f86a0 |
| D | ~~What selects `C = 0/10/30`~~ **CLOSED** — an anti-aircraft penalty keyed on the bot's own equipment and its firing target; one sub-predicate (`E->[0x20]` vtable +0x6c) still unnamed | §6.2 |
| E | Whether `Information+0x04` really mirrors the `aiTemplate.addType` mask | §4.3 |
| F | The sensing model (frustum, grid, hearing) | `BotMain::sense` 0x08521cf0 |
| G | The per-behaviour urgency and plan generators | 0x0853–0x0862 |
| H | Are the ten `.aim` files read by anything in 1.61? | §3.5 |
| I | Ratio/lives arguments 3–5 of client `FUN_0044e7b0` | §5.2 |
