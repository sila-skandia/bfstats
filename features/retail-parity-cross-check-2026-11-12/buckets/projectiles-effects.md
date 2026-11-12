# projectiles-effects

## Summary
- CODE-WRONG: 3 (1 medium, 2 low)
- SETTLED: 3 (all low)
- DELIBERATE: 9 (kept)
- LEDGER-WRONG: 0 (the ledger has no row for the engine's `timeToLive` default; F1 asks for one)
- RE-WRONG: 0
- INCONCLUSIVE: 0
- MATCH: 27 groups verified on our binary (list below), plus about 40 citations checked against their ledger row only (named at the end).

Not reached in depth: sound-side rows in world-fire.js / effects.js (SND-12..38, the sound bucket's), SPR-3/5/6/7 and EMT-2..4/9/12..14 in effects.js / effects-core.js (checked against ledger rows only, apart from SPRITE_GRAVITY), BOMB-3/4/7/9/13 and FA-5/7/13 (ledger rows only), the `/100` scale inside DEV-9 (I read only the 0.01 floor), and the weathervane assumption in projectile-flight.js `pushMotors` (rigid-body turning; `features/rocket-flight` open item 2).

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [medium] A round whose .con omits `timeToLive` lives CRD_UNIFORM/3/0 (0 to 3 s), not 10 s
- Code: tools/bf1942-models/viewer/projectile-damage.js:314 `export const DEFAULT_TIME_TO_LIVE = 10;`, used at :340 `const authored = timeToLive || DEFAULT_TIME_TO_LIVE;` (the `||` also turns an authored 0 into 10). The tracer path has the same gap: round-launch.js:27 `TRACER_MAX_AGE = 1.5` is the fallback at :532 when `roundLifetime === 'data'` and nothing is declared.
- Ledger: no row gives the default. PROX-7 (activate draws `getContinuousRandom(tmpl+0x17c, +0x180, +0x184)`) and CRD-1 (`CRD_UNIFORM/a/b` = `a + r(b-a)`) together decide it. GUN-9's "timeToLive -> flat 10s" is the Defgun's own data, not a default.
- Third-party: decompiled_functions_bf42linuxServer/ProjectileTemplate.c:34-36 first writes `+0x17c = 0; +0x180 = 0x3f800000; +0x184 = 0`. Then, after `ObjectTemplate::updateFlags(this,0x42,0)`, lines 64-69 write `*(this + 0x180) = 0x40400000; *(this + 0x184) = 0; this[0x188] = 0; ... *(this + 0x17c) = 1;`.
- Our binary: in `ProjectileTemplate::ProjectileTemplate` (lnxded.static), 0x0831f973 `leal 0x17c(%ebx),%esi`; 0x0831fa8c `movl $0x40400000,%eax`; 0x0831fa96 `movl %eax,0x4(%esi)` (+0x180 = 3.0); 0x0831fa99 `movl %edx,0x8(%esi)` (+0x184 = 0); 0x0831fa9f `movb $0,0xc(%esi)`; 0x0831fab0 `movl $0x1,0x17c(%ebx)` (dist = 1). `Projectile::activate` reads it at 0x0831e1e7 `leal 0x17c(%esi)` and 0x0831e1fd `movl 0x17c(%esi),%edx`, and posts message 0x16 at 0x0831e283. In `Random::getContinuousRandom` (0x081e28b0), dist 0 returns `a` (0x081e2a04 `flds 0x10(%ebp)`), dist 1 takes the uniform branch (0x081e28c5 `je 0x81e2a16`), and dist 3 the normal one (0x081e28f1 `call getNormal`).
- Verdict reasoning: the constructor's last word is `CRD_UNIFORM/3/0/0`. A round with no `timeToLive` therefore draws `3 + r(0-3)` per round, uniform over 0 to 3 s with a mean of 1.5 s. The viewer flies it 10 s; on the tracer path it flies 1.5 s, which is the mean but not drawn per round.
- Fix: have extract_map.py write `entry["timeToLive"] = crd4("CRD_UNIFORM/3/0/0")` when `template.time_to_live_crd` is None (the damage-table path effects-core.js:293/333 already samples), and/or in projectile-damage.js `roundTimeToLive` replace `timeToLive || DEFAULT_TIME_TO_LIVE` with `timeToLive ?? sampleCrd(['u',3,0,0])` so an authored 0 stays 0. Do the same for the `TRACER_MAX_AGE` fallback on the `data` path. Add a ledger row next to PROX-7 for the default.

### F2 [CODE-WRONG] [low] passing-rounds.js drops a round's crack point under 9.81, not 14.73
- Code: tools/bf1942-models/viewer/passing-rounds.js:27 `const GRAVITY = 9.81;`, used at `drop: 0.5 * GRAVITY * (gravity || 0)`.
- Ledger: IMP-7, "`gravityModifier` ... scales -14.73 m/s^2".
- Third-party: decompiled_functions_bf1942exeWinPC/00578f00_FUN_00578f00.c `param_1[2] = 0xc16bae14;`
- Our binary: client 0x00578f11 `movl $0xc16bae14, 0x8(%eax)`; readmem hexf gives -14.73.
- Verdict reasoning: this is the same stale 9.81 that projectile-flight.js's header says was removed elsewhere. It only affects rounds with a non-zero `gravityModifier` (vanilla rifle and MG rounds declare 0), and only moves where their passing crack is heard. It also leaves out FA-23's first-tick terms (`firstTickLift`), which do not matter for sound.
- Fix: `import { GRAVITY } from './physics.js'` and use `-GRAVITY` (it is signed) in place of 9.81.

### F3 [CODE-WRONG] [low, latent] rocket-motor.js uses differential 1 and torque 0 when an Engine omits them; the engine's defaults are 10 and 60
- Code: tools/bf1942-models/viewer/rocket-motor.js:104 `this.ratio = currentRatio(part.differential ?? 1);` and :105 `this.torque = part.torque ?? 0;`. aircraft.js:823 (not in this bucket) has the same `?? 1`. torpedo-run.js:272 skips an engine without `differential`.
- Ledger: none for these defaults (TANK-3 has the ratio law only).
- Third-party: decompiled_functions_bf42linuxServer/makeScript_082465F0.c (EngineTemplate::makeScript) maps `setTorque` to `+0x368` and `setDifferential` to `+0x364` (and `setNoPropellerEffectAtSpeed` to `+0x520`).
- Our binary: in `EngineTemplate::EngineTemplate` (0x0823efc0), 0x0823f022 `movl $0x41200000, 0x364(%ebx)` (differential 10.0), 0x0823f02c `movl $0x42700000, 0x368(%ebx)` (torque 60.0), 0x0823f06e `movl $0x42c80000, 0x520(%ebx)` (noPropellerEffectAtSpeed 100.0, which the code's `|| 100` matches).
- Verdict reasoning: an omitted word gets 10 / 60, not 1 / 0. Today this is latent: all 1,015 `c_ETRocket` engine parts baked under viewer/models carry both words (rg over the glbs). A mod rocket that omits either would get a tenth of the thrust and no load term.
- Fix: `part.differential ?? 10`, `part.torque ?? 60` (better: have `bf42/con.py` emit the engine defaults), and the same in aircraft.js / torpedo-run.js.

### S1 [SETTLED] [low] The end-of-life explosion's NULL `sourceArmor` means no victim is excluded; the impact path excludes only the victim whose armor is the firer's
- Code: tools/bf1942-models/viewer/round-impact.js:165-169, "UNVERIFIED, and named as such: what that argument actually gates downstream was not re-derived".
- Ledger: HP-9 / HP-9d (the two-path rule). Neither states what the argument gates.
- Third-party: decompiled_functions_bf42linuxServer/handleExplosionOnObject.c:95-106 walks the victim's parent chain for the first `IArmor` (`vt+0x28(0xc4a4)`), then `if ((pGVar10 != 0) && (param_11 != pGVar10)) { ... damage, push ... }`. handleExplosion.c:129-131/185-187 passes the source armor through unchanged.
- Our binary: in `GameServer::handleExplosionOnObject` (0x08156500), 0x08156553..0x0815655e is `push $0xc4a4; push $0xc4a4; call *0x28(%eax)`, then 0x08156597 `cmpl %ebx, 0x30(%ebp)` / 0x0815659a `je 0x8156790` (skip). The 0x30(%ebp) argument is the `IArmor*`. `Projectile::startEndEffect` 0x0831f727 `pushl $0x0` passes NULL there.
- Verdict: the only thing the argument does is skip the one object whose armor is the source's. With NULL nothing is skipped, so your own grenade hurts you. The code's `firer: -1` on the end-of-life record is right. Code: none; drop the UNVERIFIED note and cite 0x08156597.

### S2 [SETTLED] [low] A thrown round's `rotationalSpeed` is radians per second, on a full physics body; a point body never spins
- Code: tools/bf1942-models/viewer/round-launch.js:818-826, "`PointPhysicsNode::updatePhysics` ... integrates one scalar rate ... the UNIT is unverified".
- Ledger: COL-8 (rotation integrated by the root PhysicsNode).
- Third-party: decompiled_functions_bf42linuxServer/setRotationalSpeed_0825D920.c, `PointPhysicsNode::setRotationalSpeed(Vec3*) { return; }`.
- Our binary: `PointPhysicsNode::setRotationalSpeed` 0x082568b0 is 5 bytes (a no-op), and so is `addRotationalSpeed` 0x08256570. `FireArms::fireBarrel` 0x0828aff3..0x0828b05c turns the template vector `+0x2dc..+0x2e4` by the launch frame's rows with no unit factor. `PhysicsNode::updateRotationalPhysics` 0x08253e42..0x08253e63 computes `dt * |w| * 57.2958` (`fmuls 0x86c0318` = 57.2957763671875) and passes it to `rotateAboutLine` (degrees). So w is in rad/s.
- Verdict: the code's radians reading is right. Its citation is wrong: the spin lives on the full `PhysicsNode` (the grenades declare `setHasPointPhysics 0`), and a point-physics round given a `rotationalSpeed` does not turn at all. Also, the engine turns the whole vector into the launch frame, while the code keeps component 0 about local X (equivalent for vanilla's `8/0/0`). Code: optional, gate `spin` on `hasPointPhysics === false`; fix the comment.

### S3 [SETTLED] [low] Within a tick, the proximity fuse runs before the round moves and before contact
- Code: tools/bf1942-models/viewer/projectile-flight.js:864-868, "Which of the two the engine runs first within a tick (the physics contact or `handleUpdate`) was not read". The code sweeps for contact first, then tests the fuse at the post-move position.
- Ledger: IMP-8 states the `simulateFrame` order (objects' `handleUpdate`, then the physics nodes, then world collision).
- Third-party: decompiled_functions_bf42linuxServer/handleUpdate (Projectile) holds the fuse (PROX-1..5). The order is our binary's.
- Our binary: in `GameServer::simulateFrame` 0x0815c2a0: 0x0815c2e6 `movl objectManager` -> 0x0815c2f1 `call *0x1c` / 0x0815c304 `call *0x14` (object updates, which include `Projectile::handleUpdate` 0x0831e940 and its fuse); 0x0815c31a `physicsNodeManager` -> 0x0815c327 `call *0x14` (moves the round); 0x0815c32a `responsePhysicsManager`; 0x0815c342 `call Game::updateWorldCollision`.
- Verdict: the fuse tests the round where it stood at the start of the tick, before this tick's move and contact. The effect is sub-tick at a 10 m fuse. Code: optional, call `proximityDetonates` before the ballistic step.

### DELIBERATE (keep)
- D1 artillery-kick.js:1-23: KICK_DEG 1.2 / RISE_S 0.15 / FALL_S 0.9, measured from the owner's retail clip and documented as tunable.
- D2 projectile-flight.js:44 TRACER_MIN_SCREEN_PX 2.5: the width floor restores fixed-function sub-pixel coverage; documented.
- D3 projectile-flight.js:66 MAX_CASTS_PER_FRAME 192: per-frame collision budget (browser).
- D4 projectile-flight.js:296+ `drawnLength`: the streak is never longer than the distance flown (owner report 2026-11-04); TRC-1's law is otherwise kept.
- D5 projectile-damage.js:311 FLIGHT_TTL_CEILING 20 and the maxRange recycle guard (projectile-flight.js:880-887): viewer guards, documented as not the engine's.
- D6 round-launch.js:25-28 TRACER_SPEED_SCALE 0.15 / PROJECTILE_SCALE_CUTOFF 150 / TRACER_MAX_RANGE 250: model-browser slow motion and recycling (map page speedScale 1). The `TRACER_MAX_AGE` fallback on the data path is part of F1.
- D7 effects.js:21 MAX_PARTICLES 1200: viewer cap, documented as ours.
- D8 bomb-release.js:208-227 `byWeaponSlot`: design choice, documented (VHUD-10 open).
- D9 projectile-flight.js:112-120: tail-fin weathervaning taken as complete (no round inertia), documented as inferred (`features/rocket-flight` open item 2).

## MATCH list (verified on our binary)
- IMP-7 gravity -14.73 (client 0x00578f11) -> projectile-flight.js, torpedo-run.js, tank-ballistics.js, effects-core.js:26
- IMP-7 gravityModifier default 1.0 (+0x164, 0x0831f940) -> round-launch.js `tracerGravity`, projectile-flight.js
- COL-8 accumulator lid: `|a|^2 > 1e6` -> scale to 1000 (0x082536a1 `0x86d1388`=1e6, 0x082536ba `0x86b1ca8`=1000) -> projectile-flight.js MAX_BODY_ACCELERATION
- PHY-4 box drag pi = 3.14f (0x082545b8 `flds 0x86d1384`) -> projectile-flight.js BOX_AREA
- EMT-5/PHY-7 point drag `(scale*v - wind)*pi*r^2*drag/mass`, pi 3.1415927 (client 0x005789e2 `0x8fdaf0`), 1/mass (0x00578a57) -> bomb-release.js `dragAcceleration`, effects-core.js
- Point body four unrolled semi-implicit sub-steps (0x082560c0..) -> projectile-flight.js `firstTickLift` (0.875 / 0.375 and 0.5 terms re-derived, they agree)
- FA-23 `vy -= (2.0/30.0)*getGravity()` (0x0828b3b0..0x0828b3c4; 0x086c08c4=2.0, 0x08716b5c=30.0), addRootSpeed default 1 (0x0828d6cd) -> round-launch.js ROOT_SPEED_LIFT, tank-ballistics.js ROOT_LIFT
- FA-3 FireArms velocity default 200 (0x0828d808 `0x43480000`) -> bomb-release.js FIREARMS_DEFAULT_VELOCITY
- GUN-13 / roundOfFire default 10 (template +0x240, 0x0828d628), FireArms+0x234 = 1/that (0x08286870) -> gun-cycle.js via fire-timer.js
- GUN-12 recoil: tau = 3.14/recoilSpeed (0x0828a209 `0x86d1384`), depth `size*0.05*-0.5*sin` (0x086c08a8=0.05, 0x086d2f6c=-0.5), +-1000 clamp (0x08288c84/ca1), recoilSpeed default 0 and recoilSize default 1.0 (0x0828d525/52f) -> gun-cycle.js
- KNOCK-4/5/7: force = mod*force*(1/r)*exposure (0x081569cb..e5); x0.1 in water (0x08156e4e `0x86b1ca0`); x final/raw (0x08156e5a..6c); defaults 150 (0x0831fa24), 1.0/300 (0x081dc0ac/0x081dc0b2), 0.5/5.0 (0x0812f3bd/c7); 0.001 (0x086c0b90, double) -> knockback.js
- KNOCK-1/2: |v|^2 vs 64.0 (0x086d2704), 0.2 s (0x086c8678 double), land 0.3 / bounce 0.1 (0x086d2730/38) -> knockback.js
- PROX-1..5: defaults -1 (+0x168, +0x1a0); `0 < dist` gate (0x0831ea4f); primer strictly older (0x0831ea62..7d); 6.25 / 100000 / 50000 (0x086e1c58 / 0x086c089c / 0x086e1c5c); own mass `<` other (0x0831ec65 `test ah,5`) -> proximity-fuse.js
- PROX-6/7: detonate is the end-of-life burst; expiry posts msg 0x16 (0x0831e283) -> projectile-flight.js, round-impact.js
- HP-9 falloff `clamp((r-d)*invR,0,1)`, strict `r > d` (0x08156655..0x0815668f), YMod on dy only -> projectile-damage.js `blastDistance`, splash, knockback gate
- HP-9 default radius 10 (+0x190, 0x0831f9b3) -> projectile-damage.js DEFAULT_SPLASH_RADIUS
- `Projectile::getDamage` (0x0831f3c0): minDamage default 1.0 (+0x194), start/end 0 (+0x198/+0x19c), both skip gates, linear between -> projectile-damage.js `damageFactor`
- Impact blast offset 0.1 (0x086b1ca0) -> projectile-damage.js IMPACT_BLAST_OFFSET
- detonateOnWaterCollision default 1 (+0x1ac, 0x0831fa1d) -> bomb-release.js `entersWater` (only an explicit false enters)
- startEndEffect damageType 1 or 4 (0x0831f6bb/0x0831f6c0) -> projectile-damage.js `splashSpec`, round-impact.js `detonate`
- TRC-1: `(now-birth)*speed*20` (0x0831ea03 `0x86e1c60`=20.0 double) vs `speed/tracerScaler` (0x0831ea0c), xy 10 (0x0831ea2a) -> projectile-flight.js `drawnLength`
- DEV-9 floor: deviation only when total > 0.01 (0x0828af05 `0x86c08a4`, je on strictly greater) -> round-launch.js DEVIATION_FLOOR
- PHY-20 noPropellerEffectAtSpeed default 100 (0x0823f06e) -> rocket-motor.js `|| 100`
- BOMB-11/12 floater lift: `r*lerp(min,max,r)*g/-9.82` (0x0824d77e..0x0824d7c4, 0x086d0d6c=-9.82) -> torpedo-run.js `floaterLift`, LIFT_NORMALISER
- CRD-1 dist switch (0 -> a, 1 uniform, 3 a+bN) at 0x081e28b0 -> effects-core.js `sampleCrd`
- SPRITE_GRAVITY -9.82 in the client sprite update (0x0060a860 block, `fmuls 0x914c10` = -9.82) -> effects-core.js:32
- Rocket pack: heat and cooling /30 (0x08263823/43/63 `0x86b01b4`=30), persistence x30 (0x08263883), burst 1/f (0x08263c53), timer -0.0333 (0x082629d0 `0x86d1a2c`), damping default 1.0 (0x0826360e) -> rocket-pack.js
- `FireArms::detonateProjectiles` walks +0x1d8 / +0x1e4 and calls `Projectile::detonate` (0x0828800c) -> gunfire.js `detonateProjectiles`
- Decal ring: `cmp $0x7f; ja evict` (0x081e032d), so at most 128 -> effects.js MAX_DECALS 128 (the comment's "127 decals" is the compare's operand; the engine's ring is per DecalEmitter, while effects.js keeps one global ring. Cosmetic.)

## Checked against the ledger row only (row status verified/confirmed; no own-binary re-read)
IMP-1, IMP-5, IMP-8, SPR-3, SPR-5, SPR-6, SPR-7, EMT-2, EMT-3, EMT-4, EMT-6, EMT-9..EMT-14, FF-1, FF-2, PHY-14, PHY-17, PHY-18, PHY-21, TANK-1, TANK-12, TANK-13, GUN-2, GUN-18, GUN-22, FA-1, FA-5, FA-7, FA-13, FA-25, BOMB-1..BOMB-13 (BOMB-5's partial-salvo rule read in the code only), SPOT-1, XHIT-16, HFD-4, DEV-2/8/11/12/14, AI-145, HP-14, HP-19, HP-20, ARM-1, ARM-11, FHX-16/21/30, SPAWN-28, LOAD-7, NET-15, VID-2, SND-12..SND-38 (sound bucket).

## Second pass on the binary: BOMB-1..13, FA-5/7/13

- BOMB-1/3/13 MATCH. `FireArms::fireFinished` (0x08288470) charges only while `mags > 0` (0x0828849c `jle`). It charges 1 under `asynchronyFire` (0x082884a5), 1 for 0 or 1 barrels (0x082884df), 1 under `blastAmmoCount` (0x082884e7), and otherwise `barrelCount` (0x08288751..0x08288792).
- BOMB-2 MATCH. `Fire` 0x0828a5c8 / 0x0828a5ce dispatches 0 barrels to its own path and 1 barrel to `fireBarrel(0)` (0x0828a738). The async round-robin uses byte `+0x296`, reset when `barrelCount <= counter` (0x0828a5e9..0x0828a61c).
- **F4 [LEDGER-WRONG] [low] BOMB-5's "never goes into ammunition debt" is wrong.** `Fire`'s partial-salvo rule does fire only `mags` barrels (0x0828a694 `cmpb $0,0x348`, loop 0x0828a6c8..0x0828a722). But `fireFinished` charges `barrelCount` without a clamp (0x0828878d `subl %eax,%edx`, 0x08288792 `movl %edx,(%ebx)`), so the magazine goes negative: `WasserFallGuns` (25 barrels, magSize 1) ends at -24. A 2-barrel rack charged on 1 round would end at -1, which is the unlimited sentinel (GUN-4). bomb-release.js `salvo` charges the barrels fired (never below 0). **I stopped on the code change**: copying the debt (and the -1 collision) changes the HUD count and reload for WasserFallGuns only, and needs a decision. The comment now says what the engine does (bomb-release.js:90-97).
- BOMB-8/10/11 MATCH where the binary speaks: the gravityModifier default is 1.0 (0x0831f940), and `detonateOnWaterCollision` defaults to 1 (0x0831fa1d) and is tested at 0x0831f3ae. The rest of BOMB-6..12 is data.
- FA-13 MATCH. The ctor loads `+0x1f4` from template `+0x1dc` (0x08286836/0x08286842). `Fire` sets pending `+0x294` (0x0828a119) and reloads the timer (0x0828a13a). `handleUpdate` counts it down only while pending (0x08288a9c..0x08288ac5). That matches gun-cycle.js.
- FA-5, FA-7: the row's addresses were not re-read. FA-7's code is hand-fire.js, outside this bucket. FA-5's loaded-rounds.js layout agrees with the row (positions unturned, origin when no position).

## Fixes applied

- **F1** (timeToLive default). In viewer/projectile-damage.js, the flat `DEFAULT_TIME_TO_LIVE = 10` is replaced by `DEFAULT_TIME_TO_LIVE_CRD = ['u',3,0,0]` plus `defaultTimeToLive(rand)` (with the addresses). `DEFAULT_TIME_TO_LIVE` is kept as the 1.5 s mean, marked deprecated. `roundTimeToLive` takes a `rand` and draws the default when the word is absent. In viewer/round-launch.js, the shell path passes `guns.rand` into `roundTimeToLive`, and the tracer `data` path falls back to `defaultTimeToLive(guns.rand)` instead of `TRACER_MAX_AGE` (still the turntable's fixed life). **Not changed: a baked `timeToLive` of 0 still takes the default draw.** The glb holds only a CRD's first number, so a 0 there can be the low end of an undrawn range rather than the engine's expire-at-once. Tests: tests/effects_harness.mjs + tests/test_effects.py `test_a_flying_round_is_still_held_to_the_ceiling`; its old `assertEqual(10, unspecified)` encoded the wrong default and now checks 0..3 and the draw's ends and middle.
- **F2** (passing-rounds.js gravity): imports `GRAVITY` from `point-body.js`, the existing shared world constant that `physics.js` re-exports; nothing new in the import graph. It is still -14.73 there. If the air-sea verifier moves it to -14.7295379, this file follows. Test: tests/test_sound_voice_rules.mjs ok.
- **F3** (engine defaults). ship-spec.js's `DEFAULT_DIFFERENTIAL` / `DEFAULT_TORQUE` exist, but that module imports `three`, and rocket-motor.js must run under node. So rocket-motor.js has `ROCKET_ENGINE_DEFAULTS` {10, 60, 100} with 0x0823f022 / 0x0823f02c / 0x0823f06e, and `RocketMotor` uses it. torpedo-run.js `#thrust` now defaults an omitted differential (10) and noPropellerEffectAtSpeed (100) instead of skipping the engine, with local constants, so its harness import lists stay unchanged. Tests: test_rocket_flight, test_bomb_release, test_seats, test_world all pass.
- **S1**: in viewer/round-impact.js, the UNVERIFIED note is replaced by the read (0x08156597, HP-9g). The damage verifier's DMG-1 line near line 95 was left alone.
- **S2**: viewer/round-launch.js `spin` now applies only when `spec.hasPointPhysics === false`, and the comment cites 0x0828aff3..0x0828b05c, 0x08253e42..0x08253e63 and 0x082568b0. Test: tests/gunfire_layers_harness.mjs grenade fixture now declares `hasPointPhysics: false` (the grenades' real word; the fixture lacked it, so the old test encoded a spin on a point body), and adds a point-body case. test_gunfire_layers `test_the_round_carries_the_authored_tumble` asserts 8 and 0. A glb baked before `hasPointPhysics` was recorded loses its tumble (GCMOD and DC grenade bakes carry `false`; vanilla's were not on disk to check).
- **S3**: in viewer/projectile-flight.js `advanceProjectiles`, the proximity fuse now runs first, at the pre-move position, before the move and the contact sweep (comment cites 0x0815c2e6..0x0815c342); the old post-sweep check is removed. Test: tests/proximity_fuse_harness.mjs `directPass` / `directPassNoFuse` (the hull at 99.5 m: with the fuse, burst at 90 m; without it, contact at 98.5 m), plus test_proximity_fuse `test_the_fuse_runs_before_the_ticks_move_and_contact`. All 15 tests pass.
- **F4** comment only (bomb-release.js:90-97); no code change, see above.

Tests run (from tools/bf1942-models): test_proximity_fuse, test_effects, test_rocket_flight, test_bomb_release, test_throw_launch, test_fuse_round_rest, test_killer_charge, test_seats, test_world, test_damage_parity, test_gunfire_layers, test_loaded_rounds, test_player_shot_cone, test_replay_flights, test_idle_vehicle, test_weapon_words, test_census_vehicle_weapon_sounds, test_round_attitude, test_own_catcher, test_tracer_scale, test_grenade_charge, test_hand_aim, test_vehicle_kill_credit, test_replay_hitmarks, test_barrel_launch, test_ship, test_tank_law: all OK. node tests/test_sound_voice_rules.mjs: ok.
Failing and not ours: test_room (`test_a_blast_prices_and_throws_a_soldier_on_foot`, `test_the_room_restarts_ten_seconds_after_the_end`) and test_vehicle_damage (water and repair KeyErrors). test_room.py, world-damage.js, vehicle-damage.js and vehicle_damage_harness.mjs all carry another session's uncommitted edits, and none of the code paths these tests run touches what I changed.

## Ledger edits (ready to paste)

New row after PROX-9:

| PROX-10 | **A projectile that declares no `timeToLive` lives `CRD_UNIFORM/3/0/0`: 0 to 3 s, drawn per round.** The constructor first writes `CRD_NONE/1/0`, then, after `updateFlags(0x42,0)`, overwrites the triple with dist 1 (uniform), a = 3.0, b = 0. `Projectile::activate` draws it per round (PROX-7), so `3 + r(0-3)`, mean 1.5 s. Code: `viewer/projectile-damage.js` `defaultTimeToLive`, `roundTimeToLive`; `round-launch.js` tracer `data` path (it was a flat 10 s, and 1.5 s on the tracer path) | **verified** (2026-11-12) | `ProjectileTemplate::ProjectileTemplate` lnxded 0x0831f973 `leal 0x17c(%ebx),%esi`; 0x0831fa8c `movl $0x40400000,%eax`; 0x0831fa96 `movl %eax,0x4(%esi)`; 0x0831fa99 `movl %edx,0x8(%esi)`; 0x0831fab0 `movl $0x1,0x17c(%ebx)`. `Random::getContinuousRandom` 0x081e28b0: dist 1 is the uniform branch (0x081e28c5). Linux dump `ProjectileTemplate.c`:64-69 agrees |

New row after HP-9f:

| HP-9g | **An explosion's source armor does one thing: the victim whose own armor is the source's is skipped.** `handleExplosionOnObject` takes the first `IArmor` up the victim's parent chain (`vt+0x28(0xc4a4)`) and returns when it equals the `IArmor*` argument. The impact path passes the firer's. The end-of-life path (`startEndEffect`) passes NULL, so nobody is skipped and a thrower is hurt by their own grenade | **verified** (2026-11-12) | lnxded 0x08156553..0x0815655e (`push 0xc4a4` x2, `call *0x28`), 0x08156597 `cmpl %ebx,0x30(%ebp)` / 0x0815659a `je 0x8156790`; `startEndEffect` 0x0831f727 `pushl $0x0`. Linux dump `handleExplosionOnObject.c`:95-106 |

BOMB-5, replace the claim cell's tail "and never goes into ammunition debt" with: "but `fireFinished` still charges the full `barrelCount`, unclamped (lnxded 0x0828878d `subl %eax,%edx`), so the magazine goes negative (WasserFallGuns: 1 - 25 = -24; a 2-barrel rack on its last round would land on -1, the unlimited sentinel). `bomb-release.js` `salvo` charges only the barrels fired; whether to copy the debt is open".

COL-8, append to evidence: "`rotationalSpeed` is rad/s: `updateRotationalPhysics` turns by `dt*|w|*57.2958` degrees (0x08253e42..0x08253e63, `fmuls 0x86c0318`) into `rotateAboutLine`; `fireBarrel` turns the template vector `+0x2dc` into the launch frame (0x0828aff3..0x0828b05c). `PointPhysicsNode::setRotationalSpeed` 0x082568b0 and `addRotationalSpeed` 0x08256570 are empty, so a point body never spins."

IMP-8, append: "Within the tick, `Projectile::handleUpdate`'s proximity fuse (objectManager, 0x0815c2e6..0x0815c304) runs before the physics nodes move the round (physicsNodeManager, 0x0815c31a..0x0815c327) and before `Game::updateWorldCollision` (0x0815c342); `projectile-flight.js` runs the fuse first (2026-11-12)."

## Fixes applied (coordinator's follow-up, from damage-armour F3 / air-sea F7)

- viewer/round-impact.js (`impact`, near line 20): the attacker's and the struck face's materials now resolve through `crash-damage.js` `materialOf` (already imported there for `angleFactor`). That is the shared lookup, and it falls back to material 0 for an undefined id (DMG-1). It feeds `base`, `attGroup` and `defGroup`. The damage verifier's missing-cell x0 line is unchanged. Test: tests/damage_parity_harness.mjs `unknownMaterial` plus tests/test_damage_parity.py `test_an_undefined_material_reads_as_material_0`: material 999 is priced as material 0's defGroup 7 at x0.5, giving 50.
- viewer/effect-objects.js `tickFloat` (near line 214): arms the float sink rate on the damageable's `criticalFlagged` (the 0x14 crossing), and falls back to `critical` only for a damageable that has no such field. No existing test drives a float hull's arming; test_effect_objects still passes. A test for "killed in one blow never arms" belongs with the damage verifier's `criticalFlagged` death rule, which I did not read.
- Run: test_damage_parity, test_effect_objects, test_proximity_fuse, test_effects, test_rocket_flight, test_bomb_release, test_seats, test_idle_vehicle, test_gunfire_layers, test_loaded_rounds, test_fuse_round_rest, test_world, test_throw_launch: 394 tests OK (2 skipped).
