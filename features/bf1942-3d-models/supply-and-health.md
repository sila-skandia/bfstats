# Supply depots and the soldier's hit points

Track P3, round 2 (see the round briefing, `BRIEFING2.md` §P3). The user's ask:
"being able to stand next to an ammo box or medical hut to receive ammo / HP."
Wake's 52 `SupplyDepot` nodes now heal and rearm the on-foot soldier at the
engine's own radius, team rule and rates, and the soldier has real hit points
that a fall (or `window.__damage(n)`, for tests) can take away.

Every rule below cites the claim id it came from in
`verify-r3.md` (`SUP-n`, supply depots) or `verify-r4.md` (`R4-n`, hit points
and damage) — both files' `## Corrected report` section, the verifier's word
over the researcher's where they disagree. Nothing here is invented except
where a section below says so explicitly.

## Files

| File | Role |
|---|---|
| `viewer/armor.js` | The generic hit-point model (`Armor` class): clamp, death threshold, and the signed `applyDamage` a fall or a heal both go through. Framework-free — no three.js, no DOM. |
| `viewer/supply.js` | `SupplyDepot` (one instance's eligibility + leaky-bucket + dispatch) and `SupplyField` (a level's whole set, ticked and queried together). Also framework-free. |
| `viewer/map.html` | The only place that (a) walks the loaded scene graph for `SupplyDepot` nodes and resolves their world position, (b) owns the on-foot soldier's `Armor` instance and its lifecycle (spawn = full HP), (c) implements the fall-damage approximation, and (d) publishes `Soldier/SoldierHitPoints`, `Soldier/SoldierMaxHitPoints`, `ShowHealIcon`, `ShowReloadIcon` into the HUD variable bridge. |
| `tests/test_armor.py`, `tests/armor_harness.mjs` | 10 node-driven tests: clamp/death/sign-dispatch, exercised the same way `test_effects.py` runs `effects-core.js`. |
| `tests/test_supply.py`, `tests/supply_harness.mjs` | 10 node-driven tests against Wake's own depot archetypes (Ammobox, mediclocker, the M3A1's hybrid depot), transcribed verbatim from `scene.glb`'s extras. |

## The hit-point model (`armor.js`)

- `DEATH_EPSILON = 0.001` (R4-2/R4-7): the death threshold is a pending value
  `<= 0.001`, snapped to exactly `0`, not "close to zero."
- `MAX_HITPOINTS_CEILING = 128` (R4-5): `setMaxHitPoints` never raises past
  this. No vanilla soldier (30 HP) reaches it; kept because it is the
  engine's own rule.
- `damage(amount)` / `heal(amount)` (R4-3/R4-4): no-op once destroyed (this
  file never sets `canBeRepairedAndDestroyed`, matching a vanilla soldier's
  own template — death is final); `heal` clamps at the current max.
- `applyDamage(amount)` (R4-19, **corrected this round** from the prior
  reading of "parent gets healed, root gets damaged" — the verifier found it
  is a single find-nearest-Armor-then-dispatch-by-sign function): `amount >
  0` damages, `amount <= 0` heals by `-amount`, both on the same Armor. This
  is the entry point a fall, and `window.__damage(n)`, both call.

A soldier's own max HP comes from `_shared/loadouts.json`'s `maxHitpoints`
for the deploy screen's chosen kit (30 for every vanilla-family kit, R4-25),
falling back to `SOLDIER_MAX_HP_FALLBACK = 30` for a maps tree extracted
before that field existed. `soldierArmor` resets to a fresh, full `Armor` on
every spawn/redeploy (`spawnAtFlag`, the one reset point) and drops to `null`
the instant the soldier leaves on-foot mode (a stale number would otherwise
flash on the next spawn's first frame).

## Fall damage — a viewer approximation (R4-18 is open)

Two independent passes (research and verify) read `Armor`'s own code,
`SimpleObject::handleCollision` and `SimpleObject::handleDamage` in full and
found **no height/speed-to-damage formula anywhere** — R4-18 stands open in
`verify-r4.md`. This viewer therefore approximates:

```
SAFE_FALL_SPEED   = JUMP_SPEED * 2   ≈ 10.8 m/s  (~4 m of drop)
LETHAL_FALL_SPEED = 25 m/s                        (~21 m of drop)
```

Both thresholds are converted once to the heights that produce them
(`v^2 = 2|g|h`; a soldier's drag is inert enough over any survivable drop —
`physics.js`'s own terminal-velocity note, ~730 m/s — that this inversion is
exact to the precision this ramp needs). `onFoot()` tracks the highest `y`
seen while airborne (a jump's own apex, when it was a jump) and, the instant
`soldier.grounded` reports true again, ramps `0..1` linearly between
`SAFE_FALL_HEIGHT` and `LETHAL_FALL_HEIGHT` against the actual drop and
applies `ramp * maxHitPoints` as damage — ordinary traversal costs nothing, a
hard fall is progressively worse, and anything past `LETHAL_FALL_SPEED` is a
kill. **Open question this approximation stands on: R4-18** — replace this
ramp outright if the real formula ever surfaces (the same two leads it was
last seen from: `ResponsePhysics::addFriction` `0x0825b6e0`,
`PhysicsNode::updatePhysics` `0x082543d0`).

Tracked as a height rather than a sampled velocity on the adversarial
reviewer's pass over this round: `SoldierBody#settle()` zeroes `velocity.y`
in the very same `step()` call that flips `grounded` true (it has to, to
plant the body on the floor), so a peak read from `soldier.velocityY`
*after* `step()` returns always misses the last partial tick's own
acceleration — this was the round's own first cut, and it under-reported a
12 m drop's damage by about 5% against the closed-form prediction (see
Known issues). A landed body's `y` is the ground height exactly, never a
clamped derivative of it, so the height the body actually fell is exact at
any tick rate.

`window.__damage(n)` (the round briefing's own ask) goes through the same
`applyDamage` sign dispatch, so a test can move HP without waiting on a
scripted fall.

## Supply depots (`supply.js`)

- **Cadence** (SUP-11/12): a depot only re-evaluates every `UPDATE_INTERVAL =
  0.5` real seconds — the actual elapsed time since its own last check, not
  the render frame rate — and no shipped Wake template overrides the
  default. Ticking a depot every frame is therefore cheap: 51 of every 52
  calls in a typical frame return a shared, frozen `NO_EFFECT` with no
  allocation (see Performance, below).
- **Eligibility** (SUP-15/16/33): team match against *the instance's own
  cached team* (`0` = both/neutral, `1` = Axis, `2` = Allied) OR a `0`
  reads as neutral either direction, plus an inclusive 3-D distance `<=
  radius` — not a flat 2-D check (a vertical offset counts).
- **Ammo — a leaky bucket** (SUP-21): each ammo-type slot has its own
  countdown; once it goes negative, whole units become available at `rate`
  per second and the countdown carries the fractional remainder forward.
  Wake's ammo types are `id`/`rate` pairs only — `amount` (reserve) is
  unlimited (`-1`) on every Wake depot, so the reserve/regen-clamp half of
  the engine's own model is out of scope here (SUP-10/25 are also
  downgraded — the finite-budget arithmetic was not fully re-derived, and is
  moot for shipped content).
- **Ammo dispatch is an approximation** (SUP-8/22/23, all downgraded or
  refuted in the verifier's pass): `addAmmoType`'s id is an opaque
  `FireArmsTemplate+0x238` tag with no mapping to a specific held weapon
  visible to this viewer, and `FireArms::reloadAmmo`'s real per-magazine
  mechanics (magazine 0 excluded from top-up, overflow cascades between
  magazines) are far more complex than "give one magazine." Rather than
  model that, a depot's ammo branch firing tops the held weapon off
  entirely — full magazine, `magazine.magazines - 1` spares, matching what a
  fresh spawn equips with. **Open question this approximation stands on:
  SUP-23** — this is `verify-r3.md`'s own "Viewer recipe" point 3, not a new
  guess.
- **Heal** (SUP-19/25/26): the unlimited-budget branch (`healBudget === -1`,
  the only one any Wake depot's data reaches) applies `rate * elapsed`
  every cycle; `applyDamage`'s sign convention is the *inverse* of the
  depot's own rate (a positive rate heals, a negative one — an FH-style trap
  no Wake depot ships — damages).
- **Ammo beats heal on a shared cycle** (SUP-18/19): a depot with both
  capabilities (Wake's `M3A1SupplyDepot`) only reaches the heal branch on a
  cycle none of its ammo types fired — at 15 units/s against a 0.5s check,
  that is close to never. This is the engine's own dispatch order, proven in
  `test_ammo_before_heal_priority_starves_m3a1s_heal`, not a bug.
- **Vehicle repair/rearm is out of scope this round**: `eligibleForSoldier`
  and `tick` both gate on `workOnSoldiers`, so Wake's four `workOnVehicles`
  depots (`AmmoboxVehicleSupplyDepot`, `M3A1VehicleSupplyDepot`,
  `ShokakuAirplaneSupplyDepot`, `AlliedAirplaneSupplyDepot`) simply never
  fire here — vehicle Armor and entry belong to P2/P4.

### HUD icons are continuous, not throttled

`SupplyField.canHeal`/`canRearm` (SUP-33/34) share the same team/distance
gates as the give/heal action but are checked every frame, matching the
engine's own `showHealIconInMenu`/`showAmmoIconInMenu` predicates —
independent of the depot's own 0.5s action cadence. `canHeal` gates on
`healRate > 0` (would actually help) rather than `healEnabled` (`rate != 0`)
alone; whether the real icon also excludes a damage-sign depot is not
settled by `verify-r3.md` (SUP-34's full body was never traced) — no Wake
depot has a negative rate, so this choice is inert on Wake and only matters
for a mod.

## Wiring it to one soldier (`map.html`)

- `collectSupplyDepots(root)`: walks `currentRoot` once per level load (a map
  switch hands it a new object, caught by reference in `onFoot`) for every
  node whose extras carry `templateKind === 'SupplyDepot'`, resolving world
  position through the scene graph — a depot is usually parented under a
  `Bundle` and does not carry its own world translation.
- `supplyTarget`: one reused `{x,y,z,team,armor,refillAmmo}` object, updated
  in place every `onFoot` call rather than reallocated (`features/mesh-viewer-performance/README.md` rule 5).
  `refillAmmo` closes over `handWeapon`, so it always acts on whatever is
  currently in hand.
- `hudBridge = { vars: {} }`: this worktree was cut before P1's `hud.js`
  existed, so per the round briefing this file builds the same surface
  itself (`hud.vars['Engine/Var'] = x`) under the name `hudBridge` (`hud`
  already names the on-screen hint line). Written here:
  `Soldier/SoldierHitPoints`, `Soldier/SoldierMaxHitPoints` (both confirmed
  against the retail HUD dump — `BfVariablePictureFillNode2`'s own
  `Variable`/`Maximum value` fields on the soldier health-bar node, not
  merely the round briefing's example), and `ShowHealIcon`/`ShowReloadIcon`
  (confirmed directly in `hud-layout.json`'s `supplyIcon` group). When P1's
  real painter lands, point it at (or merge it with) this object — the keys
  are the engine's own variable names either way.
- `window.__damage(n)`, `window.__supply()`: the round's own test hooks.
- `window.__dropFromHeight(extraHeight)` and `window.__setAmmo(rounds,
  mags)`: two small, verification-only hooks added so a headless check can
  exercise the *real* fall-damage and ammo-refill code paths rather than
  only the isolated `armor.js`/`supply.js` unit tests. Neither is reachable
  outside `?shots` mode. `__teleport` cannot stand in for either: `Soldier.spawn`
  always ends in `settle()`, which raycasts down and places the body back on
  the ground with zero velocity, and there is no way to reach a specific
  low-ammo state without either a scripted burst (confounded — see Known
  issues) or a direct setter.

## Performance

`SupplyField.tick` runs from `onFoot`, every frame, over all 52 depots. Each
depot's own common case (`_elapsed < 0.5`) returns a shared, `Object.freeze`d
`NO_EFFECT`, and a depot that actually fires allocates one small result
object at most twice a second — far below the threshold the
mesh-viewer-performance pass was concerned with (shot/particle-rate
allocation). `SupplyField.tick` itself, on the review pass, was found
allocating a fresh `{gaveAmmo, healed}` summary on every single call
regardless — its one caller (`onFoot`) never reads it, so this was rule 5's
exact shape of waste with zero consumers; it now mutates one instance-level
result object in place instead, matching `NO_EFFECT`'s own pattern.
`collectSupplyDepots`'s scene walk runs once per level load, not per frame.

## Tests

```
cd tools/bf1942-models
python3 -m unittest tests.test_armor tests.test_supply -v
```

20/20 pass: `Armor`'s clamp/death/sign-dispatch (10 cases: spawn full,
damage+heal clamp at max, a killing blow snaps to exactly 0 and reports true
loss, the `0.001` boundary's direction, death is final, non-positive
damage/heal are no-ops, `applyDamage`'s sign dispatch including a lethal
call, the 128 ceiling); `SupplyDepot`/`SupplyField` (10 cases: sparse-data
defaults, team gating both directions, radius is inclusive and 3-D, the 0.5s
self-throttle bags up real elapsed time correctly, Ammobox's 15/s leaky
bucket fires on essentially every cycle, the mediclocker heals at exactly
its own rate and clamps at max, ammo-before-heal starves the M3A1's heal, a
negative rate is reported as damage not a heal, a vehicle-only depot never
serves a soldier, the icon predicates are continuous and per-depot). The
full suite (872 tests) also passes clean on top of these.

## Browser-level verification

Headless Playwright chromium (`ui/node_modules/playwright`), Wake,
`map.html?mod=bf1942&map=wake&shots`, following the round briefing's own
recipe (`__setOnFoot(true)`, step 30, select a flag, `__deploy.spawn()`,
step 30, wait 1.5s real, step ~150, then drive the scenario). All of the
below were captured against the **real, loaded Wake scene** — not a mock —
so a claim like "a depot 0.64 m away is eligible" is a distance actually
measured off the scene graph.

- **Heal, end to end**: spawned at 30/30, teleported onto
  `mediclockerRepairpoint`, `window.__damage(15)` -> confirmed `hp === 15`;
  after ~0.67s (one 0.5s cycle) `hp` rose to 19.12 (`15 + 4×0.6×~1.03`,
  matching the mediclocker's own 4 HP/s rate); continued stepping clamped
  exactly at `30/30`. `hud.vars['ShowHealIcon']` was `true` throughout while
  in range and `false` once teleported 2000 m away, with `hp` provably
  static across 60 further frames out of range.
- **Ammo, end to end**: `window.__setAmmo(2, 1)` on the spawned Bar1918
  (used instead of live fire — see Known issues), teleported onto
  `AmmoboxSupplyDepot` (0.64 m away, `ammoEnabled: true`), stepped ~1.5s:
  `rounds` `2 -> 20`, `mags` `1 -> 5` — exactly the full loadout
  `ensureHandWeapon` equips fresh with.
- **Fall damage, end to end** (`window.__dropFromHeight`, driving the real
  physics integration, not `Armor.applyDamage` directly), re-measured after
  the height-tracking fix above, on open ground (a spawn with a low roof
  nearby had been quietly capping the drop short — see Known issues): a
  2.5m drop cost nothing (`hp` unchanged, below `SAFE_FALL_HEIGHT`'s
  ~3.96m); a clean 12m drop cost 13.97 HP against a closed-form prediction
  of `sqrt(2×14.73×12) ≈ 18.8 m/s` -> ramp `0.466` -> `0.466×30 ≈ 13.98` —
  matching to within 0.01 HP, not the ~0.8 HP gap the velocity-sampled first
  cut left; a 40m drop was lethal (`hp: 0, destroyed: true`).

### Pixel evidence

Captured under `scratchpad/p3/` in this session (`canvas` picked by its
known 1600x1000 drawing-buffer size — `#stage` also holds the 376x376
minimap canvas, which an earlier, plain `document.querySelector('canvas')`
picked up first; `pixels-*`/`ammo-*`/`fall-3-lethal-drop` are the corrected
crops, `heal-*`/`fall-1`/`fall-2` predate the fix and show the minimap inset
instead of the first-person view, though their overlaid HUD-var text is
still the real captured data):

- `pixels-1-damaged-at-mediclocker.png`, `pixels-2-healing-in-progress.png`:
  first-person view standing at Wake's mediclocker prop (visible: the green
  locker), overlay text showing `hp` 15/30 then 19.12/30 and
  `ShowHealIcon=true`.
- `ammo-1-depleted-in-range.png`, `ammo-2-refilled.png`: standing at the
  ammobox prop (a red-cross-marked green crate, visible in frame), rounds/mags
  2/1 then 20/5.
- `pixels-3-lethal-fall.png`, `fall-3-lethal-drop.png`: post-lethal-drop
  view (a rooftop over Wake's beach), `hp: 0, destroyed: true`.
- `wake-depots.json`: all 52 `SupplyDepot` nodes as read live off the loaded
  scene (name, world position, radius, team, `workOnSoldiers`/`Vehicles`,
  `health`, `ammoTypes`) — the source the heal/ammo depots above were picked
  from, not hand-picked coordinates.

The adversarial reviewer's own pass re-ran all three scenarios independently
(own script, own browser session, `wake-depots.json`'s coordinates but not
this session's screenshots) and captured its own crops under
`scratchpad/p3-review/`: `heal-canvas-2.jpg`, `ammo-canvas-2.jpg` (both the
correct first-person view via `window.__renderer.domElement` directly —
`document.querySelectorAll('canvas')` also matches `#fullmap-canvas`,
1024x1024, so a `width >= 1000` filter is not enough to exclude it either),
and `fall-lethal-canvas-2.jpg` (the `Landing_Beach` re-run, sand and palm
trees, `hp: 0`).

## Known issues / open items

- **A pre-existing, unrelated quirk in the base weapon-firing system**: with
  the Bar1918 in hand, holding `window.__setTrigger(true)` for ~4s registered
  5 shots (`handWeapon.shots`) but `handWeapon.rounds`/`mags` never moved off
  their spawn values and no reload occurred. This is `gunfire.js`/round-1
  territory, not this track's (`guns.onShot`'s `hw.rounds -= 1` in
  `map.html`, or `group.shots`'s own counter, may be decoupled for this
  weapon) — flagged as a background task
  (`task_4b7d2a66`) rather than investigated further here. The ammo
  end-to-end check above used `window.__setAmmo` to sidestep it, which
  exercises exactly the code this track owns (`supplyTarget.refillAmmo`,
  `SupplyDepot.tick`'s ammo branch) without depending on the firing system's
  own behavior.
- **This worktree's `viewer/models` symlink was nested one level too deep**
  (`viewer/models/models -> ../models` instead of `viewer/models ->
  .../viewer/models`, so every weapon but a hand-placed Thompson 404'd).
  Fixed locally (`rm -rf viewer/models && ln -s
  .../tools/bf1942-models/viewer/models viewer/models`, matching how
  `viewer/maps` was already linked) — untracked, so this is a worktree setup
  fix, not a code change.
- **The SwiftShader software renderer is fragile on this shared host**: of
  roughly eight headless verification runs, several crashed
  ("Target page, context or browser has been closed") at unpredictable
  points, sometimes seconds into a run and sometimes minutes in with no
  correlation found to a specific call. This matches the project's own
  documented Iris Xe / SwiftShader context-loss finding
  (`features/mesh-viewer-performance/README.md`) rather than anything new;
  splitting verification into several short, focused sessions (one per
  mechanic) rather than one long one worked around it here.
- Fall damage (R4-18) and the ammo per-magazine mechanics (SUP-23) are both
  viewer approximations standing on an explicitly open engine question —
  see the sections above for exactly what to replace if either surfaces.
- **Fixed on the adversarial review pass**: the fall-damage ramp sampled
  `soldier.velocityY` *after* `soldier.step()` returned, which is always
  post-`settle()` and therefore already zeroed on the very tick a landing is
  detected — a systematic ~5% undercount (see Fall damage, above), not
  random noise, confirmed by deriving the exact expected miss (one tick's
  gravity) before re-running anything. Switched to tracking the highest `y`
  reached while airborne and ramping on the actual drop instead — exact
  regardless of tick timing, and it also does not care how many real
  animation-frame ticks land between two `__renderOnce` calls, unlike a
  velocity sample would.
- **The_Airfield's own spawn point has a low ceiling** (a roof or similar
  geometry roughly 5.5 m above the ground) that silently capped an
  `__dropFromHeight(12)` there to a ~7.3 m actual fall — caught by logging
  the actual start/end `y` alongside the intended height rather than trusting
  the parameter. Re-run on `Landing_Beach`'s open sand for a clean 12 m
  drop. Worth knowing for any future fall-damage check at that spawn.
