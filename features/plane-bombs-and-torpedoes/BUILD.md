# Build record: aircraft bombs and torpedoes

Stream W6-A of the parity round. The design is
[`README.md`](README.md); the engine facts are
[`../bf1942-engine-reference/subsystems/bombs-and-torpedoes.md`](../bf1942-engine-reference/subsystems/bombs-and-torpedoes.md)
and ledger rows BOMB-1…BOMB-12. This is what was built, what it measures, and
where it departs from either.

Branch `worktree-agent-a8644868af17c6682`, three commits:

| | |
|---|---|
| `4d0f2c4` | extractor: the four unparsed words, `mass`/`drag`, the `parts` walk, `projectilePosition`, the projectile sound script |
| `3e87513` | viewer: the guard, the release speed, the salvo and its charge, water entry, `torpedo-run.js`, the HUD slot |
| `a754eef` | the release sound is the one-shot thump, not the looping whistle |

Suite: **2,390 green** (`python3 -m unittest discover -s tests` from
`tools/bf1942-models`, 22 s). It was 2,316 when this stream started; the 74 new
ones are `tests/test_plane_bombs.py` (20, the extractor) and
`tests/test_bomb_release.py` (22, the viewer through
`tests/bomb_release_harness.mjs`) plus what those two pull in. Six existing
harness module lists grew the two new viewer modules
(`test_fuse_round_rest`, `test_gunfire_layers`, `test_idle_vehicle`,
`test_mouse_input`, `test_seats`, `test_world`, `test_room`).

---

## 1. What was built, per gap

### G-1 — the guard

`viewer/gunfire.js:492-500`, and the predicate is
`launchesADrawnBody` in the new `viewer/bomb-release.js:45`.

The guard is amended, not deleted. What it was protecting against is a
`FireArms` **placeholder** — no emitter, no tracer, no recoil, no muzzle
velocity **and nothing drawn to launch** — which would otherwise own a trigger,
a cooldown timer and, once `velocity || 100` had invented a muzzle velocity for
it, a stream of invisible rounds spending collision casts on nobody's behalf.
The amended test admits exactly the weapons that put a drawn body into the
world: a `shell` or `rocket` projectile spec **with** the baked
`projectileMesh` that `#spawnProjectile` needs. A bomb rack has both; a
placeholder has neither; a stale GLB whose body failed to bake still falls
through to the old velocity test rather than firing nothing for ever.

Both halves are pinned: `test_a_bomb_rack_gets_a_firing_group` and
`test_the_guard_still_keeps_out_a_placeholder`.

### G-2 — the release speed

`viewer/gunfire.js:923` (`releaseSpeed`, `bomb-release.js:61`) —
`velocity ?? 100`, not `velocity || 100`.

No change was needed in `#muzzleVelocity`: at `speed === 0`,
`out.multiplyScalar(0)` then `out.add(platform)` already yields the platform's
velocity alone. **The spec missed the thing that did need fixing.**
`gravityScale: (speed / authored) ** 2` is `0 / 0` at a zero release, i.e.
**NaN**, and `shot.velocity.y += GRAVITY * gravity * NaN * dt` would have
deleted gravity from every bomb in the game. Now guarded
(`gunfire.js:948`), pinned by
`test_a_zero_release_does_not_produce_a_nan_gravity_scale`.

### G-3 — water entry

`viewer/gunfire.js`, `#throughWater` at `1310`, called from both the
torpedo branch and the ballistic branch of `advance`. `entersWater`
(`bomb-release.js:148`) is the test: `damage.detonateOnWaterCollision === false`.
Absent keeps meaning "behave as this viewer always has", which is what keeps the
three bombs bursting on the sea.

This closes the divergence
`features/bf1942-blast-and-bounce/README.md` lines 382-383 already recorded.

### G-4 — the torpedo run

`viewer/torpedo-run.js`, new, 300 lines. Entered from the first survivable
water contact; from then on it replaces the ballistic step. Modelled:
buoyancy from the two `Torpedo_Floater`, levelling from the horizontal
`Torpedo_Wing`, thrust from the `c_ETTorpedo` engine, drag at PHY-7's submerged
25x. Not modelled, and said so in the file: the fore/aft floater **couple** (a
rigid-body moment, and a round has no inertia tensor here) and the vertical
wing.

The extractor half is `_projectile_parts` in `bf42/assemble.py:1420`, which
walks the projectile's `addTemplate` children and emits every `Wing`,
`FloatingBundle` and `Engine` with its placement and its own `physics()` words.

### G-5 — the release sound

`extract_map.py::find_weapon_scripts` now asks a rack's `projectileTemplate`
for a `loadSoundScript` when the rack itself declares none, and reports it
under the **rack's** name (the viewer keys weapon audio on the FireArms node).
A gun with its own script keeps it, so no `Projectile.ssc` ricochet script can
displace a fire patch.

Then a second fix the spec does not mention: `Bomb.ssc`'s **first** sounding
patch is the in-flight whistle — `shellair`, `Shellwhine`, `haxxar`, all
`loop` — and `_firing_patch` prefers a looping patch because that is right for a
held machine gun. On a momentary release it is a whistle that never stops.
`_firing_patch(…, release=True)` takes the first one-shot patch instead, which
is `bmbreal1` / `bmbreal3`.

### G-6 — `setAsynchronyFire`

Parsed in `bf42/con.py` (`asynchrony_fire`), emitted by `_fire_arms` as
`extras.fireArms.asynchronyFire`, honoured by `salvo()`
(`bomb-release.js:106`) and `fireShot` (`gunfire.js:664`).

### BOMB-1 / BOMB-5 — the ammunition arithmetic

`salvo(barrelCount, {asynchronyFire, roundsLeft, nextBarrel})` returns the
barrels to fire and the rounds to charge. `fireShot` calls it once per pull,
fires that many barrels through the new `#fireBarrel`, and hands the count to
`onShot(group, rounds)`; `FireState.registerShot(rounds = 1)`
(`viewer/seats.js:987`) spends it. `chainOnShot` forwards the second argument.
The magazine reaches `gunfire.js` through one optional hook,
`guns.roundsLeft`, wired in `map.html:10143` — that is what serves BOMB-5's
partial salvo, which needs to know the magazine before it decides how many
barrels fire.

**This corrects a reading that was in the code.** `fireShot`'s old comment
argued from the shipped data that Refractor cycles `addFireArmsPosition` entries
one per round: the Katyusha declares six positions and `magSize 6`, so
alternation gives six rockets and volleying "would empty a six-round magazine as
thirty-six rockets". The binary says the volley is right and the absurdity was
in the charge. `Fire` volleys and `fireFinished` charges `barrelCount`, so the
Katyusha's six rails are six rockets in **one** pull off a magazine of six.

**The collateral is not confined to bombs, and the spec does not flag it.**
Every multi-barrel `FireArms` in the game now salvos and is charged per
projectile. A Corsair's two-barrel `CorsairGuns` at `roundOfFire 12` really does
put 24 rounds a second into the air, and its 600-round magazine really does last
25 seconds rather than 50. That is BOMB-1 and BOMB-2 (both **verified** in the
ledger) applied, but it is a visible change to every aircraft and vehicle MG and
the lead should know it is in this branch.

### The HUD slot

`seats.js::activeFireArmsNodes` sorts through `byWeaponSlot`
(`bomb-release.js`) — `c_PIFire` before `c_PIAltFire`, stably. A **design
choice, not a derived fact**: VHUD-10 is open, and the extracted data carries no
independent primary/secondary tag. It happens to be right for all thirteen
vanilla aircraft racks and it leaves a Sherman's cannon and coax (both
`c_PIFire`) in declaration order.

---

## 2. The measurements

### 2.1 In the harness (`tests/bomb_release_harness.mjs`)

Every rig is stamped with the numbers the extractor now emits, verified against
a fresh `extract_models.py Stuka B17 Aichival-T` (below).

| | measured |
|---|---|
| Stuka rack, groups built | **1**, 2 muzzles, bounding radius **0.943 m** off the drawn body |
| Placeholder (no signature, nothing to launch), groups | **0** |
| Release velocity, platform (0, −10, −80) | **(0, −10.2, −80.0)**, speed **80.65 m/s** (one frame of gravity and drag already run) |
| Drop points | x = **−3.3** and **+3.3**, the two authored barrels |
| `gravityScale` at a zero release | **1**, not NaN |
| One pull of a dive bomber | **2 bombs**, ammo **30 → 28** |
| A whole magazine | **15 pulls, 30 bombs**, ammo 28, 26, … 2, **0** |
| Partial salvo, `roundsLeft 1` over 2 barrels | **1 barrel, 1 round** |
| Unlimited over 2 barrels | 2 barrels, **0 rounds** charged |
| `asynchronyFire` over 2 barrels | **1 barrel**, round-robin 0 → 1 |
| B17 stick | **8 bombs**, ammo 0, reload 15 s armed |
| B17 barrel order | −1, +1, −1, +1, −1, +1, −1, +1 |
| B17 spacing | **0.25 s** apart, **15.0 m** along track at 60 m/s, stick spans **1.75 s** |
| Bomb from 500 m at 150 m/s | **8.217 s**, throw **1228.9 m** |
| the same with no `mass`/`drag` | throw **1231.9 m** — drag costs **3.03 m in 1,229**, 0.25 % |
| Impact record | `terrain`, blast **impact**, radius **20**, splash material **202**, yMod **2.0** |
| Bomb onto the sea | **2 impacts**, kind `water`, at y = 0, nothing left flying |
| Torpedo, released 20 m up at 70 m/s sinking 2 m/s | enters at **1.47 s**, **no impact record**, deepest **14.31 m** |
| … settles at | **6.578 m** below the surface |
| … speed | 70.0 → **110.8 m/s** over 20 s |
| … distance | **1,858 m** in 20 s, lateral drift **0.000 m** |
| Torpedo released 40 m up sinking 6 m/s | deepest **21.85 m**, settles **6.565 m** — same equilibrium from a worse entry |
| Buoyancy by body depth (m → m/s²) | 3 → 0, 4 → 4.116, 5 → 8.233, 6 → 12.349, 7 → 16.465, ≥8 → **17.700** |

The equilibrium is arithmetic, not tuning. Two floaters of
`floatMin/MaxLift 5.9` normalised by |g|/9.82 give 17.70 m/s² fully submerged;
14.73 of that is reached at a submersion ratio of 0.832, which over a
`hullHeight 4.3` is 3.58 m of floater depth, and the floaters sit 3 m above the
body — so the body centre runs **3 + 3.58 = 6.58 m** down. Measured 6.578 and
6.565 from two different entries.

### 2.2 On the page

Served from this worktree on `:5291`, Playwright + SwiftShader, driven through
`__enterOwner` / `__setSeatFire(false, true)` / `__renderOnce`. The page needs a
deploy before the mount (`__setOnFoot(true)`, `__deploy.spawn()`) and the
**pilot checkbox** checked, or `frame()`'s `seated` is false and the world gets
no input at all.

**With the GLBs currently on disk** (extracted before this branch, so no
`mass`, no `drag`, no `parts`, no `asynchronyFire`):

- **Kursk, Stuka.** `StukaBombRack` has a firing group — 2 muzzles,
  `velocity 0`, `roundOfFire 0.2`. One pull dropped **two bombs**; HUD secondary
  **30 → 28**. Released level at 120 m/s from 400 m, both fell to terrain at
  z −987.1 and −995.2 having travelled **836.3 m** and **838.5 m**, effect
  **`BombSmall_Expl`**, blast **impact**, radius **20**, splash material **202**,
  yMod **2.0**, direct damage 0 (material 3 has no cell for attacker 242 —
  correct, dirt takes nothing).
- **El Alamein, B17.** `Ammo/NumberOfWeaponIcons 1`, `Ammo/PrimaryAmmo 8` — the
  bombs are in the **primary** slot, which is BOMB-7 and the weapon-slot sort
  working. With the stale scene it salvos: 8 bombs in **4 pulls of 2**
  (8 → 6 → 4 → 2 → 0).
- **Midway, SBD-T.** Torpedo released, HUD 15 → 14, one drawn body in the
  world; it **burst on the water surface** at y = 20 (material 1, direct damage
  10.88, no splash — `AircraftTorpedo` has no `material2`), because the stale
  scene carries no `detonateOnWaterCollision`.

**With freshly extracted scenes** (into scratch, never into the shared tree):

- **El Alamein, B17**: a **stick of eight, one bomb per pull** —
  8 → 7 → 6 → 5 → 4 → 3 → 2 → 1 → 0, one every 0.25 s, spanning 1.75 s. G-6 on
  the page.
- **Midway, SBD-T**: the torpedo crosses the surface (y = 20) at t ≈ 2.0 s with
  **no impact record and still alive**, dives to y = 5.5 (14.5 m deep), then
  rises 7.8 → 10.2 → 12.4 → 13.5 and **holds y = 13.4 for four seconds** —
  13.4 = 20 − 6.58, the floaters' equilibrium. It ran from z −2217.9 to
  z −3594.7, **1,377 m in 17.5 s** (≈95 m/s late in the run), straight, and was
  then recycled by the viewer's own 1,500 m `maxRange` guard rather than by its
  20 s `timeToLive`.
- **Kursk, Stuka**: unchanged with `mass`, `drag` and the two `Bomb_wing` parts
  present — bombs still drop, 30 → 28.

### 2.3 The extractor, end to end

`python3 extract_models.py Stuka B17 Aichival-T --out <scratch>` gives:

- `StukaBombRack`: `mass 250.0`, `drag 0.08`, `hasPointPhysics false`,
  `stopAtEndEffect true`, `parts` = two `Bomb_wing` (`wingLift 0.2`, one rolled
  −90), `projectilePosition [0, −0.4, 0.2]`.
- `B17BombRack`: **`asynchronyFire: true`**, `magSize 8`, `numOfMag 10`,
  `reloadTime 15.0`, `autoReload true`, `roundOfFire 4.0`, material 240 /
  splash 204 / radius 30.
- `Aichival-TBombRack`: `mass 800.0`, `drag 0.04`,
  `damage.detonateOnWaterCollision false`, `trailBundle e_WaterTorpedo`,
  `endEffect WaterExplosionTorpedo`, and **five parts** — two
  `Torpedo_Floater` (`hullHeight 4.3`, `floatMax/MinLift 5.9`,
  `dragModifier 8000.0`) at `[0, 3, 2]` and `[0, 3, −2]`, one `Torpedo_Engine`
  (`c_ETTorpedo`, `torque 12.5`, `differential 5.0`,
  `noPropellerEffectAtSpeed 120.0`) and two `Torpedo_Wing`.

`python3 extract_map.py Kursk --out <scratch> --sounds-only` gives 25 weapon
sound sets where the rack now appears:

```
BF109    BF109BombRack     [bmbreal1.mp3 loop=false, bmbreal3.mp3 loop=false]
Stuka    StukaBombRack     [bmbreal1.mp3 loop=false, bmbreal3.mp3 loop=false]
yak9     Yak9BombDummy     [bmbreal1.mp3 loop=false, bmbreal3.mp3 loop=false]
Ilyushin IlyushinBombRack  [bmbreal1.mp3 loop=false, bmbreal3.mp3 loop=false]
```

Before the `release` mode those four resolved
`[shellair.mp3, Shellwhine.mp3, haxxar.mp3]`, all `loop=true`.

`find_weapon_scripts` against the installed game resolves
`Objects/Vehicles/air/common/Sounds/Bomb.ssc` for `StukaBombRack`,
`CorsairBombDummy` and `B17BombRack`, and still resolves **nothing** for the two
torpedo racks, because `AircraftTorpedo` declares no `loadSoundScript`.

---

## 3. Two new engine reads

Both from the Linux dedicated server,
`/home/dylan/Downloads/bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`.

### FloatingBundle lift is normalised by 9.82 — NEW, and load-bearing

`PhysicsFloatingBundle::updatePhysics` `0x0824d640` reads the template's
`hullHeight` at `+0x1b4` (`0x0824d704`), forms a submersion ratio, clamps it
(`fld1` `0x0824d720`, `fldz` `0x0824d73b` and `0x0824d74c`, `-1.0` at
`0x0824d763`), lerps between `floatMinLift` and `floatMaxLift`
(`0x0824d77e`-`0x0824d79e`; the pair is copied from template `+0x1b8`/`+0x1bc`
into the physics node's `+0xa4`/`+0xa8` by
`FloatingBundleTemplate::setPhysicsNodeComponent` at
`0x082410c5`-`0x082410e0`), and divides the product by the constant at
`0x086d0d6c`, which is **−9.82** — the same normalisation
`PhysicsSpring::updatePhysics` applies to `setStrength` and that `flight.js`
already carries as `GRAVITY_NORMALISER`.

So an authored lift is worth `x 14.73/9.82 = 1.49995`. **Implementing the spec
literally sinks the torpedo**: two floaters at the authored 5.9 give 11.8
against a g of 14.73 and it goes to the bottom; 2 x 5.9 x 1.49995 = 17.70 holds
it up at 6.58 m. This is the one place where following §2.5(c) as written would
have produced a wrong feature.

### `setDragModifier` is write-only — O-7 settled, negatively

`FloatingBundleTemplate::setDragModifier` (`0x08241070`) stores to
`FloatingBundleTemplate+0x1c0`. A scan of the whole 15 MB static binary finds
exactly two float reads of that offset, `0x08240d3a` and `0x08240d6c`, and both
are inside `FloatingBundleTemplate::makeScript` — the serializer that echoes the
word back out. `setPhysicsNodeComponent` copies `floatMaxLift` and
`floatMinLift` into the physics node and does **not** copy this one.

`setDragModifier 8000.0` therefore does nothing at all, above water or below.
O-7 asked which; the answer is neither. It is still extracted (it is data the
`.con` declares) and `torpedo-run.js` says in so many words why it is not used.

### And one corpus claim confirmed with its address

The `& 0x10` throttle pin: `Engine::handleUpdate` `0x0823e120`,
`and eax,0x10` at `0x0823e16e`, and on the set path
`mov DWORD PTR [edi+0x124],0x3f800000` at `0x0823e179`. `c_ETTorpedo` is
`0x19`, so bit 4 is set and a torpedo engine is pinned at full throttle.
`ground-vehicles.md:844` said this; now it has the two addresses.

---

## 4. Where this departs from the spec or the corpus

1. **§2.5(c) / BOMB-12 understate the floater lift.** See above. The authored
   5.9 is not the acceleration; 8.85 is.
2. **§5.2 step 2 names the wrong line.** `#muzzleVelocity` needed no change;
   `gravityScale`'s `0 / 0` did, and the spec does not mention it.
3. **§5.1's `parts` example has the wrong sign on Z.** It shows
   `"position": [0, 3, -2]` for the first floater, copying the `.con`. The
   exporter Z-negates every child placement, as it does everywhere else, so the
   shipped shape is `[0, 3, 2]` for `setPosition 0/3/-2`. Nobody should read
   that example as the JSON.
4. **§5.1's `child.as_dict().get("physics")` does not exist.**
   `ObjectTemplate` has a `physics()` method; there is no `as_dict`.
5. **§5.2 step 6 does not flag its collateral.** Salvoing every multi-barrel
   weapon and charging per projectile changes every aircraft and vehicle MG in
   the game, not only the racks. Named in §1 above.
6. **§5.1's `--configuration-all` re-extraction command is not sufficient.** The
   `fireArms` block a placed vehicle uses comes out of the **level's**
   `scene.glb`, not out of `viewer/models/*.glb`; the model browser uses the
   latter. Both trees need re-extracting. See §6.
7. **G-5 needed a second fix** the spec does not describe — the looping-whistle
   patch. §1 above.
8. **The `.ssc` was picked up but not wired** (spec step 8). No new audio code
   was written; see §5.

---

## 5. What is still open

- **The torpedo's speed is the number most likely to be wrong, and it is not
  capped.** The propeller law is the engine's own
  (`PhysicsEngine::updatePhysics`, the expression `flight.js` derives) and it is
  calibrated — the same arithmetic on a Corsair (`fadeSpeed 70`,
  `differential 5`) gives 92 m/s, that plane's real top speed. But the
  torpedo's `noPropellerEffectAtSpeed 120` puts its terminal at
  `120 x (1 + sqrt(0.1)) = 158 m/s`, and the measured run reaches 110 m/s in
  20 s. A torpedo that outruns the aircraft that dropped it is suspicious. Two
  links are unread and either could cap it: whether
  `PhysicsEngine::updatePhysics` has a water medium factor the way
  `PhysicsWing` has its `SUBMERGED_MEDIUM 10`, and whether a `Projectile`'s
  child `Engine` is stepped at all — `Projectile::handleUpdate` `0x0831e940`
  walks no children and the composite update dispatcher was not read. Nothing
  here is tuned to hide it: the measured numbers are in §2.
- **The fore/aft floater couple is not modelled.** Two floaters at z ∓2 give a
  nose-down torpedo more lift at the deeper end; that is a rigid-body moment and
  a round here has no inertia tensor. Their lift is summed at the body centre,
  which is exact at equilibrium and understates recovery from a steep entry —
  visible in the measurement as a 21.8 m overshoot from a 40 m release.
- **The bomb audio is extracted but not heard.** The data half is proven (§2.3);
  the audible half is **not measured**. `chainOnShot(guns, group =>
  weaponAudioFor(group)?.audio.trigger())` should already play the release
  through the existing path with no new code, but my headless probe read
  `weaponAudio` as empty for *every* weapon including guns that already work —
  the probe never awaited the async audio setup — so the harness failed, not the
  feature. Whoever picks this up should start there rather than at the code.
- **O-3, the Mustang's `autoReload 1` with no `reloadtime`, was not settled and
  not implemented.** Spec step 5 asks for it. Today `FireState.step` takes
  `reloadTime || 0`, so the Mustang's reload completes on the next step, i.e.
  instantly — which is a behaviour rather than a crash, but it is not a read of
  the `FireArmsTemplate` constructor default.
- **O-2, what `ObjectTemplate.AmmoType` binds to for rearm**: untouched. Not
  blocking; the viewer has no rearm pads.
- **O-6, what a torpedo does on terrain before reaching water**: untouched.
  `#throughWater` returns false for a terrain contact, so it takes the ordinary
  `#impact` with material 250 and no damage cell for defGroup 0 — the chain
  §2.5(d) describes — but nobody has watched the real game do it.
- **`maxRange` retires a torpedo before its fuse does.** The map page's guard is
  1,500 m and a torpedo covers that in about 17 s of its 20 s life. That is the
  viewer's own recycling cap, not the engine's, and it means
  `WaterExplosionTorpedo` never plays on a map today.

---

## 6. Re-extraction owed

Nothing was published and nothing was written into the shared
`viewer/maps` or `viewer/models` trees. Three scratch extractions were made to
measure with and are not in the repo.

The new fields ride in two places and both need regenerating:

```bash
# the level scenes -- this is where a PLACED vehicle's fireArms block lives,
# and it is what the map page reads. Every level with a bomber needs it, which
# in vanilla is: bocage, el_alamein, gazala, guadalcanal, invasion_of_the_
# philippines, iwo_jima, kasserine_pass, kharkov, kursk, market_garden,
# midway, wake -- i.e. in practice the whole tree.
python3 tools/bf1942-models/extract_maps_all.py --out tools/bf1942-models/viewer/maps

# the model browser's own tree
python3 tools/bf1942-models/extract_models.py --mod bf1942 \
  --out tools/bf1942-models/viewer/models --configuration-all -j 16
python3 tools/bf1942-models/extract_models.py --thumbs ...   # as usual
```

A **sounds-only** pass is enough for G-5 alone and takes about 15 s a level:
`extract_map.py <Level> --out tools/bf1942-models/viewer/maps --sounds-only`.

Until the level scenes are re-extracted, on the shipped data:

- bombs **do** drop, at the right place, with the right ammunition arithmetic
  and the right explosion (measured, §2.2);
- the B17 salvos pairs instead of laying a stick;
- a torpedo bursts on the surface instead of running;
- a bomb has no drag term (worth 3 m in 1,229 — invisible);
- there is no bomb release sound.

A full re-extract of `viewer/models` also regenerates `models.json`, so it must
not be run as a subset against the shared tree.

---

## 7. Ledger rows to integrate

| id | claim | viewer | confidence | evidence |
|---|---|---|---|---|
| FLOAT-1 | **A `FloatingBundle`'s `floatMinLift`/`floatMaxLift` are expressed in units of a 9.82 m/s² gravity, not in m/s².** `PhysicsFloatingBundle::updatePhysics` lerps between them over the submersion ratio `t` and divides by −9.82, so an authored lift is worth `lift x 1.5` against the engine's −14.73 g (exactly 1.5: `9.82 x 1.5 = 14.73`). **The row as first written was incomplete in a way that matters: the ratio multiplies the lerp result a SECOND time, outside the lerp** (`0x0824d7a4` `fld` ratio, `0x0824d7aa` `fchs`, `0x0824d7ac` `fmul` lift), giving `(-f) x lift x 1.5`. Without that term the law is depth-independent whenever `floatMinLift == floatMaxLift` — which `Torpedo_Floater` is, at 5.9 — and a re-implementer following the row would build a torpedo that cannot hold a depth at all. It is also what makes the equilibrium a root rather than a coincidence: see `../bf1942-ships-research-2026-09-22/` SHIP-1 and SHIP-2, read independently, which agree | [torpedo-run.js `floaterLift`](../../tools/bf1942-models/viewer/torpedo-run.js) | **verified** | `PhysicsFloatingBundle::updatePhysics` lnxded `0x0824d640`: `hullHeight` read from the template at `+0x1b4` (`0x0824d704`); ratio clamped against `fld1` `0x0824d720`, `fldz` `0x0824d73b`/`0x0824d74c` and `-1.0` (`0x086b05ec`) at `0x0824d763`; the lerp `ratio*max + (1-ratio)*min` at `0x0824d77e`-`0x0824d79e` off instance `+0xa4`/`+0xa8`, which `FloatingBundleTemplate::setPhysicsNodeComponent` (`0x08241090`) copies from template `+0x1b8`/`+0x1bc` at `0x082410c5`-`0x082410e0`; the divisor `0x086d0d6c` = **−9.82** at `0x0824d7c4`. Two `Torpedo_Floater` at the authored 5.9 give 11.8 and a torpedo sinks; normalised they give 17.70 and it runs at 6.58 m. The `1.49995` this row first quoted for `g/-9.82` is exactly `1.5` |
| FLOAT-2 | **`setDragModifier` is write-only data.** Stored at `FloatingBundleTemplate+0x1c0` and read by nothing but the serializer, so `Torpedo_Floater`'s `8000.0` has no effect above or below water. Settles the open half of BOMB-12 | not modelled, and said so | **verified** | `setDragModifier` `0x08241070` stores to `+0x1c0`. A whole-binary scan of float reads of `[reg+0x1c0]` finds exactly `0x08240d3a` and `0x08240d6c`, both inside `FloatingBundleTemplate::makeScript` (`0x08240a50`…). `setPhysicsNodeComponent` copies `floatMaxLift` and `floatMinLift` and not this |
| BOMB-3a | The `& 0x10` throttle pin, with addresses: `Engine::handleUpdate` tests the engine type's bit 4 and, when set, stores `1.0f` into the engine's throttle field. `c_ETTorpedo` = `0x19`, so a torpedo engine is always at full throttle and has no throttle input | [torpedo-run.js `#thrust`](../../tools/bf1942-models/viewer/torpedo-run.js) | **verified** | `Engine::handleUpdate` `0x0823e120`: `call [eax+0xa0]` (getEngineType) at `0x0823e165`, `and eax,0x10` at `0x0823e16e`, `mov DWORD PTR [edi+0x124],0x3f800000` at `0x0823e179`; `+0x124` is read at `0x0823e260` into the rev/throttle chain that writes PhysicsEngine `+0xa0`/`+0xa8`/`+0xb0` |
| BOMB-9 | (update) The guard is lifted and a bomb rack fires | [gunfire.js:492](../../tools/bf1942-models/viewer/gunfire.js#L492) | **implemented** | Measured on the page: Kursk Stuka, one pull, two bombs, HUD 30 → 28, both to terrain with `BombSmall_Expl` / impact blast / radius 20 / material2 202 / yMod 2 |
| BOMB-8 | (update) A release is the platform's velocity | [gunfire.js:923](../../tools/bf1942-models/viewer/gunfire.js#L923) | **implemented** | Harness: platform (0, −10, −80) in, (0, −10.2, −80.0) out. The `velocity || 100` fix also needed a `gravityScale` guard: `(0/0)**2` is NaN and deleted gravity from every bomb |
| BOMB-11 | (update) `detonateOnWaterCollision` is parsed and consumed | [gunfire.js `#throughWater`](../../tools/bf1942-models/viewer/gunfire.js) | **implemented** | Fresh Midway on the page: the torpedo crosses y = 20 with no impact record, dives to 14.5 m, settles at y = 13.4 (= 20 − 6.58) and holds it for 4 s while running 1,377 m |
