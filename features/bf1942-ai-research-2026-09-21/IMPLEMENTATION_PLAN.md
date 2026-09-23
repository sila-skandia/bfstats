# Bots: Stage 1 implementation plan — PROGRESS REPORT

> **Superseded for execution by `BOT_AI_IMPLEMENTATION_PLAN.md`** (2026-09-23),
> which is the source of truth for the bot AI landing. This file keeps the
> original extraction/UI work and now records the departures from that plan.

## Status: implemented (2026-09-23)

`BOT_AI_IMPLEMENTATION_PLAN.md` §1–§4, §6 and §7 landed in
`viewer/bot.js` and `viewer/map.html`:

- `bot.js` replaces the two dead output paths (`_inputToObject`, bare
  `setInput`) with one `_writeInput()` and `_aimLook()`. `look` is the mouse
  count pair the world converts with `soldierLookDegrees`; absolute radians
  into `MouseLookX` are gone. This is what makes bots move and turn.
- The scalar weighted urgency contest (§4.1) replaces the priority chain:
  `urgency = generator * weight * curve`, Idle floored at `IDLE_FLOOR`.
- The plan interpreter runs the 13-instruction infantry set; `SoldierPose`,
  `Sense` and the medium/direction/object delegates are implemented.
- Trigger alignment is relative to the live facing, with the fire edge raising
  `deviation.onShot()`.
- `spawnBots` is team-list-ready (`teams`); `map.html`'s duplicate flag filter
  and `bot.setPosition` block are removed. Bots get an `Armor`.
- Bots capture flags (`botCaptureTick`) and play live gait/stance clips.

Verification: `tests/test_bot_ai.py` (headless `world.js` + `bot.js` harness)
plus `node --check` on `bot.js`, `nav-grid.js` and the `map.html` module body.

## Departures from BOT_AI_IMPLEMENTATION_PLAN.md

1. **Bot firing is a hitscan, not a projectile (§5 parity route).** The plan's
   shared `firePlayerWeapon` cannot make a bot's round damage a player: the
   viewer's collider carries no soldier body and no projectile-vs-soldier
   registration exists on any path (`guns.onImpact` reaches placed objects and
   vehicle hulls only). `map.html`'s `botFireTick`/`resolveBotShot` therefore
   keeps the exact parts it can — the bot's live facing, the engine's deviation
   cone (`theta = spread * sqrt(u)`, the same polar law `gunfire.js` uses) and
   the engine's direct-hit formula (base material damage x the attacker/defender
   `damageMod` pair) — and resolves the hit against a stand-in soldier capsule
   at `CHARACTER_HEIGHT` above the feet. The capsule and the explicit soldier
   hit test are INVENTION.
2. **`map.html` is changed beyond the spawn cleanup.** The plan's §5 says the
   file constraint yields to parity; this landing touches `map.html` for the
   bot Armor, the fire path, bot capture and the live gait family, as that
   section predicted.
3. **UCFire's curve input is normalised.** The research gives `UCFire =
   -0.22*d + 1.3` without stating the input unit. Over raw metres it falls to
   zero past 5.9 m, which cannot be what makes an infantry bot engage at rifle
   range, so the bot feeds it `distance / viewDistance` and the slope is a
   unitless multiplier. Flagged in `bot.js`.
4. **Bot capture is a page-side extension.** The solo capture law was
   local-player-only; `botCaptureTick` runs the same delayed capture for bots so
   they can take flags. Room play stays authoritative.
5. **Both teams are not spawned yet.** Stage 1 keeps all bots on the player's
   team so `sense()`'s local-player special case has a target; `spawnBots`
   already accepts a `teams` array so flipping is a call-site change.

## Follow-up (same day)

- **Squad spawn spread.** `spawnBots` passed no `spawnIndex`, so every bot took
  `spawns[0]` and the four stacked on one another. Each bot now gets its own
  flag/spawn index. (Confirmed headless: four distinct spawn positions.)
- **Friendly map dots.** `paintMap` now draws the game's own
  `icon_vehicledot_friend` sprite for every teammate in `world.players` (bots
  and, on foot, the human), under the local player's arrow. The minimap and
  full-map staleness keys include `friendlyMarkerKey()`, so the dots follow a
  bot without waiting on the camera. This is what makes a squad that has
  advanced out of view findable again.
- **`window.__bots()` debug hook** (under the existing `?shots` gate) reports
  each controller's position, behaviour, inputs, objective and soldier state,
  the same way the other headless hooks do.
- **Obstacle avoidance and unsticking land early.** The plan deferred Avoid to a
  later stage (§4: "collision avoidance is `body-contact` territory"), but a
  squad spawned at a main base wedges in its own sandbag line. `bot.js` now runs
  what `BBAvoid`/`BBPAvoidCollisionInfantery` do in spirit inside the MoveTo
  executor: `_clearDistance` casts the collider's `statics.cast` at waist and
  chest height, and a blocked course turns the bot to run *along* the wall (a
  committed ±90° heading, sticky side) so it walks to the end of a sandbag line
  instead of pushing into it. `_trackStuck` reverses then side-steps after ~0.9 s
  of no per-tick movement. The harness adds an `avoid` scenario.

## Follow-up 2 (2026-09-23): the bots actually animate, and actually path

Two latent bugs were behind the "chess-piece" bots and the sandbag jams.

1. **Bots had no gait clips.** `map.html`'s bot rig read the gait manifest as
   `manifest[weapon].lower`, but its shape is
   `{ lower, grips: { grip: file }, weaponGrip: { weapon: grip } }`, so every
   lookup resolved to `undefined` and loaded `poses/undefined`. `buildBotGaitRig`
   bound only the static poses, and every bot slid across the level in `stand`.
   `botGaitClips` now returns `footBodyClips(weapon)`, the same resolution the
   foot body and the remote renderer share; `FAMILY_CLIPS` and
   `remoteClipFamily` come from `remote-gait.js` (the old local copy had the
   wrong clip names — `lower`/`upper` instead of `walk.lower`/`run.upper` — and
   the wrong prone family name), and the bot group gets the same
   `SOLDIER_YAW_FLIP` correction remotes do. Verified headless: all seven
   families bind and the bots play `run`/`walk`.
2. **The nav grid was empty.** `spawnBotsForLevel` ran *before*
   `buildCollider`, so `buildNavGrid` saw a null collider and every cell came
   out `-2` (no terrain); `findPath` always returned null and every bot walked
   straight at its goal. Three fixes: the call moved after `buildCollider`; the
   slope test is now a gradient (`|dh|/cellSize`, not `|dh|`, which had marked
   all but flat ground `-4`); and a query whose endpoint cell is blocked snaps
   to the nearest walkable cell instead of returning null. Pinned by
   `tests/test_nav_grid.py`.

Also added: **flag stations.** MoveTo walks to a deterministic point on the
flag's capture ring (`_objectiveStation`), not the mast; arriving there zeros
the MoveTo urgency so the bot holds while the point is taken. And a
**no-net-progress redeploy**: a bot that circles a pocket without closing on
its goal for 4 s is respawned onto the flag's next spawn point through
`world.spawnPlayer(advance)`, the deploy screen's own walk of the spawn list.

## Follow-up 3 (2026-09-23): the engine's map and follower replace the invented ones

Two symptoms in play — bots walking to an objective facing backwards, and
jamming behind sandbags — and one binary read behind both. The read is
`bot-movement-and-pathfinding.md` (ledger AI-26..AI-32); what it changed:

1. **`nav-grid.js` is the engine's map now.** One bit a metre (the old 64 m
   grid was a misreading of the `.raw` header, which counts 64 x 64-pixel
   blocks), the infantry `addSearchMap` parameters (water 1.5 m, slope 30 deg,
   brush 1.0 as the engine's five-pixel plus, clip 0.4..2.0 m above the
   object's base), the collision triangles clipped per cell, object tops and
   drivable decks freed, the spawn-point flood, a 4-connected boxed local A*
   with the engine's step cost and obstacle circles, the Bresenham trace, and
   a 16 m coarse level (INVENTION) for the strategic legs.
2. **`bot.js` follows the route as `BotMain` does.** Legs refined ten points
   ahead (`ai.setSmoothing 1 10`), the steering point the farthest of the next
   ten a trace reaches, points popped inside the body radius or past their
   perpendicular plane, the 31.5 deg throttle cone with no strafing, the
   150/401 stall counts, and potential obstacles planted on a stall (INVENTION
   in place of the engine's collision prediction). The probe-and-fan wall
   follower, the reverse-then-sidestep unstick and the strafing are gone.
3. **`map.html` draws bots the way it draws the local body**: no
   `SOLDIER_YAW_FLIP` (that was the backwards facing), and the pose blended
   between the last two tick boundaries by `presentAlpha` (raw 30 Hz tick
   positions under a smooth camera were the "blur").

Verification: `tests/test_nav_grid.py` (11) and `tests/test_bot_ai.py` (14)
rewritten to the new contract, both green; El Alamein with four bots in the
viewer builds the map in ~320 ms and every bot walks a route.

## Follow-up 4 (2026-09-23): the fight, re-read against the binary

The squads met in the headless El Alamein run and the first engagement was
wrong in five ways, each traced to a line of `bbfire_urg`, `08580140` or
`0847e3a0` and corrected (ledger AI-39..AI-41, `bot-behaviours.md` s3 and s5):

1. **`DecleiningSlopeCurve` was a stand-in.** `bot-fire.js` used `x / (1 +
   x)`; the engine's sampled table (`bot-behaviours.js`) gives 0.94 where the
   stand-in gave 0.39, which is why a seen enemy at 25 m lost the contest to
   MoveTo. One function now.
2. **Infantry scores only what it sees, inside range.** The memory record's
   lost byte (+0x14) skips the target for a bot on foot; `1 / (1 + 0.05 *
   age)` is the vehicle branch (and applies to lost targets, the reverse of
   the first reading). Targets beyond `maxRange` are skipped on foot. A bot no
   longer stalks a 60 s old memory across the map.
3. **Misses are tallied per target and weapon** (record +0x34 / +0x54,
   eight slots), not per weapon for life: a fresh target starts every weapon
   clean; a string of misses on one target walks the choice down to the
   pistol and then the knife — the engine's knife charge. The 0.75
   outside-area factor is a vehicle term.
4. **The fire plan is a sequence.** Its look and trigger carry `afterMove`
   and wait for the approach (`InfanteryMoveToObject`) — before, the aim
   overrode the steering every tick and the bot stood 70 m from a target its
   pistol could not reach.
5. **TakeCover needs no cover object**, and its `d` is the distance to the
   threat (2 .. 100 m), recomputed when the cover id changes or is -1; the
   standing point behind a cover is `traceValidPoint`, which is the engine's
   **first valid** cell along the line (the start when free), not the last
   valid before a block — `nav-grid.js` rewritten, the harness pins it.

`map.html` billed every bot round with the human's weapon: rate of fire
(8/s fallback when the human held nothing), projectile damage (30 fallback),
and a deviation model with no weapon channels. Each bot now loads its kit's
weapon glbs' `extras.weapon` (`botWeaponData`): its own `roundOfFire`,
`fireOnce`, magazine size / count / reload (tracked per weapon, the AI
entry's `ammo` follows it and an empty magazine ends the fire plan),
projectile damage through `damage.json` as for the human, and the weapon's
`deviation` channels rebuilt on a weapon change under the `setBotSkill` term.
`?botDebug` logs every hit; `__botCtl(id)` returns a controller.

Verification: `tests/test_nav_grid.py` (12), `tests/test_bot_ai.py` (14),
`tests/test_strategic.py` (7) green; `./scripts/verify.sh --skip-e2e` green.
Headless El Alamein, two squads teleported 40 m apart: both sides trade
kills with their kit weapons (BAR 22.5 a hit, rifles 32 / 50, SMGs 15 ..
19), a bot that loses sight of its target returns to its order within a
second, and a bot shot at from an unseen position with a quiet order goes
prone and crawls to lower ground; with a live order far from the objective
MoveTo (3.0) outranks TakeCover (at most 2.0) as the shipped weights say.

## Follow-up 5 (2026-09-23): the medic and the vehicles

The two behaviours the Infantery rows register that the viewer did not:
`Special` (`BBMedicAssist`) and `Change` (`BBChange`), plus the driving
they imply. Ledger AI-42..AI-45, `bot-behaviours.md` s6 and s8.

1. **MedicAssist** (`bot-behaviours.js MedicState`, `bot.js
   _urgencySpecial / _planSpecial`): a bot with a `weaponTemplate.healing
   1` weapon (the MedPack; the RepairPack heals armour classes only) scores
   its side's wounded — health under 95 %, upright, on foot, reachable — by
   `value / (d * SCurve(health))`, `urgency = Declein(sum) * 4 * k`, walks to
   `R + 0.9 * 2.5 m`, looks within 5 deg and holds the pack while the friend
   is under 95 % and in reach. The extractor now ships the `healing` flag
   in `aiWeapons`; the page heals 0.5 hp a trigger tick (INVENTION: the
   MedPack has no projectile, its per-round heal lives in the weapon code).
   Verified live: a medic bot walked 10 m to a friend at 10 / 30 hp, held
   the pack at 2.2 m and left him at 28.5 (95 %).
2. **Change** (`bot-vehicle.js`, `bot.js _urgencyChange / _planChange`,
   `map.html botEnterVehicle`): `calculateVehicleUrgency` per unit
   (`SCurve(health) * (fire * (w1 + 0.15) + maxSpeed * 4 * w2) + value`),
   staying on foot x1.25, `Declein(0.5 * best / staying) * 1.9 * 4`, the
   walk to the door and the seat. The page builds the bot its own
   `VehicleOccupancy` and drivetrain (adopted into the body world, driven by
   the bot's input word through the world's seated-player tick, drawn by
   `stepVehicleBodies`), gives it the Tank map (`ai.addSearchMap Tank0`,
   built on first use) and the unit's AI weapons (`extract_vehicle_ai.py`
   -> `_shared/vehicle-ai.json`: `maxSpeed`, `turnRadius`, `strType`,
   strategic strengths, the guns' ranges and strengths). Verified live: two
   bots took Willys on their own, a forced Kubelwagen drove its route at up
   to 17 m/s, a Panzer IV left its compound on the tank map.
3. **The tank law** (`bot-vehicle.js tankControl`): the throttle and steer
   arithmetic of `TankControl::controlTowardsDirection`, the 30 / 60 deg
   angle limit, arrival by the move's radius. Not read, labelled INVENTION:
   the turn-first branch (full throttle, full lock, the direction kept
   across the seam behind the hull — the viewer's tracked hull barely
   pivots on the spot), forward / reverse (`actionStatusDecision`; the
   viewer backs out for 2 s after an obstruction), the slope gain.

Not built, and said so in the docs: aircraft, boats, fixed guns, passenger
and gunner seats, voluntary bailing, the environment's class tables behind
`calculateFireStrength`.

## Completed

### 1. AI weapon data extraction (con.py) ✅
- Added `AiWeaponTemplate` dataclass with all fields from §6.2/§6.3
- Added `weaponTemplate.*` namespace parsing (deviation, deviationCorrectionTime, minRange, maxRange, burst, weaponFire, weaponActivate, setStrength, setSoundSphereRadius)
- Added `ai_weapons` dict to `ObjectLibrary` with `ai_weapon()` accessor

### 2. ControlInfo extraction (con.py) ✅
- Added `AiControlInfo` dataclass with all channel mappings from §2.4
- Added `aiTemplatePlugin.*` namespace parsing (driveTurnControl, driveThrottleControl, aimHorizontalControl, aimVerticalControl, lookHorizontalControl, lookVerticalControl, all sensitivity/scale fields, camera relative rotation)
- Added `ai_control` dict to `ObjectLibrary` with `ai_control_info()` accessor

### 3. Bot name extraction script ✅
- Created `extract_bot_names.py` — reads the five nation name lists from Game.rfa
- Outputs JSON with American, British, German, Japanese, Russian name pools

### 4. BotController (viewer/bot.js) ✅
- Created with all 55 PlayerInputMap channels
- Simple visibility test (distance-based; frustum test is AI-22 open)
- Face-the-player aiming
- Fire with deviation
- `setAIDeviation()` using the closed-form formula from §6.2

### 5. DeviationModel AI support (viewer/deviation.js) ✅
- Added `aiPending` field (the documented sixth term)
- Added `setAIDeviation()` method implementing the full formula
- `current()` now includes `aiPending` in the total

### 6. SHOW_BOT_SETTINGS enabled ✅
- Set to `true` in `menu-screen.js`
- Added `botSkill` and `botCount` to skirmish state
- `launchUrl()` now passes `?botCount=` and `?botSkill=`

---

## Remaining work

### 7. Wire bot settings UI in skirmish.js
The Instant Battle screen's bot settings column is now visible (`SHOW_BOT_SETTINGS = true`), but the sliders need to be wired to update `state.botSkill` and `state.botCount`. The layout already carries the elements; we need hit-testing and variable binding for:
- `Skirmish/SkirmishAiSkill` → botSkill (1→0.25, 2→0.5, 3→0.75, 4→1.0)
- `Options/General/SkirmishPercentageOfBots` → botCount (scale 50–400%)

### 8. Wire bot parameters through map.html level loading
`map.html` needs to:
- Read `?botCount=` and `?botSkill=` from query params
- Import `BotController` and `spawnBots` from `bot.js`
- Create bots on level load, passing spawn points from the SinglePlayer layer
- Call `bot.tick(dt, playerPos)` each frame for each bot

### 9. Extract bot names into the build pipeline
Run `extract_bot_names.py` and include the output in the viewer's data so the bot name pools are available at runtime.

---

## What the viewer already has

- `World.setInput(id, input, look, seq)` — the exact socket a bot plugs into (`viewer/world.js:591`)
- `PlayerInputMap` — all 55 channels documented (§1.2 of the research)
- `DeviationModel` (`viewer/deviation.js`) — the player-side deviation pipeline; `aiPending` is the documented sixth term that stays 0 for a player
- The soldier, weapons, vehicles, seats, spawn screen, scoreboard and minimap
- The Instant Battle menu (`skirmish.js`, `menu-screen.js`) with `SHOW_BOT_SETTINGS = true` — now visible

---

## Stage 1 scope

A bot that:
1. Spawns on a spawn point with a kit
2. Faces the player when the player is in front of it
3. Fires with the engine's own deviation formula
4. Respects the difficulty slider (botSkill)

Out of scope: navigation, pathfinding, vehicles, strategic AI, urgency contest, plans.

---

## Work streams

### 1. Extract AI weapon data

**File**: `bf42/con.py`

The extractor already parses `Objects.con` but does not emit AI weapon template fields. The research document (§6.2, §6.3) identifies these fields as missing:

- `weaponTemplate.deviation` (default 5.0)
- `weaponTemplate.deviationCorrectionTime` (default 10.0)
- `weaponTemplate.minRange`
- `weaponTemplate.maxRange`
- `weaponTemplate.burst`
- `weaponTemplate.weaponFire` (PlayerInputMap channel name)
- `weaponTemplate.weaponActivate` (PlayerInputMap channel name)
- `weaponTemplate.setStrength` (per vehicle type)

**Action**: Add parsing for `Ai/Weapons.con` files alongside the existing weapon extraction. The files sit at `<object>/Ai/Weapons.con` inside `Objects.rfa` — same archive, same reader, different path.

**Output**: Each weapon record gains an `ai` block when AI data exists:
```json
"ai": {
  "deviation": 5.0,
  "deviationCorrectionTime": 10.0,
  "minRange": 0.0,
  "maxRange": 200.0,
  "weaponFire": "PIFire",
  "weaponActivate": "PIMenuSelect3",
  "strength": { "Infantry": 4.0, "Air": 1.0 }
}
```

### 2. Extract `ControlInfo` channel mappings

**File**: `bf42/con.py`

Every drivable object's `Ai/Objects.con` carries an `aiTemplatePlugIn.create ControlInfo` block that maps AI intents to `PI*` channels (§2.4). The viewer needs this to translate "bot wants to turn left" into "write -0.4 into channel 0".

**Action**: Parse `aiTemplatePlugIn` blocks from `<object>/Ai/Objects.con`:
- `driveTurnControl`, `driveThrottleControl`, `aimHorizontalControl`, `aimVerticalControl`
- `lookHorizontalControl`, `lookVerticalControl`
- Sensitivity scalings (`throttleSensitivity`, `yawSensitivity`, etc.)
- Scale factors (`throttleScale`, `pitchScale`, etc.)

**Output**: Each vehicle/soldier template gains a `controlInfo` block:
```json
"controlInfo": {
  "driveTurnControl": "PIYaw",
  "driveThrottleControl": "PIThrottle",
  "aimHorizontalControl": "PIMouseLookX",
  "aimVerticalControl": "PIMouseLookY",
  "throttleSensitivity": -1.0,
  "yawSensitivity": -2.5,
  "throttleScale": 1.0
}
```

### 3. Create `bot.js`

**New file**: `viewer/bot.js`

The core module. A bot is an ordinary player whose `PlayerInput` the engine writes for it (AI-1). The viewer already has the `PlayerInput` infrastructure.

**Responsibilities**:
- Own a `PlayerInput` (55-float array, same as `BotMain+0x04`)
- Simple sensing: "can I see the player?" — distance check + optional frustum gate
- Face the player: compute yaw/pitch toward player position, write into `PIMouseLookX/Y` via `ControlInfo` mapping
- Fire when player is in crosshair: write `PIFire` = 1
- Apply deviation: call into `DeviationModel` with the bot's weapon AI data and `botSkill`

**Interface**:
```js
export class BotController {
  constructor({ playerId, world, botSkill = 0.75, controlInfo, weaponAi }) { ... }
  
  /** Once per tick. Writes into the player's input buffer. */
  tick(dt) { ... }
  
  /** Simple visibility test: distance + line-of-sight approximation. */
  canSee(target) { ... }
  
  /** Compute aim direction toward target, apply deviation. */
  aimAt(targetPosition) { ... }
}
```

### 4. Wire `botSkill` into deviation

**File**: `viewer/deviation.js`

The research document (§6.2) gives the closed-form deviation formula:

```
dev = (1 - 0.75*A) * C + F30 * (F38 * max(0, F34*(1-A) - (now - B)) + 0.25*(1-A))
```

Where:
- `A` = botSkill (0.25–1.0)
- `C` = anti-aircraft penalty (0 for ground-vs-ground)
- `F30` = deviation (default 5.0)
- `F34` = deviationCorrectionTime (default 10.0)
- `F38` = 1/deviationCorrectionTime (0.1)

**Action**: Add `setAIDeviation(botSkill, timeSinceTargetAcquired)` to `DeviationModel`. This feeds the documented `aiPending` term — the sixth term in `current()` that "stays 0 for a player."

### 5. Enable `SHOW_BOT_SETTINGS` and wire difficulty

**File**: `viewer/play/menu-screen.js`

Set `SHOW_BOT_SETTINGS = true`. The layout already carries all the elements; they are just hidden.

**File**: `viewer/play/skirmish.js`

Wire the difficulty sliders to actual values:
- `SkirmishAiSkill` 1–4 → botSkill 0.25/0.5/0.75/1.0 (§5.2 table)
- Pass botSkill through the launch URL as `?botSkill=`

**Note**: The research document (§5.3) proves the retail skirmish AI SKILL slider is inert in 1.61. Wiring it is a **deliberate departure** and must be labelled as such.

### 6. Bot spawning

**File**: `viewer/world.js` (or a new `viewer/bot-spawner.js`)

Bots spawn through the existing spawn point system. The research (§2.1) shows:
- Bot names come from `Bf1942/Game/common/*Names.con` in `Game.rfa`
- Spawn points are the existing `SinglePlayer/SoldierSpawns.con`
- Kit selection uses `BotSpawner::findSuitableSpawnGroup` and `BotSpawner::findKitDiff` (§2.3)

**Stage 1 simplification**: Skip the weighted kit selection. Spawn bots on the first available soldier spawn point with the first kit. The kit weights from `Objects/Items/BaseKit/Ai/Objects.con` can be added in Stage 2.

**Action**:
- Extract bot name lists from `Game.rfa`
- On game start, create N bot players (configurable via `?botCount=`)
- Assign each a spawn point from the `SinglePlayer` layer
- Create a `BotController` for each

### 7. Pass bot parameters through launch URL

**File**: `viewer/play/skirmish.js` → `launchUrl()`
**File**: `viewer/map.html` → query param handling

Add query parameters:
- `?botSkill=0.75` (default 0.75 — the engine's own default)
- `?botCount=4` (default 0 — off by default, opt-in)

---

## File changes

| File | Change |
|---|---|
| `bf42/con.py` | Parse `Ai/Weapons.con` and `Ai/Objects.con` (ControlInfo) |
| `viewer/bot.js` | **NEW** — BotController class |
| `viewer/deviation.js` | Add `setAIDeviation()` method |
| `viewer/play/menu-screen.js` | Set `SHOW_BOT_SETTINGS = true` |
| `viewer/play/skirmish.js` | Wire difficulty sliders, pass `?botSkill=` and `?botCount=` |
| `viewer/map.html` | Read bot params, create BotControllers |
| `tools/bf1942-models/extract_bot_names.py` | **NEW** — extract name lists from Game.rfa |

---

## Stage 2 and beyond (not in this PR)

- **Stage 2**: Navigation via `Pathfinding/*.raw` or generated grid, patrol between control points, take cover, change weapon
- **Stage 3**: Urgency contest, plans, strategic layer (SAI)

---

## Testing

1. Launch `play/index.html`, enable bot settings, set difficulty to HARD, start a game
2. Verify bots spawn and face the player
3. Verify bots fire when player is in view
4. Verify deviation changes with difficulty (EASY = wide spread, IMPOSSIBLE = tight)
5. Verify `World.setInput` receives bot inputs correctly

---

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| Sensing model not researched (AI-22) | Use simple distance + LOS approximation; label as invention |
| `Pathfinding/*.raw` format not decoded (AI-13) | Defer to Stage 2; Stage 1 bots don't navigate |
| Retail AI SKILL slider is inert (§5.3) | Label the wiring as a deliberate departure |
| Kit selection weights not implemented | Use first kit; add weights in Stage 2 |
