# Carrier / Destroyer Parity Fix Plan (corrected 2026-09-22)

Six issues with carrier/destroyer play in the mesh viewer (`tools/bf1942-models/viewer/`).
An earlier draft of this plan misdiagnosed Issues 1–3; the corrections below are verified
against the game data in `~/.wine/.../Mods/bf1942/Archives/Objects.rfa` and the current
working tree (which already carries uncommitted fixes for Issues 3/4/5 — build on them,
do not revert).

---

## Issue 1: Carrier deck is empty (no planes) — CORRECTED root cause

**Not** `addTemplate` PCO children. The deck aircraft are **child `ObjectSpawner`s with
`holdObject 1`** in the carrier's `Objects.con`:

```
Enterprise_corsairSpawner: setObjectTemplate 1 corsair / 2 corsair, holdObject 1,
  TimeToLive 120, Distance 200, team 1   (Enterprise/Objects.con)
Enterprise_sbdSpawner:     setObjectTemplate 1 SBD / 2 SBD, same window
Enterprise_lcvpSpawner:    setObjectTemplate 1 Lcvp / 2 Lcvp, holdObject 1,
  TimeToLive 30, Distance 20, MaxNrOfObjectSpawned 3, damageWhenLost 10, team 1
```

In game the engine spawns the object and *holds* it on deck until entered / TTL /
out-of-Distance. Our pipeline drops them entirely: `bf42/con.py` and `bf42/assemble.py`
contain **zero** `ObjectSpawner` handling (grep), and `Enterprise.report.json`'s
`partTree` shows no spawner entries — no planes, no davit LCVPs.

**Fix (extractor, Agent 1):**
1. `bf42/con.py`: parse `ObjectSpawner` blocks needed for assembly
   (`setObjectTemplate`, `team`, `holdObject`, `TimeToLive`, `Distance`,
   `MaxNrOfObjectSpawned`, `damageWhenLost`, `spawnOffset`).
2. `bf42/assemble.py` `build_node`: when a child template is an `ObjectSpawner`,
   resolve its vehicle (`vehicles[spawner.team]`, fallback as today) and assemble it
   as a static child at the spawner's `setPosition`/`setRotation`, stamped with
   `extras.holdObject` / spawner name.
3. Confirm what `FletcherLcvpSpawner` resolves to — its block shows `holdObject 1,
   TimeToLive 30, Distance 20, MaxNrOfObjectSpawned 3, damageWhenLost 10` but **no
   `setObjectTemplate` lines in `fletcher/Objects.con`**; the vehicle may be declared
   in `fletcher/AI/Objects.con` or nowhere (in which case destroyer davits are
   genuinely empty in-game too — verify, don't assume).
4. Survey all sea vehicles for child spawners (Shokaku Zero/SBD/LCVP, Hatsuzuki,
   Yamato, PrinceOW, Gato, Sub7C) so every hull is covered.
5. Re-extract affected vehicle models (`viewer/models/*.glb`) and affected maps
   (any level spawning carriers/destroyers/battleships/subs), re-run model tests,
   publish via the `bfstats-mesh-assets` skill path.
6. Tests in `tests/test_con.py` / `test_assemble.py` for held-child assembly.

**Viewer follow-up (Agent 6, after Agent 1 lands):** decide entry vs dressing for
held PCOs. Check `flight.js` `findVehicles()` traversal: if nested held PCOs are
returned, entering one reparents it off the carrier (acceptable v1 — you board the
deck plane and take off; child-spawner respawn is a noted divergence). If entry
breaks, exclude `extras.holdObject` nodes from discovery and keep them as static
dressing (carrier air stays as broken as today — `Enterprise_AirCraftSoldierSpawn`
has `setEnterOnSpawn 0` — but visual parity is restored). `freezeStatics` /
`applyVisibility` already treat the carrier subtree as one unit; confirm no change
needed.

## Issue 2: Landing-craft davits + ramp animation — CORRECTED

Davits are Issue 1's mechanism (same `holdObject` spawners) — covered by Agent 1.
The ramp is a separate input-routing bug:

- `Lcvp_Ramp`: `RotationalBundle`, `setInputToPitch c_PIPitch`, maxRotation 0/90/0,
  maxSpeed 0/45/0. `DaihatsuLanding1` (0/65) + `DaihatsuLanding2` (0/180) likewise.
  Ramp sound scripts exist (`Sounds/Lcvp_Ramp.ssc`, `Sounds/dai_Ramp.ssc`).
- `world.js` `#vehicleTick` ground branch (ships land here) only ever sets
  `c_PIThrottle/c_PIYaw/c_PIFire/c_PIAltFire` — **`c_PIPitch` is never fed**, so the
  ramp sits at rest. The air branch feeds it from the pitch axis (ArrowUp/Down).

**Fix (Agent 2, `world.js` only):** in the ground branch, when `player.kind === 'ship'`,
route `c_PIPitch` from the pitch axis (arrows; **not** W/S — W/S is `c_PIThrottle`,
and coupling the ramp to reverse would be wrong). First survey every sea vehicle
report for `c_PIPitch` consumers so the routing has no side effects beyond the
intended: LCVP/Daihatsu ramps, plus the Gato/Sub7C dive (`GatoFloater` angle on
`c_PIPitch` — enabling arrows-to-dive is engine-faithful, wanted). Ramp audio wiring
is a bonus if the rig-audio path already supports bundle sound scripts.

## Issue 3: Beaching stops dead with no groan — CORRECTED

Physics is engine-faithful (Coulomb budget + `pushOutOfBed` normal impulse); the game
feels different because it plays the hull-scrape. Working tree already latches
`beachedThisTick`/`beachSpeed` (`ship.js` `integrate`), but the `map.html` hook looks
up `damageTables.effects.ground.hull`, which **does not exist** — `damage.json`
`effects` is keyed by numeric attacker material (`'2'`, `'3'`, …) with victim cells
(e.g. victim `'55'` → `e_Collision_ship` for a Fletcher, material 55). The bundle
exists in the library (`e_collision_ship`, lowercase).

**Fix (Agent 4):**
1. Resolve the beaching effect through the same material mapping `onCrashDamage`
   (`map.html:6187`) uses (`damageTables.effects[attGroup][defGroup]` with the
   hull's material vs the seabed's), reusing `crash-damage.js`'s resolver if one
   exists — play only, never damage (W9-A: beaching bills nothing).
2. Normalise case (`e_Collision_ship` vs `e_collision_ship`; see `assemble.py:1319`).
3. Scale with `beachSpeed` (`effects.play` already takes `speed`; check the
   `onSound` path in `map.html:5419` actually forwards it to `effect-audio.js`,
   and the ship script's `Volume←Speed` ramp gets fed).
4. Single groan on the beach frame; a grind loop while sliding only if the effect
   system supports loops cheaply — do not overbuild.

## Issue 4: Destroyer second turret never tracks — peers fix needs completion

Working tree has the peers approach (`seats.js`: `surveyVehicle` peers arrays,
`TurretAxis` per-peer bases, `TurretRig` passing peers) — correct for the Fletcher
(root `Fletcher_cannon` + `Fletcher_cannon_Front`, aft `Fletcher_Back_Canons_PCO`
with two bundles; identical specs, same local delta valid).

**Remaining (Agent 3, `seats.js` + tests only):**
1. Guard peering on **same input**: the `aimUpgrade` arm currently peers a V-100
   steered wheel (`c_PIYaw`) under the turret (`c_PIMouseLookX`), welding the wheel
   to turret angle. Require `spec.input === held.spec.input` before peering.
2. `cameraRidesTurret` (`map.html:7080` — read-only use; implement the peer check
   in `seats.js` as a helper if cleaner, else a minimal `map.html` edit coordinated
   with Agent 4) must consider `peers`, not just `axis.node`.
3. Update `tests/test_seats.py` + harness for the `{node, spec, peers}` shape.

## Issue 5: AA-gun dismount lands under the carrier — Fix A done, Fix B incomplete

Fix A (working tree `exitPoseManned`, `map.html:8183`): use the exit node's own world
pose for nested seats — verified correct (`Enterprise_AABattery1` exit `[1.2,0.2,0]`
in the gun frame, metres above the waterline hull origin).

Fix B (working tree `leaveManned` nested path) is directionally right but incomplete,
and its comments are stale: `leaveVehicle` does **not** zero velocity (see
`map.html:8053-8056`); it parks in place. The nested path currently skips
`world.resetStick`, `releaseDrivenBody`, `disposeEngineAudio` (uses `stopEngineAudio`),
and view/camera reset — and by nulling `occupancy` + `clearPlayerVehicle` the ship
never integrates again, so "keeps her velocity" is unobservable.

**Fix (Agent 4, `map.html`):** give the nested-ship exit full cleanup parity with
`leaveVehicle` (stick reset, driven-body release with the existing `scene.sea` branch,
engine-audio dispose, HUD, view/camera mode) while keeping the ship parked where she
lies. Check `idle-vehicle.js` first: if driverless integration already exists, route
the abandoned hull into it instead of parking; otherwise park (consistent with helm
exit) and note coasting as a follow-up.

## Issue 6: Depth charges fire with the primary — verify at runtime, then fix

Static trace looks correct: `Fletcher.glb` has 4× `c_PIFire` cannon groups +
2× `c_PIAltFire` `DepthChargeLauncher`; `world.js:869-894` gates on
`vehicle.input(group.stats.input)` with per-tick `setInput` under `inControl`;
stale inputs are inert; touch has no alt-fire path at all (missing feature, not a
conflation). **Nobody has reproduced the report.**

**Fix (Agent 5):** headless proof on the Fletcher root seat —
`__setSeatFire(main-only)` must leave `DepthChargeLauncher` groups unfired,
RMB/`altFire` must fire them without the cannon; check HUD secondary slot
(`byWeaponSlot`) and that each family plays its own sound script + water entry
(`waterexplosionsub` family) rather than a shared one. Fix only inside
`gunfire.js`/`effects.js`/data if the test finds a defect; if the defect is in
`world.js`/`map.html`, return evidence to the coordinator instead of editing
(Agents 2/4 own those files).

---

## Workstream ownership (no two agents in the same file)

| Agent | Files | Task |
|---|---|---|
| 1 | `bf42/con.py`, `bf42/assemble.py`, `tests/test_con.py`, `test_assemble.py`, models + maps re-extract | child `ObjectSpawner` assembly |
| 2 | `viewer/world.js`, world/input tests | `c_PIPitch` routing for ships |
| 3 | `viewer/seats.js`, `tests/test_seats*.py`, harness | peers guard + tests |
| 4 | `viewer/map.html`, `viewer/effect-audio.js`, `viewer/crash-damage.js` | dismount completion + beaching sound |
| 5 | headless verification; `viewer/gunfire.js`, `viewer/effects.js` only if defective | depth-charge proof + fix |
| 6 | viewer deck-prop entry decision | **after** Agent 1 lands |

Verification: module unit tests per agent (`python3 -m unittest` from
`tools/bf1942-models`); coordinator runs `./scripts/verify.sh --skip-e2e` once at
the end. No emojis anywhere. Preserve the working tree's uncommitted changes.
