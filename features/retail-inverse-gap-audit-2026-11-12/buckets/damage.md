# damage

## Summary

Rows: 27. BUILT 20, NOT-GAME 5, UNREAD 2 (HP-6d's writer, ARM-7's enter-while-burning).
None of the 27 rows is MISSING: this slice has been gone over many times, and most rows
are built and simply not cited by id. The gaps come from the sweep.

Sweep findings: MISSING 2, PARTIAL 1, UNREAD 2.

Top findings by impact:
1. MISSING, medium: **a destroyed vehicle's own death explosion does no damage and pushes nothing.** `Armor::status` calls `handleExplosion` with the hull's `explosionDamage` and `explosionRadius` (5 at 8 m on every vanilla tank, jeep and plane), credited to the hull's last hitter. Ours draws the blast and hurts nobody.
2. MISSING, medium online and low offline: **team-kill consequences.** On a TK, retail adds an extra respawn delay of `spawnDelayPenaltyForTK` (default 1 s) per TK, keeps a TK count against `nrOfTKToKick` (default 5), and supports `TKPunish`/`TKForgive` when `serverTKPunishMode` is on. Ours has the console aliases and none of the behaviour.
3. PARTIAL, medium: **mines and explosives packs live in a per-weapon pool of 2 x magSize + 1.** Laying past the pool silently recycles the oldest one, and the pool is destroyed with the weapon. Ours keeps every round it laid until its own `timeToLive` runs out.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [MISSING] [impact: medium] [effort: S] A vehicle's death explosion deals no splash damage or push
- Retail: `Armor::status(float)` 0x081739e0. After the destruction message (`pushl $0x15` at 0x08173d62), if `explosionDamage` (`Armor+0x100`) is above the threshold at `ds:0x86c0308`, it calls `game` vt+0x38, which is `handleExplosion` 0x08156ef0. The arguments (0x08173d89..0x08173df0) are:
  - the hull's position;
  - `explosionRadius` `+0xf8`, then `+0xfc` (by order, `explosionForce`/`ForceMod`);
  - `explosionDamage` `+0x100`;
  - the Armor's **lastHitPlayer `+0x14` as the attacker**, stat id -1 and team -1 (so `calcDamage` never scales it, HP-9c);
  - `explosionMaterial` `+0x104`, the object, 1.0, and byte `+0x30`.

  The ledger has this as HP-2's tail and HP-8's open caveat. The vanilla data, read from `Objects.rfa` today: every land vehicle and plane writes `explosionDamage 5`, `explosionRadius 8`, with `explosionForceMod` 5..20 (Sherman 13, Willy 20, Spitfire 15). `Elco80` uses radius 5. No vanilla template writes `explosionMaterial`, so the template default applies. Which constructor field that is has not been read: `SimpleObjectTemplate` ctor 0x081dbc70 writes `0xcc` (204) to `+0xe4`, which is a candidate.
- Ours: `vehicle-damage.js` `applySplash` is fed only by projectile records (`vehicle-hits.js:433`, `server/room-hits.mjs:204`). No code in viewer, server or sim reads a hull's `explosionDamage` or `explosionRadius`, and `bf42/con.py` does not parse them for vehicles: only `explosion_radius` on projectiles, and the force words for soldiers. `vehicle-wrecks.js` plays the death tier's effect only.
- A player notices: when they stand beside a tank, jeep or plane as it is destroyed, or are seated next to one parked. Retail hurts and shoves them, and a kill made this way goes to whoever destroyed the hull. Ours leaves them untouched.
- To build:
  1. Export `explosionDamage`, `explosionRadius`, `explosionMaterial` and `explosionForce*` per vehicle template in `extract_map.py`'s damage table (the `damage` layer, `patch_scene.py`).
  2. On a hull's death in `vehicle-damage.js` and `server/room-pads.mjs`, build a splash record and run `applySplash` through the same path a round's blast takes: no FF scaling, attacker = `lastHitPlayer`.
  3. Run `knockback.js` for the push.
  4. Read the default `explosionMaterial` first, and check the `damageMod` pair against soldier material on the lab.

### [MISSING] [impact: medium] [effort: M] Team-kill penalties, punish and forgive
- Retail (lnxded, read today):
  - `_giveDamage` 0x0814b870, on a team kill between two non-AI players (vt+0x5c tested on both, 0x0814c167..0x0814c182): it stores `attackerId + 0x100` in the victim's `BFPlayer+0x188` (0x0814c1bc), the pending punish.
  - When `serverTKPunishMode` (`GameServer+0x4e1`) is **off**, it increments the attacker's TK counters `+0x190`/`+0x18c` at once. If `nrOfTKToKick` (`+0x4d8`) is non-zero and the count reaches it, it calls `killPlayer(attacker, false)` at 0x0814c224 (0x0814c1d2..0x0814c224).
  - When the mode is **on**, the counters move only through `GameServer::TKPunish(int)` 0x081593d0. That function ends with GameServer vt+0x334 (likely the kick) once the count reaches `nrOfTKToKick`. `TKForgive(int)` 0x081592e0 decrements them, and both clear the pending `+0x188` to -1.
  - `killPlayer` 0x0814d920 sets the TKer's next spawn to the normal delay plus `round(+0x190 x spawnDelayPenaltyForTK +0x4d4)`, then zeroes `+0x190` (0x0814df1f..0x0814df8b).
  - Constructor defaults (`GameServer::GameServer` 0x0812f450): `spawnDelayPenaltyForTK` 1.0 (0x812f8b9), `nrOfTKToKick` 5.0 (0x812f8c3), punish mode off (0x812f8f6). Shipped `ServerSettings.con`: `game.serverTKPunishMode 0`. There is also `setBanPlayerOnTKKick`.
  - No ledger row exists. `bot-friendly-fire/README.md:161` lists these settings as never read.
- Ours: `console-aliases.js` defines `punish`, `forgive`, `tkspawndelay` and `tklimit`, and nothing implements them. `friendly-fire.js` prices FF damage, and `round-state.js` scores `tk`. Nothing delays a team killer's respawn, counts their TKs, or offers the victim punish or forgive.
- A player notices: a team killer respawns on the normal timer. In retail, each TK adds a second to their next respawn, and at the 5th, which still needs settling on the lab, the server acts (killPlayer in the default mode, a kick when punish mode is on). Online rooms with punish mode on show the victim a punish/forgive choice. Offline it matters little, because bots do not TK humans by intent.
- To build:
  1. Add a ledger row (TK-1 or FF-9).
  2. Add per-player TK counters and the spawn-delay penalty in `server/authority.mjs` and the page's respawn timer (`spawning.js`).
  3. Optionally add punish mode with victim prompts in `net-room.js` and the HUD.
  4. Settle first on the lab what `killPlayer(attacker)` at count >= 5 and vt+0x334 do.

### [PARTIAL] [impact: medium] [effort: S] Mine and explosives-pack pool: the oldest is recycled, and all vanish with the weapon
- Retail: FA-2 (`FireArms::initProjectilePool` 0x08287a80). `ExpPack` and `Landmine` (names at 0x86d224c and 0x86d2f8f, read today) get a pool of `2 x magSize + 1` = 9. `createProjectile` 0x0828bdb0 takes `pool[+0x1e8]` and wraps, which re-uses the oldest object (through `resetProjectile`, no explosion). `releaseProjectilePool` 0x08287ee0, called from `~FireArms`, destroys every one when the weapon object dies.
- Ours: `gunfire.js` keeps every laid round in `this.projectiles` until its own `timeToLive` runs out (360 s for a mine, 240 s for a pack) or it detonates. There is no cap per weapon and no removal when the weapon or kit goes away (`kit-drops.js` has no tie to rounds).
- A player notices: an engineer who re-supplies at a depot and lays a tenth mine in retail sees the first one disappear. In ours they can carpet a road. Whether mines in retail vanish when the engineer's dropped kit despawns depends on when the kit's FireArms is destroyed, which has not been read.
- To build: a `poolSize` per group in `round-launch.js` and `gunfire.js` (wrap and silently drop the oldest), plus a release when the owning weapon is destroyed. First read who destroys a hand weapon (Kit death or soldier death) to settle the second half.

### [UNREAD] [impact: low] [effort: S] What entering a critically damaged (burning) vehicle does (ARM-7)
- Retail: `PlayerControlObject::enter` calls `isCriticalDamaged` (+0xcc at 0x8317095) and, when that is true, `getHpLostWhileCriticalDamage` (+0xd4 at 0x83172b9). What consumes the float is untraced.
- Ours: entry is not gated on critical damage, which is correct as far as is known.
- To settle: disassemble `0x83172b9..` in `PlayerControlObject::enter`, and record a lab entry into a burning tank.

### [UNREAD] [impact: low] [effort: S] HP-6d: who writes `lastCollisionHeight`
- The row itself notes that three readings disagree: the HP-6d write site, PARA-8's running maximum in `Armor::update`, and ARM-7's `exit(bool)` +0xf8 call. Ours (`fall-damage.js`, HP-14) uses the last contact height. A soldier who jumps out of a vehicle mid-air, or falls off a ledge they never touched, would be priced differently under each reading.
- To settle: read `Armor::update`'s writes to `+0x28` and the `0x8318103` call site.

## From the sweep: retail behaviour with no ledger row

- **The hull's death explosion damage** (above). It is mentioned in HP-2 and HP-8 but never rowed as built or unbuilt.
- **TK penalties: punish, forgive, TK count, kick, respawn penalty** (above). No row.
- UNREAD, low, effort S: **debris "cascades" are physical objects.** `e_RichoCascades{Wood,Stone,Metal,Plane}` and `e_BuildingDust` emit `Gibb_*` templates. Each is a `SimpleObject` with `setHasCollisionPhysics 1`, `setHasResponsePhysics 1`, `hasMobilePhysics 1`, `destroyed 1` and `sinkInToLandAfterDeathSpeed 10` (the B17 wreck pieces use 0.1). They bounce, come to rest and sink into the ground. Ours tumbles mesh particles (`effects.js` "Tumbling debris") and has no `sinkInToLand` anywhere. This is cosmetic, seen when heavy rounds hit wood or stone. To settle: check whether `effects.js` gives emitter-templated `SimpleObject`s any ground contact.
- Checked and found consistent with retail:
  - Retail has no assist credit: `handleScore` kinds are 0..9 only, so there are no assists to build.
  - Crew kills on a hull's lethal call (AI-76) are built in `vehicle-damage.js` `killedBy`.
  - Roadkill credit is built: `server/authority.mjs` `runOvers` and `map.html` `runOverContacts`.
  - Battle of Britain's destroyable factories and radar towers work as pad-spawned Armor objects with DestroyTarget objectives (`objectives.js`, OBJ-1..6). The 2026-09-25 audit found vanilla placed statics otherwise indestructible: no bridges, no buildings.
  - Kill-line weapon names (KILLSTAMP) are built in `vehicle-damage.js` `killedWith` and `chat-log.js`.

## BUILT and NOT-GAME, one line each

- HP-6b BUILT: a shell skips the firer's own root (`server/room-hits.mjs`, the firer's hull left out; `friendly-fire.js` `roundPasses`).
- HP-6c NOT-GAME: an internal dispatcher shape; terrain and object contacts both reach `crash-damage.js` and `fall-damage.js`.
- HP-6d BUILT, with the open question above: `fall-damage.js` uses `lastCollisionHeight`.
- HP-8 BUILT: `vehicle-damage.js` `applySplash` excludes the firer by owner, and end-of-life blasts hurt the thrower.
- HP-9c BUILT: `friendly-fire.js` `friendlyDamage` / `friendlyFireRatio` (the god-mode early-out `+0x2ec` is NOT-GAME).
- HP-9f BUILT: `projectile-damage.js` `diesOnContact` / `restsOnContact`, and the type-4 flak shells delete on contact.
- HP-11 BUILT: soldier 30 HP (`server/authority.mjs`, kit `maxHitpoints` fallback 30; `sim/level.mjs`).
- HP-12 BUILT: the vehicle HUD reads the occupied hull's Armor (`vehicle-hud.js`); the Sherman values come through the damage table.
- HP-23 BUILT: `soldier.js` feeds `swim.swimming || swim.depth > 0` to `swim.js` `DrownTimer`.
- ARM-4 NOT-GAME: the client Armor's layout.
- ARM-7 BUILT for the entry gate: `server/room-control.mjs`, `spawn-seat.js`, `deployables.js` (`isDestroyed`).
- PROX-4 BUILT: `proximity-fuse.js` `FUSE_UNDERWATER_MIN_MASS` 50000.
- PROX-5 BUILT: `proximity-fuse.js` runs no team test.
- PROX-8 BUILT: fuse words in `damage.json` (`proximityFuseOf`).
- PROX-9 BUILT: `proximity-fuse.js` `DEFAULT_PROJECTILE_MASS` 1.0.
- IMP-3 BUILT: `effects.js` decal mesh particles, `MAX_DECALS`.
- IMP-4 BUILT: `effects-core.js` alpha byte against `alphaTestRef 0.5`.
- IMP-12 BUILT for the replay: `replay-accuracy.js` from the server's `roundStats`. Live play shows no accuracy table, and whether the retail client ever draws one (IMP-11) is unread.
- EMT-1 BUILT: `effects-core.js` `|1/intensity|` spacing and `intensityAtSpeed`.
- EMT-7 BUILT: `effects.js` `addChild` follow.
- EMT-13 BUILT: casings are non-colliding mesh particles drawn in the near pass (`effects.js:305`).
- SPR-2 NOT-GAME: the client's sprite system plumbing.
- SPR-4 NOT-GAME: 101-sample curve rasterising (an implementation detail; the curves are sampled in `effects-core.js`).
- SPR-9 BUILT: `SRGBColorSpace` in `effects.js`, `gun-cycle.js`, `round-visuals.js`.
- BOMB-6 BUILT: `bomb-release.js` (barrels x `asynchronyFire` table).
- KILLSTAMP-1 BUILT: `vehicle-damage.js` `killedWith`, `chat-log.js` `how.weapon`.
- KILLSTAMP-2 BUILT: `net-relay.js` `kind` / `teamKill`, `net-room.js`, `chat-log.js` `deathLines`.
