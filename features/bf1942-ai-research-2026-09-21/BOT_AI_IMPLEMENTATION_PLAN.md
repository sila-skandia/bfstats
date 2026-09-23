# Bot AI implementation plan (agent-prompt.md)

**Source spec**: `features/bf1942-ai-research-2026-09-21/agent-prompt.md`
**Research**: `README.md` (§1.2, §1.3, §4.1–4.2, §6.1–6.2), `ai-22-sensing-decoded.md`, `pathfinding-raw-format.md`
**Target files**: `tools/bf1942-models/viewer/bot.js`, `world.js` (`addBotPlayer` only), `map.html` (bot call sites only)

---

## 0. Actual current state (the prompt's "broken" list is stale)

The working tree already contains a partial implementation from commit `37b0ff3f`
plus uncommitted edits. Verified by reading the code:

| Prompt claim | Reality |
|---|---|
| bots have no Soldier | **fixed, uncommitted**: `world.js:381` `addBotPlayer()` now builds a `Soldier` and calls `spawnPlayer()` (`world.js:409`) |
| `sense()` filters same-team so sees nothing | **already handled**: `bot.js:397` special-cases `id === 'local'` and targets the human regardless of team |
| `tick()` is a toy contest that always lands Idle | **already a real contest** (`bot.js:588`), though it is priority-rule, not the engine's scalar weighted contest |
| spawns on neutral/uncapped flags | `spawnBots()` filters `f.team === team` (`bot.js:1042`) ✅ |

`bot.js` and `nav-grid.js` are **untracked** even though committed `map.html:1031`
imports them. This must be fixed as part of shipping (stage `bot.js` + `nav-grid.js`).

### The real blockers (found by tracing the input contract)

`world.setInput(playerId, input, look, seq)` (`world.js:630`) has two distinct
sockets. `look` is the per-tick mouse axis pair; the `input` object only accepts
the named action word shaped by `shapeInput` (`world.js:132`).

1. **Bots never turn.** `BotController.tick()` calls
   `this.world.setInput(this.playerId, this._inputToObject())` (`bot.js:567`) with
   **no third `look` argument**, and `_execInfantryMoveTo` writes absolute radians
   into `PI.MouseLookX` (`bot.js:810`). `shapeInput` does not read `MouseLookX/Y`
   at all. Every yaw write is discarded. This is why bots stand still.
2. **Channel name/shape mismatches.** `_inputToObject` (`bot.js:988`) emits `lie`
   (`shapeInput` wants `prone`, `world.js:147`), `run` (not a channel), and
   `strafe: input[PI.Yaw]` (`bot.js:994`) which nothing ever sets.
3. **Fire goes nowhere.** `footFire` is local-only (`map.html:9460`,
   `map.html:11992`); `world.setPlayerArmor` is only ever called for
   `LOCAL_PLAYER` (`map.html:9000`). A bot setting `fire: true` produces no shot.
   This is the single biggest scope decision in the prompt — see §5.
4. **map.html still duplicates spawn logic.** `spawnBotsForLevel` re-filters
   flags and calls `bot.setPosition(...)` (`map.html:8974–8986`) after
   `spawnBots` already did both. Prompt constraint: remove it.
5. **Cadence.** `tickBots(dt)` runs once per render frame after `world.step`
   (`map.html:15760`); `world.step` may run several fixed 30 Hz ticks. Bots reuse
   one input for all of them. The engine runs AI *first* in the tick (README
   §1.3), so writing before the step is the faithful order.

---

## 1. Input contract — the fix that makes bots move (highest priority)

Everything else is inert until this works. Replace the two output paths with one
writer that mirrors what the page does for the human (`map.html:15716–15748`).

### 1a. Single input writer

```js
// bot.js — replaces _inputToObject() and the bare setInput call
_writeInput() {
  const input = {
    forward: clamp11(this.moveForward),   // -1..1, c_PIThrottle
    strafe:  clamp11(this.moveStrafe),    // -1..1, c_PIYaw (D/A strafe)
    walk:  this.stanceInput === 'walk',
    crouch: this.stanceInput === 'crouch',
    prone: this.stanceInput === 'prone',
    jump:  this.jumpRequest === true,
    fire:  this.isFiring,
    altFire: false,
  };
  const look = { x: this.lookX, y: this.lookY };  // mouse counts, ±16
  this.world.setInput(this.playerId, input, look);
  this.jumpRequest = false;
}
```

`lookX/lookY` are **mouse counts**, not radians. The world converts with
`soldierLookDegrees` (`mouse-input.js:579`): `yawDeg = x * 3.0`,
`pitchDeg = y * 1.0`, then `soldier.look(-yawDeg°, -pitchDeg°)` (`world.js:802`).
The axis saturates at `AXIS_RANGE = 16` (`mouse-input.js:78`). So the aim helper:

```js
const YAW_GAIN = 3.0, PITCH_GAIN = 1.0, AXIS_MAX = 16;
const RAD2DEG = 180 / Math.PI;

_aimLook(desiredYaw, desiredPitch = 0) {
  const s = this.world.player(this.playerId)?.soldier;
  if (!s) return;
  let dYaw = desiredYaw - s.yaw;                     // world yaw, radians
  dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw)); // wrap to [-π, π]
  const dPitch = desiredPitch - (s.pitch ?? 0);
  // World applies look as a NEGATED rotation; negate back.
  this.lookX = clamp(-(dYaw * RAD2DEG) / YAW_GAIN, -AXIS_MAX, AXIS_MAX);
  this.lookY = clamp(-(dPitch * RAD2DEG) / PITCH_GAIN, -AXIS_MAX, AXIS_MAX);
}
```

Note `soldier.body.yaw` is `soldier.yaw`; `soldier.pitch` already includes the
engine's ±38° clamp (`soldier.js:632`). One tick can turn up to 48°, so aim
converges in a few ticks — no smoothing needed for Stage 1, but a skill-scaled
turn rate (`soldierLookDegrees`' `turnFactor`) is the faithful lever if desired.

### 1b. Movement

The soldier moves along its **current facing** (`soldier.js:663`, `step` uses
`forward` with the body's yaw). So: aim at the waypoint with `_aimLook`, then set
`moveForward = 1`. Optional body-frame strafing:

```js
const dx = wp.x - s.x, dz = wp.z - s.z;
const rel = Math.atan2(dx, dz) - s.yaw;       // bearing in body frame
this.moveForward = Math.cos(rel) > 0 ? 1 : 0.5;
this.moveStrafe = Math.sin(rel) * 0.5;
```

`walk` (slower gait) is for TakeCover; default is run.

### 1c. Trigger alignment relative to current facing

`_execTrigger` (`bot.js:848`) compares `faceTarget(...)` **absolute** yaw against
a tolerance. Fix to compare against the soldier's live yaw/pitch:

```js
const want = faceTarget(this.position, targetPos);
const s = this.world.player(this.playerId)?.soldier;
const dy = wrap(want.yaw - s.yaw), dp = want.pitch - s.pitch;
if (Math.hypot(dy, dp) < CROSSHAIR_TOLERANCE) { this.isFiring = true; ... }
```

---

## 2. `sense()` — align with `ai-22-sensing-decoded.md` (prompt item 2)

Keep the structure (brute-force candidates → frustum → LOS → closest), which is
the labelled INVENTED stand-in for the `AIInformationGrid` (§4.3 of the sensing
doc: 32×32 hash, `getInformationWithinFrustum`).

Faithful, already present:
- Frustum half-FOV 53.1° infantry / 112.6° mobile, near 0.8 m, far = viewDist
  (`bot.js:85`).
- Closest-visible-first target selection (`bot.js:425`, README §5.4).
- Memory refresh and expiry (`bot.js:440`, `bot.js:451`).

To tighten:
- Fix the candidate loop building `botPlayer` inside the loop and re-reading the
  same map; hoist it (`bot.js:396`).
- Require `player.team != null` means a teamless vehicle entity is skipped; fine
  for local/bots.
- Hearing: `hearSound` radius 15 m / 0.5 s window is right (`bot.js:475`);
  the page only feeds `recordNearbyShot` from the human (`map.html:9009`) — add a
  symmetric call when **bot** shots exist (blocked on §5).

Label everything invented in the header (already done at `bot.js:13–22`).

---

## 3. Urgency contest — engine's scalar contest (prompt item 3)

Replace the priority chain in `_runUrgencyContest` (`bot.js:588`) with the
documented contest (README §4.1):

```
urgency(behaviour) = urgencyGenerator(bot) * weight[behaviour] * curve(distance)
winner = argmax; Idle urgency is floored so it is NEVER 0
```

Constants to add:

```js
const URGENCY_CURVE = {
  union: () => 1.0,
  fire:  d => Math.max(0, -0.22 * d + 1.3),   // UCFire: linear
  scout: d => {                                // UCScout: XInverse 2.5,0.9,1.0,0.5
    const [k, o, s, base] = [2.5, 0.9, 1.0, 0.5];
    return base + k / (o + s * d);
  },
};
const STANDARD_WEIGHTS = {
  Fire: 7.5, TakeCover: 2.0, Change: 1.9, MoveTo: 1.5, Idle: 0.1,
};
const IDLE_FLOOR = 1e-3;   // README §4.1 crash warning
```

Generators per behaviour (Stage-1 fidelity):
- **Fire**: `hasVisibleTarget || hasRecentMemory`, distance = to target.
- **TakeCover**: `isUnderFire` (nearby shot within 1.5 s, 20 m), distance to threat.
- **Scout**: no target and no memory for N s; distance = 0 → high curve near 0.
- **MoveTo**: has objective/waypoint (nearest enemy-capped-or-contested flag), distance.
- **Idle**: constant.
- **Avoid**: keep out of Stage 1 (collision avoidance is `body-contact` territory).

Winner drives `_generatePlan` (`bot.js:616`). The `Change`/`Special` behaviours
have no Stage-1 plan; omit them rather than stub incorrectly.

---

## 4. Plan interpreter (prompt item 4)

The plan/action scaffolding already matches the 13-instruction infantry set
(`bot.js:129`, executors `bot.js:754`). Repairs needed:

| instruction | current problem | fix |
|---|---|---|
| `InfanterMoveTo` | writes absolute radians to `PI.MouseLookX`, sets dead channels | call `_aimLook(wp)` + set `moveForward/moveStrafe` |
| `MouseTurretAimAt` | same | `_aimLook(target)` each tick |
| `Trigger` | absolute-yaw tolerance; raises `onShot` every tick | relative alignment (§1c); call `deviation.onShot()` only on the fire edge |
| `InfanterResetControls` | clears input keys directly | clear `moveForward/moveStrafe/stanceInput/isFiring/look` |
| `SoldierPose` | no-op | map `{stand, crouch, prone, walk}` to `stanceInput` |
| `Sense` | no-op | re-run `sense()` immediately |
| `MoveToDirection`, `MoveToObject`, `InfoWrapper`, medium variants | not implemented | one-line delegations to `InfanterMoveTo`/`MouseTurretAimAt` or explicit complete |

Plan lifetime: regenerate when the winner changes or the plan is exhausted,
as today (`bot.js:532`), but also when `hasChangedTarget` fires (engine
`BotBehaviour::hasChangedTarget`, README §4.1).

---

## 5. Bot firing — parity route (real weapons)

**Guiding decision: parity with the game. There is no visual-only fire in
BF1942 — a bot's `PIFire` runs through the same item/weapon pipeline as a
human's, so bots must fire real rounds.** The engine has no separate bot
projectile path (README §1.3: bots go through `simulatePlayersUpdate` like
everyone else).

Current gap: `Trigger` + deviation exist in `bot.js`, but the consumer is
local-only. `footFire(dt, frameInputLast)` (`map.html:11992`) is driven by
`soldierArmor`, and `world.setPlayerArmor` is only called for `LOCAL_PLAYER`
(`map.html:9000`). A bot's `fire` channel is read by `soldier.step` as a latch
with no weapon attached, so it produces nothing.

Parity work:

1. Give every bot an `Armor` from its kit (same construction the page uses for
   `soldierArmor`, `map.html:9000`) via `world.setPlayerArmor(playerId, armor)`.
   Kit choice should eventually follow `BotSpawner::findKitDiff` weights
   (README §2.3); Stage 1 can use the first kit.
2. Refactor the local fire path into a per-player
   `firePlayerWeapon(playerId, dt, input)` that both `LOCAL_PLAYER` and each bot
   call. This is the parity-faithful change: one weapon path, everyone on it.
3. Feed bot `fire:true` through it, with the deviation cone from
   `bot.js._computeAIDeviation()` already applied to the aim. Hit registration
   then falls out of the existing weapon/ballistics code for free, including
   damage on the local player.

**File-constraint conflict to note:** the agent-prompt says all changes must be
in `bot.js` plus `spawnBots`. Parity cannot be reached that way — it needs
`map.html` (armor + call site) and likely `gunfire.js`/`armor.js` integration.
The prompt's constraint yields to the stated guiding principle; record the
departure.

---

## 6. Spawning + map.html cleanup (prompt items 1, 5, 6)

- `world.addBotPlayer()` already gives bots a Soldier and spawns them via
  `spawnPlayer` — **keep the uncommitted diff**. It is the only sanctioned
  `world.js` change.
- **Teams. DONE — and the Stage 1 accommodation is gone.** Parity is bots on
  **both** sides (`GameServer::gameStatusPlaying` tops up to `getMaxNBots`
  across sides, README §2.1–2.2), each spawning on its own team-capped flags.
  `spawnBotsForLevel` now passes `{ teams: [friendly, enemy] }` and `sense()`
  runs a plain enemy-team filter with no local-player hole.

  Stage 1 had every bot on the player's side and exempted `'local'` from the
  friendly test so the AI had something to shoot. The effect in play was that
  the player's own squad opened up on him the instant he spawned and killed him
  in about a second. The same hole was in `map.html`'s `resolveBotShot`, and
  worse: `botFireTick` billed **every** bot hit to the local player, whoever the
  round actually found. Both are closed; a teammate is never sensed, never fired
  on, and never resolves a round.
- `spawnBots()` already filters team-capped flags (`bot.js:1042`) and passes
  `{ team, flag, spawnIndex }`. Audit the early return `if (!teamFlags.length)
  return bots;` so a team with only neutral flags still degrades gracefully.
- **Remove from `map.html`** (`spawnBotsForLevel`): the duplicate
  `world.flags.filter(...)`, the `teamFlags` fallback push, and the
  `bot.setPosition(...)` block (`map.html:8973–8986`). Keep only
  `bot.navGrid = botNavGrid` and `ensureBotVisual(bot)`.
- `tick()` already syncs position/yaw from `player.soldier`
  (`bot.js:500–506`) — verify it stays authoritative and that
  `updateBotVisuals` reads `bot.getPosition()`/`bot.yaw` (it does,
  `map.html:9154–9161`).
- Build the nav grid once per level (`map.html:8955`) — fine; mark the generated
  grid as the labelled stand-in for the server's `Pathfinding/*.raw`
  (`pathfinding-raw-format.md` decoder exists at
  `tools/bf1942-models/decode_pathfinding_raw.py`, so a real `.raw` load is a
  Stage-2 upgrade).

---

## 7. Cadence / tick-order note

The engine writes bot input **before** `simulatePlayersUpdate` (README §1.3).
The page calls `tickBots(dt)` **after** `world.step(dt)` (`map.html:15760`), so
the input applies to the next step — a one-tick lag, and multi-tick frames reuse
stale input. Acceptable, but state it. If we want engine order, move `tickBots`
before `world.step`; the cost is bots then read the previous tick's soldier pose.
Recommend leaving as-is for Stage 1 and documenting.

---

## 8. Task list

1. [ ] Add the single `_writeInput()` + `_aimLook()` writer; delete
       `_inputToObject()` and the bare `setInput` call. `node --check bot.js`.
2. [ ] Point every movement/aim executor at the new writer (§4 table).
3. [ ] Fix trigger alignment to be relative to live facing; fire-edge `onShot`.
4. [ ] Replace priority rules with the scalar weighted contest + curves.
5. [ ] Implement `SoldierPose`, `Sense`, and the medium/direction delegates.
6. [x] Remove duplicate spawn/position code from `map.html`; `spawnBots` takes
       `{ teams }` and the page spawns both sides. No local-player exemption
       anywhere — see §6.
7. [x] Wire bot armor + a shared `firePlayerWeapon(playerId, dt, input)` so bots
       fire real rounds (parity, §5); record the file-constraint departure.
       Landed as the documented hitscan departure in both directions: bot
       rounds resolve in `resolveBotShot`, the player's in
       `resolvePlayerShotOnBots` (firearms only — a melee swing and a thrown
       charge carry no projectile down the view axis). A downed bot hides,
       stops firing, and its side puts it back on a flag after
       `BOT_RESPAWN_DELAY`.
8. [ ] `node --check bot.js nav-grid.js`; then run the viewer
       (`play/index.html` → Instant Battle, botCount>0) and confirm: bots move,
       turn to face the human, advance toward flags, cap them, and stand on
       team-capped flags only.
9. [ ] Stage `bot.js` and `nav-grid.js` (currently untracked, but imported by
       committed code).
10. [ ] Update `IMPLEMENTATION_PLAN.md` status and record departures/inventions.

## 9. Verification

- Static: `node --check tools/bf1942-models/viewer/bot.js`
  and `.../nav-grid.js`.
- Headless: the `tools/bf1942-models/tests/` harness pattern (e.g.
  `world_ship_pitch_harness.mjs`) can import `world.js` + `bot.js` and assert a
  bot's yaw delta after one `tick()` with a known target; add
  `tools/bf1942-models/tests/bot_ai_harness.mjs`.
- Interactive: launch the viewer with `?botCount=4&botSkill=0.75`, watch bots
  leave spawn and move to objectives. This viewer is not covered by
  `./scripts/verify.sh` (that is the bfstats API/UI), so E2E is manual.

## 10. Inventions to label (research open)

- `AIInformationGrid` spatial hash → brute-force candidate scan.
- `World::rayCast` LOS → `checkLOS` height approximation (`bot.js:223`).
- Hearing via external `recordNearbyShot` rather than the armament path.
- Nav grid generated client-side, not the server's `.raw` search maps.
- Kit selection is the first kit until `findKitDiff` weights are wired
  (README §2.3).