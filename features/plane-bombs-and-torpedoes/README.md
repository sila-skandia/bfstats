# Aircraft bombs and torpedoes

Research and design for the plane secondary weapon in the browser viewer
(`tools/bf1942-models/viewer/`). Investigation only; no production code was
changed.

The headline finding reverses the brief's assumption. **The extractor is not
dropping the bomb.** Every plane's bomb rack and torpedo rack is already parsed,
already stamped into the shipped `.glb` files with its full firing block and a
baked projectile mesh, and the right mouse button already writes `c_PIAltFire`
all the way from `map.html` into `world.js`. The weapon disappears in exactly one
place: a three-line guard in `gunfire.js` that refuses to build a firing group
for a weapon with no muzzle flash, no tracer, no recoil and `velocity 0` — which
is precisely what a bomb rack is.

---

## 1. Sources and method

| What | Where |
|---|---|
| Object definitions | `/home/dylan/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/Objects.rfa`, entries under `Objects/Vehicles/Air/<Plane>/` and `Objects/Vehicles/Common/` |
| Expansion planes | `.../Mods/XPack1/Archives/objects.rfa`, `.../Mods/XPack2/Archives/Objects.rfa` |
| Damage tables | `.../Mods/bf1942/Archives/bf1942/Game.rfa`, entries `Bf1942/Game/materialManagerdefine.con`, `Bf1942/Game/damage_system/*.con`, `Bf1942/Game/collision_Armor/*.con` |
| Already-derived engine facts | `/home/dylan/projects/skandia/bfstats/features/bf1942-engine-reference/ledger.md`, `symbols.json` |

Archive paths below are written `Objects.rfa :: <entry>`; line numbers are lines
of the decompressed entry. Every number in this document was read out of those
files. Nothing is inferred from a mod wiki or from another mod's documentation.

Reading method, reproducible:

```python
import sys; sys.path.insert(0, "tools/bf1942-models")
from bf42.rfa import RfaArchive
a = RfaArchive("/home/dylan/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/Objects.rfa")
print(a.read("Objects/Vehicles/Air/Stuka/Weapons.con").decode("latin-1"))
```

---

## 2. Ground truth from the game data

### 2.1 How the secondary is bound to the pilot

Every plane's bombs hang off the **pilot's** `PlayerControlObject`, not a
separate bombardier seat, and every one of them declares
`ObjectTemplate.setInputFire c_PIAltFire`. There is no bombardier position
anywhere in vanilla: the B17's two extra `PlayerControlObject`s are gun turrets.

`Objects.rfa :: Objects/Vehicles/Air/Stuka/Objects.con`

```con
  4  ObjectTemplate.create PlayerControlObject Stuka
 42  ObjectTemplate.setNumberOfWeaponIcons 2
 43  ObjectTemplate.setPrimaryAmmoIcon "Ammo/Icon_bullet.tga"
 44  ObjectTemplate.setPrimaryAmmoBar ABAmmoBar
 45  ObjectTemplate.setSecondaryAmmoIcon "Ammo/Icon_bomb.tga"
 46  ObjectTemplate.setSecondaryAmmoBar ABAmmoBarReloadBar
112  ObjectTemplate.addTemplate StukaGuns
113  ObjectTemplate.addTemplate StukaBombRack
```

`Objects.rfa :: Objects/Vehicles/Air/Stuka/Weapons.con` lines 41-53:

```con
ObjectTemplate.create FireArms StukaBombRack
ObjectTemplate.setNetworkableInfo PlaneFireArmInfo
ObjectTemplate.aiTemplate StukaBombs
ObjectTemplate.projectileTemplate DiveBomberBomb
ObjectTemplate.projectilePosition 0/-0.4/-0.2
ObjectTemplate.magSize 30
ObjectTemplate.numOfMag 1
ObjectTemplate.velocity 0
ObjectTemplate.roundOfFire 0.2
ObjectTemplate.setInputFire c_PIAltFire
ObjectTemplate.addFireArmsPosition 3.3/-0.199/0 0/0/0
ObjectTemplate.addFireArmsPosition -3.3/-0.199/0 0/0/0
ObjectTemplate.AmmoType	7
```

The **B17 is the exception**: its pilot PCO carries the bomb rack and *no gun at
all*, and the bombs therefore occupy the **primary** HUD slot while still being
bound to alt-fire.

`Objects.rfa :: Objects/Vehicles/Air/B17/Objects.con`

```con
  4  ObjectTemplate.create PlayerControlObject B17
 62  ObjectTemplate.setNumberOfWeaponIcons 1
 63  ObjectTemplate.setPrimaryAmmoIcon "Ammo/Icon_bomb.tga"
 64  ObjectTemplate.setPrimaryAmmoBar ABAmmoBarReloadBar
107  ObjectTemplate.addTemplate B17BombRack
207  ObjectTemplate.create PlayerControlObject B17_PCO1   (top turret, B17_MG1_FB)
315  ObjectTemplate.create PlayerControlObject B17_PCO2   (ball turret, B17_MG2_FB)
```

The user's "no usable primary in the pilot seat for the B17" is **confirmed**.

The two torpedo planes swap the icon but keep everything else:
`Objects/Vehicles/Air/SBD-T/Objects.con:46` and
`Objects/Vehicles/Air/AichiVal-T/Objects.con:46` both read
`ObjectTemplate.setSecondaryAmmoIcon "Ammo/Icon_torpedo.tga"`.

Ledger cross-reference: `VHUD-3` decodes the `AmmoBar` enum
(`ABAmmoBarReloadBar` = 3), `VHUD-8` confirms every seat of a multi-PCO vehicle
carries its own icon/bar words, and `VHUD-10` leaves open *which* weapon fills
primary versus secondary when `NumberOfWeaponIcons 2` — see open question O-4.

### 2.2 Per-plane secondary weapon

Every row read from `Objects.rfa :: Objects/Vehicles/Air/<plane>/Weapons.con`.
"Muzzles" is the count of `addFireArmsPosition` lines, falling back to 1 when the
template declares none (the engine then fires from `projectilePosition`).

| Plane | Secondary FireArms | `create` type | Projectile | magSize | numOfMag | Muzzles | roundOfFire | reloadTime | autoReload | asynchronyFire | Input |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Corsair | `CorsairBombDummy` | `FireArms` | `FighterBomb` | 15 | 1 | 1 | 0.2 | — | — | — | `c_PIAltFire` |
| Spitfire | `SpitfireBombDummy` | `FireArms` | `FighterBomb` | 15 | 1 | 1 | 0.2 | — | — | — | `c_PIAltFire` |
| Bf109 | `BF109BombRack` | `FireArms` | `FighterBomb` | 15 | 1 | 1 | 0.2 | — | — | — | `c_PIAltFire` |
| Mustang | `MustangBombDummy` | `FireArms` | `FighterBomb` | 15 | 1 | 1 | 0.2 | — | 1 | — | `c_PIAltFire` |
| Zero | `ZeroBombDummy` | `FireArms` | `FighterBomb` | 15 | 1 | 1 | 0.2 | — | — | — | `c_PIAltFire` |
| Yak9 | `Yak9BombDummy` | `FireArms` | `FighterBomb` | 15 | 1 | 1 | 0.2 | — | — | — | `c_PIAltFire` |
| Stuka | `StukaBombRack` | `FireArms` | `DiveBomberBomb` | 30 | 1 | **2** | 0.2 | — | — | — | `c_PIAltFire` |
| Aichi Val | `AichiValBombRack` | `FireArms` | `DiveBomberBomb` | 30 | 1 | **2** | 0.2 | — | — | — | `c_PIAltFire` |
| SBD | `SBDBombRack` | `FireArms` | `DiveBomberBomb` | 30 | 1 | **2** | 0.3 | 0.3 | — | — | `c_PIAltFire` |
| Ilyushin (Il-2) | `IlyushinBombRack` | `FireArms` | `DiveBomberBomb` | 30 | 1 | **2** | 0.3 | 0.3 | — | — | `c_PIAltFire` |
| B17 | `B17BombRack` | `FireArms` | `HeavyBomberBomb` | **8** | **10** | 2 | 4 | 15 | 1 | **1** | `c_PIAltFire` |
| SBD-T | `SBD-TBombDummy` | `FireArms` | `AircraftTorpedo` | 15 | 1 | 1 | 0.1 | 10 | 1 | — | `c_PIAltFire` |
| Aichival-T | `Aichival-TBombRack` | `FireArms` | `AircraftTorpedo` | 15 | 1 | 1 | 0.1 | 10 | 1 | — | `c_PIAltFire` |

Expansion planes, present in `viewer/models/mods/xpack1` and `.../xpack2`:

| Plane | Mod | Secondary FireArms | Projectile | magSize | numOfMag | Muzzles | roundOfFire | reloadTime | asynchronyFire |
|---|---|---|---|---|---|---|---|---|---|
| BF110 | XPack1 | `BF110BombRack` | `DiveBomberBomb` | 4 | 5 | 4 | 8 | 10 | 1 |
| Mosquito | XPack1 | `MosquitoBombRack` | `DiveBomberBomb` | 4 | 5 | 4 | 8 | 10 | 1 |
| AW52 | XPack2 | `AW52BombDummy` | `DiveBomberBomb` | 2 | 8 | 2 | 10 | 8 | 1 |
| C47 | XPack2 | `C47BombRack` | `DiveBomberBomb` | 4 | 8 | 4 | 10 | 8 | 1 |
| HO229 | XPack2 | `HO229RocketsDummy` | `HO229RocketProjectile` | 2 | 16 | 2 | 10 | 5 | 1 |
| Wasserfall | XPack2 | `WasserFallGuns` | `WasserFallProjectile` | 1 | 1 | 25 | 40 | — | — |

XPack2's Goblin, Natter, Jetpack and ParatrooperSpawner have no alt-fire
weapon. The Mustang's `autoReload 1` with no `reloadtime` is the only vanilla
plane that asks for a reload it never times — see open question O-3.

**Bombs per trigger pull, as the brief describes it:** a fighter releases 1
(one muzzle), a dive bomber releases 2 (two muzzles, no asynchrony, so both
release together), and the B17 releases a *stick* because
`setAsynchronyFire 1` makes its two racks alternate at 4 rounds/s for the 8
rounds in a magazine. The user's "about 6" for the B17 is a stick of **8**.

How `magSize` relates to that count is **settled** — one round per
projectile, so the B17's magazine is 8 bombs and a dive bomber's 30 is 15
pairs. See O-1 in §6 and ledger BOMB-1.

### 2.3 Projectile physics

All three bomb bodies and the torpedo live in one shared file,
`Objects.rfa :: Objects/Vehicles/Common/Weapons.con`.

| Field | `FighterBomb` (L96-124) | `DiveBomberBomb` (L128-156) | `HeavyBomberBomb` (L160-188) | `AircraftTorpedo` (L49-92) |
|---|---|---|---|---|
| `geometry` | `Big_Bomb_M1` | `Big_Bomb_M1` | `Big_Bomb_M1` | `Torpedo_Sml_M1` |
| `mass` | 250 | 250 | 250 | 800 |
| `drag` | 0.08 | 0.08 | 0.08 | 0.04 |
| `gravityModifier` | not declared (engine default 1.0) | not declared | not declared | `1.0` |
| `timeToLive` | `CRD_NONE/20/0/0` | 20 s | 20 s | 20 s |
| `setHasPointPhysics` | 0 | 0 | 0 | 0 |
| `hasCollisionPhysics` / `hasResponsePhysics` | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |
| `stopAtEndEffect` | 1 | 1 | 1 | not declared |
| `dieAfterColl` | 0 | 0 | 0 | not declared (engine default 1) |
| `hasCollisionEffect` | 1 | 1 | 1 | 1 |
| `endEffectTemplate` | — | — | — | `WaterExplosionTorpedo` |
| `DetonateOnWaterCollision` | — | — | — | **0** |
| `loadSoundScript` | `../air/common/Sounds/Bomb.ssc` | same | same | — |
| sub-templates | `Bomb_wing` x2 | `Bomb_wing` x2 | `Bomb_wing` x2 | `e_WaterTorpedo`, `Torpedo_Floater` x2, `Torpedo_Engine`, `Torpedo_Wing` x2 |

`Bomb_wing` is `ObjectTemplate.create Wing Bomb_wing` / `setWingLift 0.2`
(same file, L192-193) — the tail fins that keep a released bomb pointed along
its velocity.

`gravityModifier` defaults to 1.0 and scales **-14.73 m/s²**
(`ledger.md` IMP-7, `ProjectileTemplate` ctor lnxded `0x0831f8d0`, `+0x164`).
The viewer's `physics.js:67` already holds the same constant.

`ledger.md` IMP-7 also records that the projectile's own update integrates
nothing; the physics body does. With `setHasPointPhysics 0` these rounds take
the `ResponsePhysics` path, which is what `contact-response.js` already models
for grenades.

### 2.4 Explosion and damage payload

The damage system is already fully extracted; nothing new has to be derived.
`bf42/damage.py` reads `Game.rfa` and `viewer/maps/_shared/damage.json` and
`viewer/models/damage.json` already ship the tables.

Formula, from `bf42/damage.py`'s module docstring and `ledger.md` HP-9:

```
direct = materialDamage(att)  * damageMod(att,  defMaterial) * cos(incidence) * distanceMod
splash = materialDamage(att2) * damageMod(att2, defMaterial) * (1 - d/radius) * exposure
```

| Projectile | `damageType` | direct `material` | base dmg | splash `material2` | base dmg | `radius` | `YModOnExplosion` |
|---|---|---|---|---|---|---|---|
| `FighterBomb` | 1 | 242 | 10 | 202 | 10 | 20 | 2.0 |
| `DiveBomberBomb` | 1 | 242 | 10 | 202 | 10 | 20 | 2.0 |
| `HeavyBomberBomb` | 1 | 240 | 7 | 204 | 20 | 30 | 2.0 |
| `AircraftTorpedo` | **not declared** | 250 | 20 | **not declared** | — | 30 | — |

Base damages from `Game.rfa :: Bf1942/Game/materialManagerdefine.con` lines
608-611 (202), 618-621 (204), 825-828 (240), 835-838 (242), 879-882 (250, also
labelled `NAVAL GUNS`).

Because `damageType 1` **and** `hasCollisionEffect 1` are both set, the three
bombs take the *impact* explosion path, not the fuse path
(`ledger.md` HP-9d; `effects-core.js:733` `splashSpec` already implements
exactly this test). The torpedo declares **no `damageType` at all**, so it gets
neither explosion. See §2.5.

Worked damage, using `viewer/models/damage.json` and the vanilla target
materials (`ObjectTemplate.material` on each vehicle's `Objects.con`; soldier is
40, jeep/PT boat/LCVP 45, tank 50, capital ship/carrier/destroyer 55,
submarine 57, plane 60):

| Attack | vs soldier (40) | vs jeep/PT (45) | vs tank (50) | vs ship (55) | vs plane (60) |
|---|---|---|---|---|---|
| Bomb direct, 242 | 10 x 4.0 = **40** | x 20.0 = 200 | x 20.0 = 200 | x 5.0 = 50 | x 20.0 = 200 |
| Bomb splash, 202 (at d=0) | 10 x 7.0 = **70** | x 8.0 = 80 | x 6.0 = 60 | **no cell = 0** | x 10.0 = 100 |
| Heavy bomb direct, 240 | 7 x 20.0 = 140 | x 10.0 = 70 | x 10.0 = 70 | x 8.0 = 56 | x 20.0 = 140 |
| Heavy bomb splash, 204 (at d=0) | 20 x 12.0 = **240** | x 3.0 = 60 | x 3.5 = 70 | **no cell = 0** | x 4.0 = 80 |
| Torpedo direct, 250 | 20 x 6.0 = 120 | x 4.0 = 80 | x 5.0 = 100 | x 7.0 = **140** | x 15.0 = 300 |

A vanilla soldier has 30/30 HP, so any of these kills outright. Note the two
"no cell" entries: **bomb splash does nothing at all to a ship**; a bomb has to
hit the hull directly. That is DMG-1's fallback rule, already implemented in
`effects-core.js:889` `splashDamage`, which returns 0 for a missing cell.

Impact effect bundles come from the same table
(`damage.json.effects[attacker][defender]`, `ledger.md` IMP-2): material 242
resolves `BombSmall_Expl` on soil, `BombSmallNS_Expl` on armour and on water
(defGroup 1) it resolves `WaterWaterExplosion`; material 240 resolves
`e_Explani02` / `MajorImpact_Sand` / `MajorImpact_Stone` on terrain and
`e_ExplArmor` on vehicles; material 250 resolves `BombBig_Expl` for every
defGroup it has a cell for — and, tellingly, has **no cell at all for
defGroups 0 or 1**.

### 2.5 Torpedo: water entry, the run, and why it is inert on land

Four separate data facts combine into the behaviour the brief describes.

**(a) It never explodes, ever.** `AircraftTorpedo` declares no `damageType`.
Per `ledger.md` HP-9/HP-9d the impact explosion needs
`damageType == 1 && hasCollisionEffect` and the end-of-life explosion needs
`damageType in {1,4}`. The torpedo satisfies neither. Its only damage channel is
**direct collision** with material 250. `WaterExplosionTorpedo` is an
`endEffectTemplate` — a visual bundle played when the 20 s `timeToLive` expires
(`Objects/Effects/Common/effects.con:164`: `e_waterImpact` + `e_explWater01` +
`e_ExplBoatArmor`) — not a damage source.

**(b) It does not detonate when it enters the water.**
`ObjectTemplate.DetonateOnWaterCollision 0`
(`Objects/Vehicles/Common/Weapons.con:60`). `features/bf1942-blast-and-bounce/README.md`
§2 (COL-2) records the matching engine fact: `Projectile::handleCollision`
(`0x0831ee80`) changes no velocity, and its **only `return 0` path is a water
contact without `detonateOnWaterCollision`** (`+0x1ac`, tested at
`0x0831f3ae`). So the water contact is swallowed and the torpedo keeps going.

**(c) Once in the water it floats and drives itself.** The torpedo carries four
sub-objects, all defined in
`Objects.rfa :: Objects/Vehicles/Common/Physics.con`:

```con
  1  ObjectTemplate.create Engine Torpedo_Engine
 13  ObjectTemplate.setEngineType c_ETTorpedo
 14  ObjectTemplate.setTorque 12.5
 15  ObjectTemplate.setNoPropellerEffectAtSpeed 120
 16  ObjectTemplate.setDifferential 5
  9  ObjectTemplate.setMaxSpeed 0/0/10000
 10  ObjectTemplate.setAcceleration 0/0/10000
 12  ObjectTemplate.setInputToRoll c_PIThrottle

 20  ObjectTemplate.create FloatingBundle Torpedo_Floater
 22  ObjectTemplate.setHullHeight 4.3
 23  ObjectTemplate.setFloatMaxLift 5.9
 24  ObjectTemplate.setFloatMinLift 5.9
 25  ObjectTemplate.setDragModifier 8000.0
 26  ObjectTemplate.setMinRotation 0/-1/0
 27  ObjectTemplate.setMaxRotation 0/1/0
 30  ObjectTemplate.setInputToPitch 1

 34  ObjectTemplate.create Wing Torpedo_Wing
 35  ObjectTemplate.setWingLift 0.2
```

Two `Torpedo_Floater`s at `0/3/-2` and `0/3/2` (i.e. 3 m *above* the hull
centre, so the buoyancy couple pulls the nose level), a `Torpedo_Engine` and two
`Torpedo_Wing`s at the tail. `features/bf1942-3d-models/ground-vehicles.md:839-844`
already has the engine half: `c_ETTorpedo` is engine-type flag `0x19`, and
`Engine::handleUpdate`'s `& 0x10` branch **pins the throttle at 1.0** for
rocket and torpedo engines. There is no throttle input and no steering — the
torpedo runs flat out, straight ahead, levelled by the floaters and the wings.
`symbols.json` has `FloatingBundle::handleUpdate` at `0x082401cd`.

There is no guidance or homing of any kind. `features/bf1942-3d-models/parity-gaps.md:142`
states it plainly: *"no guided weapon in the engine"*.

**(d) On land it lands, slides and does nothing.** With no explosion and a
damage table (material 250) that has **no cell for defGroup 0 (Default) or 1
(Water)**, a torpedo that hits dirt produces no damage and no impact effect
lookup. It has no floater lift out of water, no throttle from `c_ETTorpedo`
without a fluid, and `dieAfterColl` unset (engine default 1) recycles it on
the first hull contact. It is inert by construction, not by a special case.

**The wake.** `ObjectTemplate.addTemplate e_WaterTorpedo` is the running effect:

`Objects.rfa :: Objects/Effects/e_WaterTorpedo/Effects.con`

```con
  4  ObjectTemplate.create EffectBundle e_WaterTorpedo
  7  ObjectTemplate.addTemplate Em_WaterTorpStreak
 11  ObjectTemplate.minDistanceUnderwaterSurface 0
 12  ObjectTemplate.maxDistanceUnderwaterSurface 50
 16  ObjectTemplate.create Emitter Em_WaterTorpStreak
 24  ObjectTemplate.moveToWaterSurface 1
```

`minDistanceUnderwaterSurface 0` / `maxDistanceUnderwaterSurface 50` is the
engine's own gate: the wake plays only while the torpedo is between 0 and 50 m
below the surface. `moveToWaterSurface 1` lifts the streak particles up to the
water plane (`symbols.json` has `EmitterTemplate` `moveToWaterSurface` at
`+0x4dd`). That pair is a ready-made "am I running in water" test that the
viewer can reuse verbatim.

### 2.6 The bomb release sound

`Objects.rfa :: Objects/Vehicles/Air/Common/Sounds/Bomb.ssc`, referenced from
each bomb projectile's `loadSoundScript` (three times in
`Objects/Vehicles/Common/Weapons.con`, lines 98, 130, 162). Four patches:

1. Looping in-flight whistle: `Sound/shellair.wav`, `Sound/Shellwhine.wav`,
   `Sound/haxxar.wav`, all `loop`, with `Distance`-ramped volume out to 190 m.
2. Release: `Sound/bmbreal1.wav` or `bmbreal3.wav`, `randomPlay 1`,
   `relativePosition 0/0/2`, `dopplerOff`.
3. A delayed `Sound/bmbreal2.wav` at `+0.3 s`.

This sits on the **projectile**, not on the FireArms, which is why
`extract_map.py`'s `find_weapon_scripts` (line 326) misses it — see §4.

---

## 3. What the repo already has

### 3.1 The extractor already emits everything except three physics words

`bf42/con.py` parses every field the racks use: `fire_arms_positions`
(L730), `projectile_template`, `projectile_position`,
`visible_dummy_projectile_template` (L735), `input_fire` (L741),
`round_of_fire`, `mag_size` (L745), `num_of_mag`, `mag_type`, `reload_time`,
`auto_reload`, plus the projectile's `material`, `material2`, `radius`,
`damage_type`, `has_collision_effect`, `die_after_coll`, `y_mod_on_explosion`,
`end_effect_template`, `gravity_modifier`, `time_to_live`, `mass` (L902),
`drag` (L903).

`bf42/assemble.py::_fire_arms` (L1545) stamps the whole block into the GLB node
as `extras.fireArms` (assigned at L2323), and `_projectile_spec` (L1420) builds
the typed projectile dict and bakes the drawn body as a hidden node with
`extras.projectileMesh`.

Verified against the shipped files. `viewer/models/Stuka.glb`, node
`StukaBombRack`:

```json
{"projectile": {"template": "DiveBomberBomb", "kind": "shell", "trail": null,
                "timeToLive": 20.0, "material": 242,
                "damage": {"radius": 20.0, "material2": 202, "damageType": 1,
                           "hasCollisionEffect": true, "dieAfterColl": false,
                           "yModOnExplosion": 2.0}},
 "roundOfFire": 0.2, "magSize": 30, "numOfMag": 1, "velocity": 0.0,
 "input": "c_PIAltFire", "control": "Stuka", "muzzles": 2}
```

with sibling nodes `StukaBombRack muzzle 1` at `[3.3, -0.199, -0.0]`,
`StukaBombRack muzzle 2` at `[-3.3, -0.199, -0.0]`, and
`StukaBombRack projectile` carrying
`{"projectileMesh": {"template": "DiveBomberBomb", "geometry": "Big_Bomb_M1"}}`.

`viewer/models/Aichival-T.glb`, node `Aichival-TBombRack`:

```json
{"projectile": {"template": "AircraftTorpedo", "kind": "shell", "trail": null,
                "timeToLive": 20.0, "gravity": 1.0, "material": 250,
                "damage": {"radius": 30.0, "hasCollisionEffect": true},
                "trailBundle": "e_WaterTorpedo",
                "endEffect": "WaterExplosionTorpedo"},
 "roundOfFire": 0.1, "magSize": 15, "numOfMag": 1, "reloadTime": 10.0,
 "autoReload": true, "velocity": 0.0, "input": "c_PIAltFire",
 "control": "Aichival-T", "muzzles": 1}
```

with `projectileMesh` = `{"template": "Aichival-TDummyTorpedo", "geometry": "Torpedo_Sml_m1"}`.

`viewer/models/damage.json` carries the tables and, in its `weapons` list,
every bomb rack with `material`, `material2`, `radius`, `damageType`,
`magSize`, `roundOfFire` (emitted by `bf42/damage.py::collect_weapons`, L516,
whose own docstring says "FireArms, HandFireArms, grenades, **bomb racks**").
`viewer/maps/_shared/damage.json`'s `projectiles` map already holds
`fighterbomb {material:242}`, `divebomberbomb {material:242}`,
`heavybomberbomb {material:240}`, `aircrafttorpedo {material:250}`.

`viewer/models/models.json` lists the rack among each plane's `weapons`
(`Stuka: ["MG42_Air", "StukaBombRack", "StukaGuns"]`), and
`viewer/models/Stuka.report.json` has
`"[Stuka] StukaBombRack: 2 muzzle(s), 0.2 rps, projectile shell"`.

**What the extractor does drop** (all present in `.con`, none reaching JSON):

| Field | Where it is dropped | Needed for |
|---|---|---|
| `mass`, `drag` on a Projectile | `bf42/assemble.py::_projectile_spec` (L1420) never copies `projectile.mass` / `projectile.drag` into `spec` | ballistic fall rate, torpedo water drag |
| `setHasPointPhysics` | not parsed anywhere in `bf42/con.py` | choosing the response-physics path |
| `DetonateOnWaterCollision` | not parsed anywhere in `bf42/con.py` | the single fact that defines torpedo water entry |
| `stopAtEndEffect` | not parsed | nothing yet; record for completeness |
| `setAsynchronyFire` | not parsed | the B17's alternating stick |
| Projectile sub-templates (`Bomb_wing`, `Torpedo_Floater`, `Torpedo_Engine`, `Torpedo_Wing`) | `_projectile_spec` does not walk the projectile's children | torpedo buoyancy and self-propulsion, bomb fin alignment |
| The projectile's own `loadSoundScript` | `extract_map.py::find_weapon_scripts` (L326) walks FireArms, and its own comment says "a bomb rack has no sound script and simply does not appear" | release and whistle audio |

`features/bf1942-3d-models/parity-gaps.md:178` (gap 4) already names the same
hole from the other side: *"No `mass`, `drag`, `setTorque`, gearbox, buoyancy or
lift value is exported."*

### 3.2 The viewer input path is already complete

| Step | File:line | What it does |
|---|---|---|
| Mouse button | `viewer/map.html:2937` `buttonChange`, L2946-2954 | seated: left button sets `seatFire`, right sets `seatAltFire` |
| Into the tick | `viewer/map.html:13514-13515` | `{ fire: held.has('Space') \|\| seatFire, altFire: seatAltFire }` |
| Into the vehicle | `viewer/world.js:813-814` | `vehicle.setInput('c_PIFire', ...)`, `vehicle.setInput('c_PIAltFire', ...)` |
| Per-weapon routing | `viewer/world.js:853-857` | `guns.setFiring(group, vehicle.input(group.stats.input \|\| 'c_PIFire') > 0 && state.canFire)` |
| Manned-seat guns | `viewer/world.js:866-876` | same, keyed on `node.userData.fireArms.input` |

`features/bf1942-3d-models/seats-and-manned-guns.md:345-359` states the
consequence outright: *"A Corsair gets the pair for free: its guns declare the
first and its bombs the second."*

### 3.3 The projectile, blast and water machinery already exists

| Need | Existing API |
|---|---|
| Ballistic integration | `viewer/gunfire.js:1546-1607`; `shot.velocity.y += GRAVITY * shot.gravity * shot.gravityScale * dt` with `GRAVITY = -14.73` from `viewer/physics.js:67` |
| Segment cast against water, terrain and hulls | `viewer/collision.js:1328` `WorldCollider.cast(ox,oy,oz,dx,dy,dz,maxDist,skipOwner)` — tests the water plane first (L1338-1342) and returns `kind: 'water'`, `material: 1` |
| Water surface height | `viewer/collision.js:1273` `surfaceHeight(x,z)`; `collider.waterLevel`; `WATER_MATERIAL = 1` at L41 |
| Hull-in-water test | `viewer/body-world.js:232` `touchesWater(entry, originY, waterLevel)`; `viewer/body-ground.js:123` water branch of `terrainContact` |
| Impact damage | `viewer/gunfire.js:1063` `#impact` — `base * mod * incidence * factor` |
| Splash damage | `viewer/effects-core.js:889` `splashDamage(material2, splashMaterial, distance, radius, materials, modifiers, exposure)`; `blastDistance(dx,dy,dz,yMod)` at L649 applies `YModOnExplosion` to the Y term only |
| Splash gating | `viewer/effects-core.js:733` `splashSpec(damage)` returns `{impact, endOfLife, ...}` with `impact = damageType === 1 && hasCollisionEffect` |
| Applying it | `viewer/vehicle-damage.js:395` `VehicleDamageSet.applySplash(record, targets, {materials, modifiers, exposure})`, driven from `viewer/map.html:6121` `applyVehicleHit` |
| Soldier exposure | `viewer/map.html:6106` `soldierExposureFor` (HP-10's 3/9/9 ray sampling) |
| Effect playback | `viewer/effects.js:255` `EffectPlayer.play(name, {position, normal, attach, speed})`; name from `viewer/collision.js:1485` `impactEffect(effects, attacker, defenderMaterial)` |
| Resting/bouncing bodies | `viewer/contact-response.js:447` `FuseRoundBody` |
| Ammo, magazines, reload, heat | `viewer/seats.js:918` `class FireState` — already reads `magSize`, `numOfMag`, `reloadTime`, `autoReload` |
| HUD ammo | `viewer/map.html:7293-7359` `feedVehicleHud` writes `Ammo/PrimaryAmmo*`, `Ammo/SecondaryAmmo*`, `Ammo/ReloadTimeSecondary`; slots are positional `nodes[0]`/`nodes[1]` from `viewer/seats.js:402` `activeFireArmsNodes()` |
| Headless blast injector for testing | `viewer/map.html:14617` `window.__blast(point, {radius, material2, yMod, firer})` |

---

## 4. The gap

### G-1 (blocking). `gunfire.js` refuses to build the group

`viewer/gunfire.js:484-486`:

```js
// Bomb racks declare no flash, no tracer and no recoil: nothing to show.
if (!emitters.length && !stats.tracer && !stats.recoil
    && !(stats.velocity > 0)) return;
```

A bomb rack has zero emitters, no `tracer`, no `recoil`, and `velocity: 0.0`.
`!(0 > 0)` is true, the early `return` fires, no group is created, and
`world.js:853` has nothing to call `setFiring` on. This one guard is why no
plane in the viewer has ever dropped a bomb. The comment is describing exactly
the case it is wrongly excluding.

### G-2 (blocking). A zero-velocity release becomes a 100 m/s launch

`viewer/gunfire.js:872`:

```js
const authored = group.stats.velocity || 100;
```

`velocity: 0.0` is falsy. Lift G-1 alone and a bomb would be fired forward at
100 m/s. A released bomb must start at **zero muzzle velocity plus the
platform's velocity**. `group.platformVelocity` already exists and is supplied
for vehicle groups (`viewer/map.html:6327`, `6383`).

### G-3. No water-entry rule for a projectile

`collider.cast` already returns `kind: 'water'`, and `#impact` currently treats
that as the end of the round. There is no notion of `detonateOnWaterCollision`
anywhere in the pipeline — the field is not parsed and not consumed.
`features/bf1942-3d-models/projectile-collision.md` lists it as an open item, and
`features/bf1942-blast-and-bounce/README.md` lines 382-383 records the
divergence explicitly: *"a fuse round returns true on everything but an
un-flagged water contact. The viewer runs the contact unconditionally."*

### G-4. No buoyancy or self-propulsion for a projectile

`_projectile_spec` never walks the projectile's `addTemplate` children, so the
torpedo's `Torpedo_Floater`, `Torpedo_Engine` and `Torpedo_Wing` do not reach
the viewer. `bf42/con.py` already knows how to serialise a `FloatingBundle`
(`hullHeight`, `floatMaxLift`, `floatMinLift`, `sinkingSpeedMod`,
`dragModifier` — `as_dict`, L1348-1356) and an `Engine`; the data is one
traversal away.

### G-5. No bomb release or whistle audio

`extract_map.py::find_weapon_scripts` (L326) only walks FireArms sound scripts;
the bomb's `.ssc` is on the projectile. Its own comment already flags this.

### G-6. `setAsynchronyFire` is not parsed

The B17, BF110, Mosquito, AW52, C47 and HO229 all set it. Without it a stick
becomes a simultaneous salvo.

---

## 5. Design

### 5.1 Extractor changes

**File: `tools/bf1942-models/bf42/con.py`**

Add three fields to `ObjectTemplate` beside the existing projectile block
(around L759-800):

```python
has_point_physics: bool | None = None          # setHasPointPhysics
detonate_on_water_collision: bool | None = None # DetonateOnWaterCollision
stop_at_end_effect: bool | None = None          # stopAtEndEffect
```

and one to the FireArms block (around L741):

```python
asynchrony_fire: bool | None = None             # setAsynchronyFire
```

Register all four in the command dispatch alongside `damagetype` (L2063) and
`magsize` (L2132). They are ordinary `0/1` ints.

**File: `tools/bf1942-models/bf42/assemble.py`**

1. In `_projectile_spec` (L1420), extend `spec` with the body words and the
   water flag:

   ```python
   for key, value in (("mass", projectile.mass), ("drag", projectile.drag),
                      ("hasPointPhysics", projectile.has_point_physics),
                      ("stopAtEndEffect", projectile.stop_at_end_effect)):
       if value is not None:
           spec[key] = value
   ```

   and put `detonateOnWaterCollision` inside the existing `damage` dict, where
   `dieAfterColl` and `hasCollisionEffect` already live — it belongs to the same
   "what happens on contact" group.

2. In `_projectile_spec`, walk the projectile's `addTemplate` children and emit
   a `parts` list for the ones that change its flight. Reuse
   `con.ObjectTemplate.as_dict()`, which already serialises `FloatingBundle`
   and `Wing`:

   ```python
   parts = []
   for ref in projectile.children:
       name = con_mod.instance_template_name(ref, self.library.object)
       child = self.library.object(name) if name else None
       if child is None or child.kind.lower() not in ("floatingbundle", "wing", "engine"):
           continue
       parts.append({"template": child.name, "kind": child.kind,
                     "position": list(ref.position), "rotation": list(ref.rotation),
                     **(child.as_dict().get("physics") or {})})
   if parts:
       spec["parts"] = parts
   ```

3. In `_fire_arms` (L1545), add `"asynchronyFire": template.asynchrony_fire` to
   the `extras` dict beside `"muzzles"` (L1646).

4. Keep `projectilePosition` when `addFireArmsPosition` is also present. Today
   the muzzle list (L1560) discards `projectile_position` whenever
   `fire_arms_positions` is non-empty, which loses the Stuka's `0/-0.4/-0.2`
   drop offset. Emit it as `extras.fireArms.projectilePosition` and let the
   viewer add it to the muzzle node's position.

**File: `tools/bf1942-models/extract_map.py`**

In `find_weapon_scripts` (L326), after walking the FireArms, also resolve
`template.projectile_template` and take *its* `loadSoundScript`. That pulls
`Objects/Vehicles/Air/Common/Sounds/Bomb.ssc` into the per-map sound set.

**Resulting JSON shape.** Nothing new is created; the existing
`extras.fireArms` block on each rack node grows:

```json
{
  "projectile": {
    "template": "AircraftTorpedo",
    "kind": "shell",
    "timeToLive": 20.0,
    "gravity": 1.0,
    "material": 250,
    "mass": 800.0,
    "drag": 0.04,
    "hasPointPhysics": false,
    "damage": { "radius": 30.0, "hasCollisionEffect": true,
                "detonateOnWaterCollision": false },
    "trailBundle": "e_WaterTorpedo",
    "endEffect": "WaterExplosionTorpedo",
    "parts": [
      { "template": "Torpedo_Floater", "kind": "FloatingBundle",
        "position": [0, 3, -2], "rotation": [0, 0, 0],
        "hullHeight": 4.3, "floatMaxLift": 5.9, "floatMinLift": 5.9,
        "dragModifier": 8000.0 },
      { "template": "Torpedo_Floater", "kind": "FloatingBundle",
        "position": [0, 3, 2], "rotation": [0, 0, 0], "...": "..." },
      { "template": "Torpedo_Engine", "kind": "Engine",
        "position": [0, 0, -3], "engineType": "c_ETTorpedo",
        "torque": 12.5, "differential": 5.0,
        "maxSpeed": [0, 0, 10000], "acceleration": [0, 0, 10000] },
      { "template": "Torpedo_Wing", "kind": "Wing",
        "position": [0, 0, -3], "wingLift": 0.2 },
      { "template": "Torpedo_Wing", "kind": "Wing",
        "position": [0, 0, -3], "rotation": [0, 0, -90], "wingLift": 0.2 }
    ]
  },
  "roundOfFire": 0.1, "magSize": 15, "numOfMag": 1,
  "reloadTime": 10.0, "autoReload": true, "asynchronyFire": null,
  "velocity": 0.0, "projectilePosition": [0, -1, 0],
  "input": "c_PIAltFire", "control": "Aichival-T", "muzzles": 1
}
```

Re-extraction is required for the new fields
(`python3 tools/bf1942-models/extract_all.py --mod bf1942 --out tools/bf1942-models/viewer/models --configuration-all -j 16`,
then `--thumbs` as usual), but **every step below except the torpedo run works
against the GLBs that are already on disk.**

### 5.2 Viewer changes

Ordered by dependency. Steps 1-4 are enough for bombs on every plane.

**Step 1 — let the group exist. `viewer/gunfire.js`, `collect()`, L484-486.**

Replace the "nothing to show" guard with one that also admits a weapon that
launches a drawn body:

```js
// A bomb rack has no flash, no tracer and no recoil, and releases at zero
// muzzle velocity -- it is still a weapon. Keep the guard for the genuinely
// inert templates, but never drop something that has a projectile to draw.
const launches = !!(stats.projectile && (stats.projectile.kind !== 'bullet'
                                         || stats.velocity > 0));
if (!launches && !emitters.length && !stats.tracer && !stats.recoil
    && !(stats.velocity > 0)) return;
```

**Step 2 — release at zero. `viewer/gunfire.js`, `#spawnProjectile`, L872.**

```js
const authored = group.stats.velocity ?? 100;
```

and make `#muzzleVelocity` (L717) treat `speed === 0` as "inherit the
platform": the shot's world velocity becomes `group.platformVelocity` alone,
with no forward component and no `#wander` spread. Everything downstream
already works: `spec.kind === 'shell'` routes to `#spawnProjectile` at L671,
`gravity` resolves to 1 at L916 (bombs declare no `gravityModifier`; the
torpedo declares `1.0`), and `advance` integrates it at L1568 against
`GRAVITY = -14.73`.

**Step 3 — aerodynamic drag and fin alignment. `viewer/gunfire.js`, `advance()`, around L1546-1607.**

Bombs declare `drag 0.08` and `mass 250`; the viewer currently integrates
gravity alone. Add a drag term for shells that carry `spec.drag`, and keep the
existing `mesh.lookAt(position - velocity)` nose alignment, which is already
what `Bomb_wing`'s `setWingLift 0.2` achieves in the engine. A bomb dropped at
150 m/s from 500 m is the reference case to eyeball.

**Step 4 — impact, explosion and damage.** No new code. `#impact` (L1063)
already computes the direct hit with material 242/240, and
`splashSpec(spec.damage).impact` is true for all three bombs
(`damageType 1` + `hasCollisionEffect`), so `#impact` already sets
`record.blast = 'impact'`, `splashMaterial2`, `splashRadius = 20` or `30`,
`splashYMod = 2.0` and `splashPoint`. `applyVehicleHit` (`map.html:6121`) runs
`VehicleDamageSet.applySplash`. The effect name resolves through
`impactEffect(this.damageEffects, 242, hit.material)` to `BombSmall_Expl` /
`BombSmallNS_Expl` / `WaterWaterExplosion` and plays through `EffectPlayer`.
**Verify rather than build** — the plumbing is live for tank shells today.

**Step 5 — ammo, rearm and HUD.** `viewer/seats.js:918` `FireState` already
consumes `magSize`, `numOfMag`, `reloadTime`, `autoReload`. Once the group
exists, `world.js:855`'s `state.canFire` gates the rack automatically. Two
touches needed:

- `FireState.step` must handle `autoReload` with **no** `reloadTime` (the
  Mustang) — see O-3.
- `viewer/map.html:7293-7359` `feedVehicleHud` already writes
  `Ammo/SecondaryAmmo`, `Ammo/MaxSecondaryAmmo`, `Ammo/SecondaryAmmoText` and
  `Ammo/ReloadTimeSecondary` from `fireStateFor(nodes[1])`. The B17 needs the
  positional `nodes[0]`/`nodes[1]` mapping checked: its bomb rack is the plane's
  *only* pilot weapon and belongs in the **primary** slot. Prefer sorting
  `activeFireArmsNodes()` by `input` (`c_PIFire` first, then `c_PIAltFire`)
  rather than by declaration order; that gives the correct slot for every plane
  in the table, B17 included.

**Step 6 — asynchronous release (the B17 stick).** `fireShot` (L641) already
round-robins muzzles with `group.shots % group.muzzles.length`. With
`asynchronyFire` present, that is the correct behaviour. Without it, a
multi-muzzle rack should fire **all** muzzles in one `fireShot` call. So the
change is: when `stats.asynchronyFire` is falsy and `muzzles.length > 1`,
loop over every muzzle in one shot. That gives the dive bombers their pair and
the B17 its alternating stick, from data.

**Step 7 — the torpedo water run.** The only genuinely new mechanic. A new
module is warranted rather than growing `gunfire.js`:
`viewer/torpedo-run.js`, modelled on `viewer/contact-response.js`'s
`FuseRoundBody`.

- `GunFire.#impact` gains a pre-check: when `hit.kind === 'water'` and the
  round's `damage.detonateOnWaterCollision` is false, **do not end the round**.
  This is COL-2's `return 0` path, and it closes the divergence
  `features/bf1942-blast-and-bounce/README.md` lines 382-383 already records.
  Bombs are unaffected: they declare no `detonateOnWaterCollision`, so absent
  means "behave as now".
- On the first water contact, hand the shot to a `TorpedoRun` that replaces
  ballistic integration with: buoyancy from the two `FloatingBundle` parts
  (`floatMaxLift 5.9`, `hullHeight 4.3`, `dragModifier 8000` while submerged),
  a fixed forward thrust from the `c_ETTorpedo` engine (throttle pinned at 1.0
  per `ground-vehicles.md:844`), levelling from the two `Wing` parts, and
  `drag 0.04`. Depth is `collider.waterLevel - y`.
- Per-frame it still calls `collider.cast` for the segment flown, so a hull
  contact resolves through the existing `#impact` with material 250 and kills
  a ship by **direct damage only** — no splash, because `AircraftTorpedo`
  declares no `material2`.
- The wake: play `spec.trailBundle` (`e_WaterTorpedo`) and gate it on depth in
  `[0, 50]` m, exactly as `minDistanceUnderwaterSurface` /
  `maxDistanceUnderwaterSurface` do. `effects.js`'s `EffectPlayer.play` already
  takes `attach`.
- At `timeToLive` expiry (20 s) `#detonate` (L1191) plays
  `spec.endEffect` = `WaterExplosionTorpedo` with `record.damage = null`.
  Correct as-is: the torpedo has no `damageType`, so no explosion damage.
- On land: nothing special. With no `damageType` and no damage cell for
  defGroups 0/1, the existing `#impact` yields zero damage and no effect
  lookup, and `dieAfterColl` recycles it. **Verify** rather than special-case.

**Step 8 — audio.** Once `extract_map.py` picks up `Bomb.ssc`, wire the release
patch to `fireShot` and the looping whistle patches to the in-flight shot,
through `viewer/effect-audio.js`'s `EffectAudio`. The `.ssc` has
`dopplerOff` on the release and `Distance`-ramped volume on the whistle; both
are already modelled concepts in `effect-audio.js` (`audibleAt`,
`scriptPriority`).

### 5.3 Test hooks that already exist

- `window.__blast(point, {radius, material2, yMod, firer})` at
  `viewer/map.html:14617` runs the real splash path headlessly. For a fighter
  bomb: `{radius: 20, material2: 202, yMod: 2}`. For a heavy bomb:
  `{radius: 30, material2: 204, yMod: 2}`.
- Headless fire setters at `viewer/map.html:14328-14330` for `seatFire` /
  `seatAltFire`.
- The viewer-headless verification pattern (`?shots` + `__renderOnce` + pixel
  sampling) applies for the visual half.

---

## 6. Open questions

**O-1 is SETTLED (2026-09-22): one round per projectile.** Read out of the
binary, and now in the corpus as ledger BOMB-1…BOMB-5 with
[`../bf1942-engine-reference/subsystems/bombs-and-torpedoes.md`](../bf1942-engine-reference/subsystems/bombs-and-torpedoes.md)
as the narrative. The spend is in `FireArms::fireFinished` (lnxded
`0x08288470`) — not in `Fire`, and not in `fireBarrel`, which touches no
counter:

```c
barrelCount = (tmpl[0x214] - tmpl[0x210]) / 12;      // the addFireArmsPosition vector
if (mags > 0) {
  if (tmpl[0x338] == 0 && barrelCount > 1 && tmpl[0x348] == 0) mags -= barrelCount;
  else                                                          mags -= 1;
  if (mags < 0) mags = 0;
```

`FireArms::Fire` `0x0828a090` spawns to match — `for (i = 0; i < barrelCount;
i++) fireBarrel(i)`. So a Stuka is **15 releases, 30 bombs**, and one pull takes
its counter from 30 to 28. The guess that the dive bombers' 30 is "twice the
fighters' 15 for twice the muzzles" was right, for the right reason.

Two rules came with it that the tables above do not capture, and both change
code:

- **The partial salvo** (BOMB-5). With `mags < barrelCount`, `Fire` fires only
  `mags` barrels. A dive bomber on its last round drops **one** bomb, not two.
  Firing a fixed pair and decrementing afterwards hands out a free bomb at the
  bottom of every magazine.
- **`asynchronyFire` is `tmpl+0x338`** (BOMB-3), and it charges one round, not
  `barrelCount`. The B17's stick is 8 bombs from `magSize 8`, one barrel at a
  time off a counter at `FireArms+0x296`.

The third flag in that expression, `tmpl+0x348`, is read as `fireAllAtOnce` at
`inferred` only (BOMB-4) — the descriptor carries no offset in its vtable and
`makeScript` never emits the word. `surveys/firearms_multibarrel_words.py` finds
**0** declarations across all 14 installs, so nothing shipped depends on it.

**O-2. What does `ObjectTemplate.AmmoType` on a rack bind to?** Bomb racks use
7 or 9, torpedoes 7 or 9, guns 8 or 10. `ledger.md` SUP-2 records that
`SupplyDepot::addAmmoType`'s id is **not** the client's `AmmoType` /
`setHudAmmoType` enum and matches an unnamed tag on `FireArms`. Whether a plane
rearming on a carrier or airfield refills bombs separately from bullets is
therefore unsettled. Not blocking — the viewer has no rearm pads yet.

**O-3. What reload time does the Mustang use?** `MustangBombDummy` declares
`AutoReload 1` and no `reloadtime`
(`Objects/Vehicles/Air/Mustang/Weapons.con:45-51`). It is the only plane that
does. Either `FireArmsTemplate`'s constructor default applies, or `autoReload`
without a time is inert. Read the ctor default the same way as O-1.

**O-4. Which weapon fills the primary versus secondary HUD slot?**
`ledger.md` VHUD-10 has this explicitly open: the registrar tables are closed,
the *writer* is not. The proposal in step 5 (sort by `input`) is a design
choice that happens to be right for every plane in the table, not a derived
fact. `seats-and-manned-guns.md:230-248` already flags that "the extracted data
has no independent primary/secondary tag to cross-check it against".

**O-5. How does a torpedo behave between release and water entry?** It declares
`gravityModifier 1.0` and `drag 0.04` and carries two `Wing`s and two
`FloatingBundle`s that do nothing in air. Whether the engine runs the
`c_ETTorpedo` thrust before the torpedo is wet is not established from data;
`Engine::handleUpdate`'s `& 0x10` branch is characterised
(`ground-vehicles.md:844`) but its gating on submersion is not.
`symbols.json` has `Wing::handleUpdate` using `medium = 10.0` when below the
combined water/terrain height from `World` vtable `+0x5c`, which is the closest
thing to an answer and suggests the wings at least switch media.

**O-6. What exactly happens when a torpedo hits terrain?** The chain in §2.5(d)
is assembled from four independent facts and is consistent, but no one has
watched it in the real game. The specific unknown: does `dieAfterColl`'s engine
default of 1 despawn it on the first dirt contact, or does it slide? Cheap to
settle by playing the game.

**O-7. Does `Torpedo_Floater`'s `setDragModifier 8000.0` apply above or below
water?** It is three orders of magnitude larger than any vehicle's value and
must be the submerged-drag term, but `FloatingBundle::handleUpdate`
(`symbols.json`, `0x082401cd`) has not been read for it.

---

## 7. Summary of what to do

1. Four new parsed words in `bf42/con.py` (`setHasPointPhysics`,
   `DetonateOnWaterCollision`, `stopAtEndEffect`, `setAsynchronyFire`).
2. `_projectile_spec` gains `mass`, `drag`, the water flag and a `parts` walk;
   `_fire_arms` gains `asynchronyFire` and keeps `projectilePosition`.
3. `extract_map.py::find_weapon_scripts` follows the projectile's sound script.
4. `gunfire.js:484-486` stops discarding zero-velocity weapons; `gunfire.js:872`
   stops turning `velocity 0` into 100 m/s.
5. Drag in the shell integrator; all-muzzles-at-once when `asynchronyFire` is
   absent.
6. HUD slot by `input`, not declaration order.
7. A new `viewer/torpedo-run.js` for the water run, entered from a water
   contact that `detonateOnWaterCollision` does not detonate.
8. ~~Settle O-1 in `FireArms::Fire` before quoting a bomb count to anybody.~~
   Done 2026-09-22 — ledger BOMB-1…BOMB-5. Spend one round **per
   projectile**, and implement the partial salvo (BOMB-5) with it.
