# Aircraft bombs and torpedoes

Read 2026-09-22. What a plane's secondary weapon is, how many projectiles one
trigger pull releases, what that pull costs in ammunition, and why an aircraft
torpedo is harmless on land and lethal in water.

The ledger rows are BOMB-1…BOMB-12. The build record is
[`../../plane-bombs-and-torpedoes/README.md`](../../plane-bombs-and-torpedoes/README.md).

The short version: **a bomb rack is an ordinary `FireArms`**. Nothing about it
is special-cased in the engine. Everything below falls out of two template
fields — the barrel list and one flag — meeting code that already serves every
machine gun in the game.

---

## 1. One pull, N projectiles, N rounds

`FireArms::Fire` (lnxded `0x0828a090`) picks how many barrels to fire, and
`FireArms::fireFinished` (`0x08288470`) charges for them. They are separate
functions and they agree.

The barrel count is the size of the `addFireArmsPosition` vector, which lives at
`FireArmsTemplate+0x210`…`+0x214` and holds 12-byte elements:

```c
barrelCount = (tmpl[0x214] - tmpl[0x210]) / 12;
```

`Fire`'s dispatch on it:

| `barrelCount` | `asynchronyFire` (`tmpl+0x338`) | What fires |
|---|---|---|
| 0 | — | one `fireBarrel(-1)`, from the FireArms' own transform |
| 1 | — | one `fireBarrel(0)` |
| > 1 | clear | `for (i = 0; i < barrelCount; i++) fireBarrel(i)` — a salvo |
| > 1 | set | one `fireBarrel(counter++)`, round-robin on `this+0x296` |

And `fireFinished`'s charge, the whole of it:

```c
if (mags > 0) {
  if (tmpl[0x338] == 0 && barrelCount > 1 && tmpl[0x348] == 0) {
      mags  -= barrelCount;
      total -= barrelCount;
  } else {
      mags  -= 1;
      total -= 1;
  }
  if (mags  < 0) mags  = 0;
  if (total < 0) total = 0;
```

So **a round is spent per projectile, not per trigger pull**. A two-barrel rack
with `magSize 30` gives fifteen drops of a pair, not thirty drops.

`mags == -1` is the unlimited sentinel (ledger GUN-4) and short-circuits the
whole block, so an unlimited weapon is never charged at all.

### The partial salvo

`Fire` has a rule for the last round, above the loop:

```c
if (mags != -1 && mags < barrelCount && tmpl[0x348] == 0) {
    for (i = 0; i < mags; i++) fireBarrel(i);   // fire only what is paid for
    goto afterFire;
}
```

A dive bomber down to one round drops **one** bomb, not two, and is not allowed
to go into debt. Any implementation that decrements after firing a fixed pair
will hand out a free bomb at the bottom of every magazine.

### The two flags

`tmpl+0x338` is `asynchronyFire`. The vanilla evidence is the B17: its
`B17BombRack` declares exactly one boolean word, `setAsynchronyFire 1`, it
declares two `addFireArmsPosition` barrels, and it drops a stick one bomb at a
time rather than a pair — which requires `tmpl+0x338` to be the set flag and no
other boolean word is present to be it.

`tmpl+0x348` forces the same single-round charge *and* suppresses the partial
salvo, i.e. "the whole salvo is one shot". The only unclaimed FireArms boolean
whose name fits is `fireAllAtOnce` (string `0x086d5185`, descriptor
`0x087a4840`), so that is the reading — **`inferred`, not verified**: the
property descriptor does not carry its target offset in the vtable and the
serializer never emits the word. It does not matter for anything shipped:
`surveys/firearms_multibarrel_words.py` finds **zero** `fireAllAtOnce`
declarations across all 14 installs.

---

## 2. What the planes actually carry

Every number read out of `Objects.rfa ::
Objects/Vehicles/Air/<plane>/Weapons.con`. "Barrels" is the count of
`addFireArmsPosition` lines on the rack; "per pull" follows from §1.

| Class | Planes | Rack projectile | Barrels | Per pull | `magSize` x `numOfMag` | Pulls |
|---|---|---|---|---|---|---|
| Fighter | Corsair, Spitfire, Bf109, Mustang, Zero, Yak9 | `FighterBomb` | 0 | 1 bomb | 15 x 1 | 15 |
| Dive bomber | Stuka, Aichi Val, SBD, Ilyushin | `DiveBomberBomb` | 2, at ±3.3 on the wings | 2 bombs, −2 | 30 x 1 | 15 |
| Heavy bomber | B17 | `HeavyBomberBomb` | 2, **`setAsynchronyFire 1`** | 1 bomb, −1 | 8 x 10, `autoReload`, reload 15 s | a stick of 8 at `roundOfFire 4` |
| Torpedo | SBD-T, AichiVal-T | `AircraftTorpedo` | 0 | 1 torpedo | 15 x 1, `autoReload`, reload 10 s | 15, `roundOfFire 0.1` |

Every rack is on `setInputFire c_PIAltFire`, declares `velocity 0` (the
projectile leaves at the aircraft's own velocity and falls), and carries an
`AmmoType` — 7 on the dive bombers, 9 on the fighters and the B17. What
`AmmoType` binds to for rearm is **open**; ledger SUP-2 says it is not the HUD
enum.

The B17's pilot `PlayerControlObject` carries `B17BombRack` and no gun, so its
bombs occupy the *primary* HUD slot. Which weapon fills primary versus secondary
is ledger VHUD-10, still open.

---

## 3. The bombs

`Objects/Vehicles/Common/Weapons.con`, `create Projectile FighterBomb` and its
two siblings. All three share a shape:

| | `FighterBomb` / `DiveBomberBomb` | `HeavyBomberBomb` |
|---|---|---|
| `geometry` | `Big_Bomb_M1` | — |
| `mass` / `drag` | 250 / 0.08 | 250 / 0.08 |
| `timeToLive` | `CRD_NONE/20/0/0` | same |
| `damageType` | 1 | 1 |
| `material` / `material2` | 242 / 202 | 240 / 204 |
| `radius` | 20 | 30 |
| `YModOnExplosion` | 2.0 | 2.0 |
| `setHasPointPhysics` | 0 | 0 |
| children | two `Bomb_wing` fins | same |

`gravityModifier` is unstated and therefore 1.0 (ledger IMP-7), so a bomb falls
at the engine's −14.73 m/s². `setHasPointPhysics 0` means it is a full physics
body with the fins acting, not a point projectile.

`stopAtEndEffect 1` with `dieAfterColl 0`: the bomb survives its own collision
and is retired by the end effect.

---

## 4. The torpedo

`create Projectile AircraftTorpedo`, same file:

```
ObjectTemplate.geometry Torpedo_Sml_M1
ObjectTemplate.timeToLive CRD_NONE/20/0/0
ObjectTemplate.endEffectTemplate WaterExplosionTorpedo
ObjectTemplate.gravityModifier 1.0
ObjectTemplate.setHasPointPhysics 0
ObjectTemplate.DetonateOnWaterCollision 0
ObjectTemplate.drag 0.04
ObjectTemplate.mass 800
ObjectTemplate.material 250
ObjectTemplate.radius 30
```

plus five children: `e_WaterTorpedo`, two `Torpedo_Floater`, one
`Torpedo_Engine`, two `Torpedo_Wing`.

**It declares no `damageType`.** By ledger HP-9/HP-9d that costs it both the
impact and the end-of-life explosion payloads, so its only damage channel is
direct collision as material 250. `endEffectTemplate WaterExplosionTorpedo` is
still there — it gets the *effect*, not the damage. On land it is inert because
material 250 has no damage cell for defGroups 0 or 1.

`DetonateOnWaterCollision 0` is what lets it enter the water instead of dying on
the surface: the water contact is swallowed (collision-response.md COL-2's only
`return 0` path). Whether `detonateOnWaterCollision` reaches any other code path
is **not read** — the viewer parses it nowhere today.

Once in, three children make it run rather than sink:

```
Torpedo_Floater   FloatingBundle   hullHeight 4.3, floatMin/MaxLift 5.9, dragModifier 8000.0
Torpedo_Engine    Engine           c_ETTorpedo, torque 12.5, differential 5,
                                   maxRotation 0/0/5000, inputToRoll c_PIThrottle,
                                   automaticReset 1, noPropellerEffectAtSpeed 120
Torpedo_Wing      Wing             wingLift 0.2  (x2, one rolled -90)
```

The engine binds only `c_PIThrottle` with `automaticReset 1` and no steering
axis at all, so **there is no guidance and no homing anywhere**: a torpedo runs
straight on the heading it entered the water at. "It targets ships" is the
pilot's aim, not the weapon's.

`FloatingBundle::handleUpdate` already reaches `calculateAndClipAngle` on axis 1
(ledger GUN-2's call-site list), which is the pitch-levelling the floaters'
`setMinRotation 0/-1/0` … `setMaxRotation 0/1/0` describes. Whether
`dragModifier 8000` is the submerged drag term is **open**.

---

## 5. What this means for the viewer

`viewer/gunfire.js` drops every bomb rack before it can fire, at the emitter
guard:

```js
// Bomb racks declare no flash, no tracer and no recoil: nothing to show.
if (!emitters.length && !stats.tracer && !stats.recoil
    && !(stats.velocity > 0)) return;
```

A rack is exactly that, and `velocity 0` is the last clause. Behind it,
`#spawnProjectile`'s `group.stats.velocity || 100` would launch a zero-velocity
release at 100 m/s.

The extractor is **not** the problem: every rack is already parsed, stamped into
the shipped glb with its firing block, and `c_PIAltFire` already reaches it from
`map.html` through `world.js`. What is missing beyond the two lines above is in
the build record's gap list — no water-entry rule anywhere,
`_projectile_spec` dropping `mass`/`drag` and never walking the projectile's
children, `setAsynchronyFire` unparsed, and bomb audio hanging off the
projectile where `extract_map.py` does not walk.
