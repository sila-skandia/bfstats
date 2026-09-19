# What the 2026-09-19 research round changes in the viewer and the extractor

Every item below is **verified**: a research stream read it out of a binary and
an independent verifier re-derived it before it reached the corpus. Where the
two disagreed, the verifier's reading is what is written here — several of the
round's own recommendations were refuted that way, and each one is recorded as a
**do NOT** so that a later builder cannot resurrect it from the research report.

Read with [`BRIEFING.md`](BRIEFING.md). Ledger ids point at
`features/bf1942-engine-reference/ledger.md`; the narratives are in that
folder's `subsystems/`.

Three pieces of ground rules:

- **Line numbers are from `main` at 2026-09-19** and are a guide, not a
  contract. Match on the symbol, not the line.
- **Nothing here is a re-extraction.** Where a change needs a new `.con` word,
  the extractor change and the viewer change are separate items; the lead
  re-extracts once.
- The same-day **collision round** (`subsystems/collision-response.md`,
  ledger COL-2…COL-12) owns vehicle-versus-vehicle and vehicle-versus-ground
  crash damage, the contact solver and sleeping. Where an item here touches
  that, it says so and defers.

---

## `viewer/physics.js`

### 1. The jump is 6.0 m/s, and it is an impulse (PHY-1)

`JUMP_SPEED = 5.4` (`:374`) becomes **`6.0`**, and the doc comment above it
(`:359`–`:373`, "UNMEASURED — this is a tunable, not a fact") is replaced by the
derivation: client `0x008eb25c` / lnxded `0x086d271c`, raw `40c00000`.

`physics.js:646`'s `v.y = JUMP_SPEED` is a velocity **set**; the engine adds an
acceleration for one tick:

```js
// n = the contact normal kept from the previous tick (see item 2)
// vCmd = this tick's commanded movement vector, before it is consumed
const horiz = normalise({ x: vCmd.x, y: 0, z: vCmd.z });   // y forced to 0 BEFORE normalising
const K = Math.min(1 + dot(horiz, n), 1.0);
v.x += -0.25 * vCmd.x;
v.y += K * n.y * 6.0 - 0.25 * vCmd.y;
v.z += -0.25 * vCmd.z;
vCmd.set(0, 0, 0);                                          // zeroed outright, not damped
```

The engine multiplies that whole vector by `g_simulationFps` and hands it to
`addAccelerationAtRelativePosition`, and the integrator zeroes its accumulator
each tick — so the net is exactly the `Δv` written above, once. On flat ground
(`n = (0,1,0)`, `K = 1`) that is **+6.0 m/s**, giving a **1.12 m apex and 0.80 s
airtime** at `g = −14.73`.

- **do NOT** keep 5.4, and do NOT "measure it in wine" — it is read.
- **do NOT** write the apex as 1.222 m or the hang as 0.815 s. Those are the
  continuum `v²/2g` figures; the engine's four-sub-step integrator gives
  1.12 m / 0.80 s, and a viewer calibrating to 1.222 will be 9% high.
- **do NOT** implement the horizontal term as `vCmd *= 0.75`. The `−0.25·vCmd`
  lands on the **actual velocity** and the command is then set to **zero**. At
  6 m/s forward that is a 1.5 m/s backward kick on the jump tick — ten times a
  normal tick's forward gain, in the opposite direction.

### 2. The jump gate is a contact normal, not a slope limit (PHY-1)

Replace the grounded/`MAX_GROUND_SLOPE` test at `:645`, `:820` and `:857` for
*jump legality only*: a jump is legal iff the previous tick produced a contact
with **`normal.y > 0.1`** on a material that is not water. That is far more
permissive than `MAX_GROUND_SLOPE = cos 60°` (`:433`).

Keep `MAX_GROUND_SLOPE`, `STEP_HEIGHT` (`:425`) and `BODY_RADIUS` (`:412`) as
viewer choices — but their comments should now say that the engine has **no**
walk-slope limit, **no** step-up code and **no** movement capsule at all: the
collider is the object's `SimpleCollisionMesh` vertices swept by
`ResponsePhysics::checkVsTerrain`. `0.1` is the only slope threshold anywhere in
soldier movement.

### 3. The speed tables are reached through a ramp (PHY-6)

A signed byte per axis, clamped ±127, stepped **+20 per tick** while the input
is held and **−12 per tick** toward zero when it is released, then multiplied by
**1/127** to scale `directionalSpeed[pose*2 + (ramp <= 0)]`:

```
input == 0 && state != 0 : state -> 0 by 12
input >  0               : state = min(max(state, 0) + 20, +127)
input <  0               : state = max(min(state, 0) - 20, -127)
speed = table[pose*2 + (state <= 0 ? 1 : 0)] * (state / 127) * (walking ? 1/3 : 1)
```

At 30 Hz: **0.212 s to full speed, 0.353 s to a stop**. The forward/backward
table slot is chosen from the **ramp byte**, not the raw input, so the table
does not flip the instant the key does.

Two further facts for whoever reworks the ground move: the table value is
applied as a **force**, `accel = 0.75·vCmd` with **no** `×30` (so `Δv =
vCmd/40` per tick), and it is applied **only on a tick where the collision
solver resolved no impulse**. A soldier standing on the ground is therefore
moved by the friction path, not by this force. Swimming's `5.0·vCmd` is **not**
under that gate.

### 4. The submersion drag field has a name (PHY-7)

`scale = 1 + 24·min(underWater/boundingRadius, 1)` — `underWater` is
**submersion depth in metres** (`PointPhysicsNode::setUnderWater`, `+0x44`), and
the 24 is `25.0 − 1` with the 25.0 at `0x086ccce0`. Retire the "do not treat as
verified" comment on that factor. `SOLDIER_BOUNDING_RADIUS = 0.8` (`:357`)
stays inferred.

---

## `viewer/soldier.js`

- The press-edge jump handling at `:452`–`:457` is **correct and matches
  retail** — the engine refuses a re-jump while the soldier's sound trigger is
  `c_SstJump`. Keep it; just make `body.jump()` apply item 1's impulse.
- When the locomotion model is next touched: PHY-2 means a soldier standing on
  the ground is moved by the **friction solver**, because the `0.75·vCmd` force
  is gated off whenever a contact impulse was resolved. The current model
  reaches the right steady-state speed on flat ground by a different route,
  which is fine to keep — but do not describe it as the engine's mechanism.

---

## `viewer/effects-core.js`

### 5. The splash falloff is right — leave it (HP-9)

`splashDamage`'s `Math.max(0, 1 - distance / radius)` is the engine's exact
law: `t = clamp((radius − d)·(1/radius), 0, 1)`, with `A = 1/radius` computed
once by `handleExplosion` and passed at both call sites. Two clarifications
worth putting in the comment: the distance is to the victim's **transform
origin** (not a bounding box, not the nearest surface), only the **Y** term is
scaled (by `YModOnExplosion`, default 1.0), and there is **no occlusion at all**
for anything that is not a soldier.

- **do NOT** change `if (mod == null) return 0;` (`:541`). **DMG-1**: the
  engine's fallback is `defaultDamageMod`, and that field is **0.0 for the life
  of the process** — both constructors write 0, the setter is a vtable slot
  nothing calls, and no console property registers it, so no mod can set it
  either. An unlisted material pair really does mean no damage. The F1 report's
  recommendation to return the field instead is refuted; acting on it would
  either change nothing or introduce a bug.

### 6. `splashSpec` needs the two-path rule (HP-9d)

`splashSpec` (`:508`) currently accepts `damageType == 1` or `null` and ignores
`hasCollisionEffect`. The engine has **two** explosions:

```js
// impact explosion, at the moment of collision
const impact = damageType === 1 && !!hasCollisionEffect;
// end-of-life explosion, when timeToLive expires or the fuse runs out
const endOfLife = damageType === 1 || damageType === 4;   // NO hasCollisionEffect test
```

- **do NOT** require `hasCollisionEffect` for splash generally. It is the
  **impact-versus-fuse discriminator**, not a splash capability flag. Requiring
  it would silently delete grenade, explosives-pack, satchel and landmine
  splash — the most-used splash damage in the game. In vanilla, exactly three
  of the 28 `damageType 1` projectiles omit it (`ExpPackProjectile`,
  `GrenadeAlliesProjectile`, `GrenadeAxisProjectile`), and `LandmineProjectile`
  is `damageType 4`.
- `damageType 4` explodes **only** at end of life, never on impact.
- The end-of-life path uses an **untruncated** radius and passes
  `sourceArmor = NULL`.
- A missing `damageType` on an old baked glb may keep being treated as 1; say so
  in the comment rather than leaving it implicit.

### 7. Radius is an integer, and a fractional one can mean no splash (HP-9)

`ProjectileTemplate.radius` is a console **`int`**. Floor it toward zero
wherever it is read, and treat `radius < 1` as **no splash at all** (the gate is
strictly `radius > d` with `d ≥ 0`). This is not theoretical: 340 templates
across the installed mods author a fractional radius, and DC's
`50calSniper_Projectile radius 0.25` becomes 0. The constructor default when the
`.con` omits it is **10.0**, and six vanilla tank rounds rely on it.

---

## `viewer/gunfire.js`

### 8. A fuse weapon explodes when its life ends (HP-9d)

Grenades, satchels and mines never take the impact path. When a shot's
`timeToLive` expires (or its fuse runs out), fire the end-of-life explosion for
`damageType ∈ {1,4}`, with the untruncated radius. Today the viewer only
explodes on contact, so a grenade thrown into the open does nothing.

Nothing else here changes: GUN-9's integrator note stands, and the turret servo
(item 12) lives in `seats.js`, not here.

---

## `viewer/vehicle-damage.js`

### 9. The header comment is now wrong (HP-6, COL-3, COL-4)

Lines 9–11 say "**A collision never costs hit points** (HP-6) … Do not add a
crash-damage path — the engine has none." That is refuted: both collision
handlers call `GameServer::giveDamage` through the **GameServer's** vtable slot
`+0x15c`. Correct the comment and point it at
`subsystems/collision-response.md` §9.

**The vehicle crash path itself belongs to the concurrent collision round** —
its formulas, its once-per-second-per-pair rate limiter and its material tables
are COL-3/COL-4/COL-5. Do not implement it from this document. What this round
adds is the **soldier** half (item 16) and the splash gates above.

`applySplash` needs whatever `assemble.py` emits for item 20 so it can apply the
two-path rule rather than guessing from `material2` alone.

---

## `viewer/seats.js`

### 10. `TurretAxis` is a first-order velocity servo (GUN-2)

Replace `TurretAxis.step`'s bank-and-spend model with the engine's:

```
speed  -> sign(acceleration) * input * maxSpeed     ramped at |acceleration| deg/s^2
angle  += speed * dt  +  continousRotationSpeed * dt
```

then clamp: `angle > max → max`, else `angle < min → min`. Degrees throughout.

### 11. Three things the servo brings that the viewer has never had (GUN-2)

- **`continousRotationSpeed · dt` is added unconditionally**, every tick, in
  the non-`automaticReset` path. 29 vanilla declarations — windmills,
  watermills, radar towers — currently never turn.
- **`automaticReset` is a different law entirely**: the angle ramps straight
  toward `input × maxRotation` at `|acceleration|` **deg/s** (not deg/s²), with
  no velocity register and no continuous term. 221 vanilla declarations
  (steering wheels, Engines) run under the wrong law today. `con.py` already
  emits the flag.
- **The wrap rule is `minRotation == 0 && maxRotation == 0`**, not a zero-width
  range — see item 18. When it applies it is a single ±360 correction, not a
  modulo.

`direction = sign(acceleration)` (`con.py:1002`) is **correct** — it matches the
engine's `fchs`-on-negative-acceleration exactly. Keep it.

### 12. `TURRET_SPEED_SCALE` keeps its value (GUN-2b)

- **do NOT** remove or re-tune `TURRET_SPEED_SCALE = 4` (`:524`), and do NOT
  repeat the research report's claim that "`maxSpeed` is the literal deg/s
  ceiling, so every vanilla gun traverses four times too fast". That was
  **refuted**. `maxSpeed` is a **gain — deg/s per unit of input** — and nothing
  establishes the input's unit: the ±1 clamp lives inside the
  `rememberExcessInput` branch, which **no** turret, manned gun or tank in any
  of 18 installs declares (vanilla's 32 uses are all aircraft rudder and
  tail-flap `Wing` bundles); every `PlayerInput` float on the wire is quantised
  over **±16** by `floatToFixed(v, 12, 16.0f)`; and the "nine times slower than
  a soldier's head" observation compares two different control laws, because
  `SoldierCamera` declares `setMaxSpeed 0/0/0` and never enters this function.
- **do** replace the constant's stated justification (which cites the
  now-corrected "±40 is not the template's `maxSpeed`" wording) with the real
  open question: what magnitude the client's mouse-look axis delivers as
  `PlayerInput[c_PIMouseLookX/Y]`. Ledger **GUN-2b**.
- `TURRET_PENDING_CLAMP = 40` (`:488`) is a coincidence of the number, not of
  the quantity: the engine's ±40 register is an **input backlog in input
  units**, gated behind `rememberExcessInput`, and is therefore dead for every
  vanilla gun. The viewer's `pending` is degrees of aim. Say so, or drop it with
  the bank model.

### 13. Seat switching already matches retail (SEAT-11)

`enter(player, force)` steals a seat only when `force == true`, and the **only**
call site in the binary that passes `true` is `GameServer::exitVehicle`. The
seat switch (`c_PIMenuSelect`), `c_PIUse` entry, spawn and kill all pass
`false`. **No change needed** — a viewer that refuses an occupied seat is
correct. The row just stops being a hazard to hedge against.

### 14. A wreck cannot be driven, and a burning vehicle traverses slowly (HP-15)

This retires ARM-6 ("a critically damaged vehicle drives and traverses exactly
as a healthy one"), which was **false**:

| state | effect |
|---|---|
| critical (`hitPoints < criticalDamage`) | **every rotational bundle's input is scaled by 0.2** |
| destroyed | **no player input reaches any child at all** |

The engine carries this as two bytes on the object (`SimpleObject+0xed`,
`+0xee`), set by the Armor status messages and cleared only when the
wreck-respawn timer expires — they are persistent state for the whole wrecked
lifetime, not per-frame flags. Gate the viewer's own input the same way, in
`seats.js` for traverse and in `map.html`'s `drive()` for the wreck.

---

## `viewer/ground.js`

### 15. The gear ladder is data, and it is interpolated (TANK-3, TANK-4)

Delete the invented `gearRatios: [3.8, 2.6, 1.8, 1.25, 1.0]` (`:83`). Build the
101-slot curve from the authored control points with the engine's own
piecewise-linear fill, then index it:

```
ratio curve control points:  20 -> 3.5, 40 -> 2.2, 60 -> 1.5, 80 -> 1.1, 100 -> 0.94
index 0 is NOT authored, so slots 0..20 ramp from the default 1.0 up to 3.5
fill between authored lo and hi:  v[j] = ((hi-j)*v[lo] + (j-lo)*v[hi]) / (hi-lo)
after the last authored index:    hold the value flat

idxf  = gear / numberOfGears * 100
i     = trunc(idxf)              // toward zero
frac  = idxf - i
ratio = 3.5 * differential / lerp(curve[i], curve[i+1], frac)
```

Ladders this produces: **Sherman** (`nGears 5, diff 4`) 4.000, 6.364, 9.333,
12.727, 14.894. **Willy** (`5, 7`) 7.000, 11.136, 16.333, 22.273, 26.064.
**M3A1** (`4, 5`) **5.512**, 9.459, 14.583, 18.617.

- **do NOT** keep the "every slot is 1.0 except five control points" model, and
  **do NOT** carry **M3A1 = 17.5** anywhere. It is **5.512**.
- **do NOT** assume five gears. `numberOfGears` reaches 8 and 50 in installed
  mods, and every count now gets a real ratio.
- **Warning, and it is the easy bug here: the ladder is not monotonic.**
  Because the curve rises from 1.0 to 3.5 across indices 0–20, a gear landing
  below index 20 gets a **higher** ratio than first-of-a-5-speed. `nGears 8,
  differential 5` gives g1 = 6.83 but g2 = 5.51. Do not sort, clamp or "fix"
  that.
- **Implementation trap:** `ground.js`'s existing ladder normalises to the
  **curve sample** (`curve[idx]/3.5` = 1.000/0.629/0.429/0.314/0.269), not to
  `getCurrentRatio`, which *rises* with gear (Sherman 4.0 → 14.89). Keep the
  two straight when porting.
- The second curve (`getCurrentTorque`) is indexed by a **normalised rev
  fraction**, `min(|revs|, 1.0)·100`, **not** the gear; its control points are
  0→0.70, 10→0.80, 30→0.90, 60→1.00, 85→0.85, 100→0.70. **do NOT** repeat
  "feeds engine-sound RPM only" — that is unproven; its caller runs inside
  `updatePhysics` and `addFriction`.

### 16. `mu` is material data, not a free constant (PHY-2)

`mu: 1.0` (`:121`) and `mu: 1.1` (`:908`) stop being `[free]`. The engine's
per-tick tangential budget is

```
mu_lo = A * 1.50 * 9.82 * L / 30      m/s of delta-v per tick   (sliding / kinetic)
mu_hi = A * 2.25 * 9.82 * L / 30      = 1.5 * mu_lo             (break-away / static)
A     = 0.5 * (materialFriction[matA] + materialFriction[matB])
```

and it is a **state-dependent hysteresis**, not two passes: a body currently
latched static is tested against `mu_hi` and unlatches if it exceeds it; an
unlatched one is tested against `mu_lo` and re-latches if it fits. Vanilla's
table: 0.1 water, 0.5 mud and outside-map, 0.6 rock, 0.8 grass/sand/wet
dirt/frozen, 1.0 default and dirt/sand road, 1.1 gravel and paved, 2.0
grenades, 10.0 stairs. 13 installed mods carry the word, range 0.0–100.0, and
Interstate 82 ships a wholly different set.

- The clamp is **isotropic on the tangential plane** — a vector clamp, nothing
  more. **do NOT** keep `corneringStiffness` (`:127`, `:910`) or `lateralMu`
  (`:909`) as engine-backed: **there is no slip-angle curve anywhere in the
  engine**, and the anisotropic `lateralMu` has no counterpart at all. Keep
  them if they earn their keep as viewer feel, but label them as inventions.
- `const cap = k.mu * load` (`:504`) is structurally the right shape and needs
  the 1.5:1 hysteresis and the material lookup.
- The detailed solver — what each grip mode *asks* for, the ×30, the mean over
  touching parts — is `collision-response.md` §8. Take it from there, not from
  here.

### 17. The suspension ray is a viewer approximation (PHY-5)

The engine's spring is

```
anchor = parentPos + rot(parentTransform) * offset      // offset is authored, via Spring::init
D      = anchor - wheelAbsolutePosition
accel  = -( strength * g * (-1/9.82) * D  +  damping * (D - D_prev) / dt )
applied to the ROOT node, at a ROOT-relative position
```

`D_prev` is a **one-tick backward difference of the displacement**, not a node
velocity. The `−1/9.82` makes sag gravity-invariant, so at the shipped
`g = −14.73` every spring acts at **1.5× its authored `strength`**.

**There is no ray.** Contacts come from the collision mesh's own vertices and
faces via `checkVsTerrain`; the binary's only line-versus-triangle routine has
two callers, both in AI pathfinding. The spring's axis is authored data
(`setAxisFixation`) and is never world-vertical. Keep the ray if it is what the
viewer can afford — but relabel it as an approximation of a vertex-contact
solver rather than as the engine's shape, and stop planning work around finding
"the engine's ray".

---

## `viewer/hud.js`

### 18. The turret dial's rotation sense (VHUD-9)

`RotateEffect` is **counter-clockwise-positive** on a y-down HUD frame
(`x' = x·cos + y·sin`, `y' = −x·sin + y·cos`); HTML canvas `ctx.rotate(+θ)`
(`:380`) is clockwise. The picture is currently right because
`headingRadians()` already flips the sign through `RIG_SIGN.yaw = −1` — two
errors cancelling.

- Change `hud.js` to `ctx.rotate(-angle)` **and** `map.html` to feed the
  **un-negated engine angle** (item 22) **in the same commit**. Half of it
  mirrors the dial.
- `headingRadians()` returns the three.js-sense value, so this needs a new
  accessor (or a plain `degToRad(axis.angle)`).
- The unit is **radians**, confirmed twice: replace the OPEN comment at
  `:199`–`:204`.
- **do NOT** apply `angleMultiplier`. It scales a draw-context scalar, not the
  bound variable, and all seven vanilla `RotateEffect`s author it as `0`. Record
  that as the reason.

### 19. For whenever the heat and reload bars get fed (VHUD-10)

The engine's feeder writes **`1 − f`**, not `f`:
`f = heat > 0.1 ? heat/heatMax : (reload > 0.1 ? reload/reloadMax : 0)` — heat
wins, with a strict `0.1` dead band on the raw values. `UnlimitedPrimaryAmmo`
and `UnlimitedSecondaryAmmo` **do exist** (bools on the `Ammo` weapon-icon
group), which closes `in-game-hud.md`'s open item; `SecondaryAmmoIcon` exists
too. `SniperSight` belongs to the **`CrossHair`** group, not `Overheat`.

- **do NOT** name the feeder's destination fields. `[this+0x14]` is an
  unidentified group object, and a float written at `+0xc` contradicts the
  Overheat group's `int` there.

---

## `viewer/map.html`

### 20. Hand-weapon ammo type: `aticon` feeds 2, not 6 (HUD-10)

`:7609`–`:7640` already branches on the weapon's own `hudAmmo` and feeds `1`
for `atammobar`. Change the `aticon` branch (`:7637`) from **6** to **2**, and
feed the rest of the enum straight through:

| `setHudAmmoType` | feed | draws |
|---|---|---|
| `ATNone` | 0 | nothing (knives) |
| `ATAmmoBar` | 1 | magazine panel, fill bar, rounds, mag box |
| `ATIcon` | **2** | panel, icon, **rounds** — Bazooka, Panzerschreck, ExpPack, Detonator, Landmine |
| `ATIconAndStrengthBar` | 3 | panel, icon, rounds, bar — grenades |
| `ATIconAndReloadBar` | 4 | panel, icon, reload bar, no rounds — RepairPack |
| `ATIconNoText` | 5 | panel, icon |
| `ATIconAndHeatBar` | 6 | panel, icon, heat bar — MedPack |
| unrecognised | 7 | panel, icon, reload bar |

The `.meme` value and the `.con` value are the **same enumeration** — there is
no converter to write.

- **do NOT** act on the report's claim that "`map.html` feeds 6 for all hand
  weapons, so every AT weapon and rifle renders with a heat bar". It does not;
  rifles and SMGs are already correct.
- **do NOT** add `setHudAmmoType` to the extractor. It has been parsed since
  before this round (`con.py:1875`–`:1883` → `hud_ammo_type`, emitted as
  `hudAmmo` at `con.py:1264`).

### 21. The turret dial's trigger (VHUD-9)

`:5149`–`:5150` gates `ShowTurretIcon` on "the seat has a traverse". The engine
gates it on

```
ShowTurretIcon = (activeSeatCamera.viewMode == 3) && pcoTemplate.hasTurretIcon
```

so it needs the new `setHasTurretIcon` field (item 24) **and** an inside view.
That turns the dial **off** for the Wespe/StuG class, which gets one today, and
**off** in chase views, which keep it today. In vanilla the word appears on
seven templates — Sherman, Tiger, PanzerIV, T34, T34-85, M10, Chi-ha — always on
the vehicle **root** PCO.

### 22. The turret dial's angle (VHUD-9)

Feed the engine's own value:

```
IconLookRotation = atan2(dot(pcoRight, camForward), dot(pcoForward, camForward))   // radians
```

positive to the PCO's right, about the **controlled** PCO's axes (the hull, for
a tank driver). Pair this with item 18's `ctx.rotate(-angle)` in one commit. The
comment at `:5141`–`:5147` reaches the right picture by wrong arithmetic
("clockwise 90° from 12 o'clock is 3 o'clock, not 9") and should be replaced.

### 23. Fall damage (HP-14)

`FALL_KINETIC_HP = 10` (`:5721`) and the ramp at `:5910`–`:5930` are replaced by
the engine's model:

```js
let v = impactSpeed - 8.0;             // 8.0 first
if (v < 0) return;                     // early return: no damage at all
const F = lastCollisionHeight - pos.y;
const X = F < 2 ? 1 : F - 1;
const Q = Math.max(1, X * kitDamping);
let A = Math.abs(cosTheta) ** (inWater ? 2 : 3);
if (F >= 3) A = 1; else if (F >= 2) A += (1 - A) * (F - 2);
if (v > 30) A = 1; else if (v > 10) A += (1 - A) * (v - 10) / 20;
const severity = Q * Q * A * (speedMod * v * v) * damageMod(att, def) * materialDamage(att);
if (severity > 1.0) applyDamage(severity);
```

Vanilla soldier: `speedMod 0.5`, `material 40`, 30 HP; every terrain material
0–15 gives `damageMod(ground, 40) = 0.001` and `materialDamage(ground) = 30`, so
`M1·M2 = 0.030`. Water is `1.5e-05`, about 67× gentler, and squares the cosine
instead of cubing it. At `g = −14.73`, flat, undamped: nothing below ~3.5 m,
**first damage at ~4 m, death at ~7.5 m**.

- **do NOT** implement the version in the F1 report. It omits the 8.0
  subtraction and the early return, and overstates severity by roughly 8× at
  5 m.
- **do NOT** use raw `|v|` anywhere downstream — the kinetic term, the 30
  saturation and the 10/20 lerp all use `|v| − 8`.
- The vehicle equivalent is COL-4, not this.

### 24. Seat-occupancy dots, and wreck input

- **VHUD-11**: feed `Vehicle/VehiclePosX<n>`/`PosY<n>` from the new
  `setVehicleIconPos` field (item 25). The values are positions inside the
  128×128 vehicle-icon texture, which is the space VHUD-7's
  `(192 + X[i], 452 + Y[i])` anchor already works in — Sherman's root `54/103`
  lands at `(246, 555)`, inside the icon. This unblocks the dots without
  inventing placement.
- **HP-15**: `drive()` must refuse input entirely for a destroyed vehicle and
  scale turret input by **0.2** for a critically damaged one (item 14).

---

## `bf42/con.py`

### 25. Two missing `.con` words

- **`setHasTurretIcon`** — a bool on the `PlayerControlObject` template
  (VHUD-9). 4,195 declarations across 18 installs, 4,160 of them `1`; vanilla
  has 10 sites on 7 templates. No hit anywhere in `con.py` today.
- **`setVehicleIconPos`** — a `Vec2` on the `PlayerControlObject` template
  (VHUD-11). Grammar: `ObjectTemplate.setVehicleIconPos <x>/<y>` — **one token,
  two integers separated by `/`** (19,085 of 19,089 declarations; 2 are
  space-separated, 2 empty). All integers; vanilla range X 12…99, Y 43…120.
  Declared **once per PCO**: the root and every seat carry their own (Sherman
  root `54/103`, `shermanBrowning_PCO1` `32/61`).

### 26. The `free` rule is wrong (GUN-2)

`con.py:998` — `free = lo is None or hi is None or lo == hi` — treats
`min == max == 45` as free-spinning. The engine wraps only when **both are
zero**:

```python
free = lo is None or hi is None or (lo == 0 and hi == 0)
```

**346 axes across 16 installs** are affected, three of them in vanilla
(`Elco_ThrottleL` pitch 60/60, `H6ControlStick` 8/8, missile engine axes
0.3/0.3 and 3000/3000). The engine pins those at their value; the viewer spins
them freely.

- **do NOT** add `setHudAmmoType` here. Already parsed (item 20).

---

## `bf42/damage.py`

### 27. `modifier()`'s docstring is right — make it explicit (DMG-1)

`:143`–`:148` says `None` means "the pair has no entry, which the engine treats
as no effect". That is **correct**, and now provably so: the engine's fallback
is `MaterialManager+0x24` (`defaultDamageMod`), which is 0.0 from both
constructors, is written by a setter nothing calls, and has no console word in
the fourteen-name MaterialManager block — so no mod can change it. Say that in
the docstring so nobody "fixes" it again.

`splash_damage`'s `max(0.0, 1.0 - distance / radius)` matches the engine. Two
refinements: the engine's gate is strictly `radius > d`, and the distance is to
the victim's origin with only the Y term scaled by `YModOnExplosion`.

### 28. The fall-damage inputs are already in these tables (HP-14)

Nothing to change, but worth a comment where the tables are built: for every
terrain material 0–15, `materialDamage = 30` and `damageMod(ground, 40) =
0.001`; water is `1.5e-05`. Those two numbers are what turn the fall formula's
`M1·M2` into `0.030`, and they are why the old fitted `≈0.026` was close.

---

## `bf42/assemble.py`

### 29. The 10.0 default is correct; the integer and the flag are not modelled

- `radius = 10.0` when the `.con` omits it (`:1434`) is the
  `ProjectileTemplate` constructor's own default. **Keep it.**
- Truncate an authored radius **toward zero** — the property is a console
  `int`, so `17.63` is 17 and `0.25` is 0 (item 7).
- Emit **`hasCollisionEffect`** alongside `damageType`/`radius`/`material2` in
  the splash spec, so `effects-core.js` can implement the two-path rule (item 6)
  instead of inferring it. Without it the viewer cannot tell an impact round
  from a fuse round.

---

## Ledger ids used here

PHY-1, PHY-2, PHY-5, PHY-6, PHY-7, HP-6, HP-9, HP-9d, HP-14, HP-15, DMG-1,
ARM-6 (retired), SEAT-11, GUN-2, GUN-2b, TANK-3, TANK-4, HUD-10, VHUD-7,
VHUD-9, VHUD-10, VHUD-11, GUN-9.

**COL-3, COL-4 and COL-5** are also cited, in items 9 and 23. Those rows belong
to the concurrent collision round and arrive with its own
"Rigid-body collisions" ledger section — if `ledger.md` has no COL row yet, that
branch has not been merged, and the vehicle crash path it owns is not yet
implementable from anything here.

## The refuted list, in one place

A later reader who finds the research reports before this file should know that
every one of these was checked and failed:

1. **Return `defaultDamageMod` for an unlisted material pair.** It is 0.0 and
   unreachable — the current behaviour is already right (DMG-1).
2. **Require `hasCollisionEffect` for splash.** It is the impact-versus-fuse
   discriminator; requiring it deletes grenade, satchel, expack and landmine
   splash (HP-9d).
3. **`maxSpeed` is the literal deg/s ceiling, so `TURRET_SPEED_SCALE` has no
   basis.** Refuted three ways; the scale stays until the client's mouse-axis
   magnitude is read (GUN-2b).
4. **`setHudAmmoType` is a missing extractor word / the viewer feeds 6 for all
   hand weapons.** Both false; it has been parsed and consumed all along
   (HUD-10).
5. **`0x008de480` is `IID_BFArmorOrHudAspect_c4a4`.** The dword is `0xc4c4` and
   lnxded names it `IID_IPlayerControlObjectTemplate` (VHUD-9).
6. **The fall formula without the 8.0 subtraction**, and its worked example —
   about 8× too severe at 5 m (HP-14).
7. **M3A1's gear ratio is 17.5**, and only `numberOfGears ∈ {1,5}` touches the
   curve. It is 5.512, and every gear count gets a real ratio (TANK-3).
8. **`getCurrentTorque` feeds engine sound only.** Unproven; its caller runs
   inside `updatePhysics` and `addFriction` (TANK-4).
9. **The server computes no jump** ("dead code behind an always-equal
   `0.0 == 0.0` test"). The server sets the arming bit at `0x0827d566`; the
   block is live (PHY-1).
10. **A critically damaged vehicle drives and traverses exactly as a healthy
    one** (ARM-6). A wreck takes no input and a critical vehicle traverses at
    0.2× (HP-15).
