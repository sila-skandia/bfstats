# orphan-words

Scope: every word in `tools/bf1942-models/tests/test_con_words.py` `ORPHAN_WORDS` (38) and
`tests/test_weapon_words.py` `UNREAD_WEAPON_WORDS` (33). Both tables were current: the two
test modules passed with the game installed on 2026-11-12. Template counts are vanilla +
XPack1 + XPack2, deduped by template name and taken from a value dump of the three packs.
The weapon table's own counts are FHSW's and are much larger.

Method, per word:
- the console object for its name in lnxded (the name string, then the static object the
  initializer fills, then its `ConsoleClassNNN` vtable and `executeObjectMethod`), which
  gives the template field it writes and its type (method or property, CON-15);
- the readers of that field (template offset scan over `objdump -d` of
  `bf1942_lnxded.static`), with the Mac client dump for client-only readers;
- where neither binary has the string at all, the console rejects the line with *Unknown
  object or method!* and the word is dead.

Scratch tools, not part of the repo, are in
`<audit scratch>/ow/`
(`con.py` maps a word to its console class and setter, `off.py` lists the readers of a
template offset, and `vals.json` holds every value the three packs write).

## Summary

| Class | Count | Words |
|---|---|---|
| DIFFERENT | 2 | `ammotype`; `settooltiptype`'s SPAWN-14 exemption (low) |
| MISSING | 13 | `explosiondamage`+`explosionradius`, `settooltiptype` (vehicle tooltip), `projectiletype`+`addtoprojectilelist` (friendly-mine HUD icon), `useasbone`+`setboneoriginoffset`, `usemmonendeffect`, `disablespawnpointsonenter`, `usebuttonradius`, `inverseheatbar`+`setheatbartype`, `destroyvehiclewhennoammo`+`disablewhenfired`, the five seat `*AngleMultiplier`s, `vehiclecamerashake` |
| PARTIAL | 1 | `noffsound` |
| UNREAD | 7 | `addpcoposid`, `hasstaticcolor`, `invisibleatendeffect` (the two set to 0), `projectile2template`, `setforwardmod`, `removeatrestart`, `setfirecamerashakeanimationstate`, `hasresponsephysics` (Wasserfall) |
| BUILT | 2 | `invisibleatendeffect` 1 (36 rounds), `sethasmag` |
| NOT-GAME | the rest | dead words (no string in either binary): the 14-word launcher deviation family, `projectilevisible`/`setprojectilevisible`, `startoneffects` (bare spelling of a method), `hasstarteffect`, `canberepaiedasdestroyed`, `deatheffectname`, `nocollisionsasdestroyed`, `stalingradhouse`. Writes equal to the default with no reader: the three spawnpoint words, `disarmminesdistance`, `useuvrotation`, `alphatestrefovertime`. Fields nothing reads: `dragoffset`, `isportalpassing`, `portalpassingposition`. Plumbing: `networkableinfo`, `setnetworkableinfo`, `hasdynamicshadow`, `guiindex`, `setinputid`, `cullradiusscale`, `delaytouse` |

Top findings by impact and template count:

1. **DIFFERENT, high: ammo boxes refill grenades, rockets and bombs at the bullet row's
   rate.** `AmmoType` (89 weapons) is not exported. The depot gives every item its first
   row's units: 15/s instead of 1.2/s for grenades and rockets at an ammo box, and 100/s
   instead of 4/s for bombs on an airfield.
2. **MISSING, medium-high: a destroyed vehicle's own blast deals no damage.**
   `explosionDamage 5` and `explosionRadius 8` are written on 52 vehicles and planes. HP-2 and
   HP-8 fire that blast through `handleExplosion`. Ours plays the effect and hurts no one.
3. **MISSING, medium: the vehicle tooltip.** 179 PCOs write `setToolTipType`. On entry, with
   tooltips on, the client shows that vehicle class's `TOOLTIP_*` help for 15 s, with four
   key bindings filled in.
4. **MISSING, medium: the friendly-mine HUD icon.** The landmine's `projectileType 1` and
   `addToProjectileList 1` put it in the ObjectManager's projectile map. The client's map
   node sets `ShowMineIcon` when a friendly mine is within 15 or 30 m. Nothing in ours sets
   `ShowMineIcon`, though the HUD pack has the widget.
5. **MISSING, medium (cosmetic): track belts do not ride their road wheels**
   (`useAsBone`/`setBoneOriginOffset`, 44 track templates). This is already scoped in
   `features/bf1942-3d-models/parity-audit/animation.md`.
6. **MISSING, low-medium: a grenade's, satchel's or rifle grenade's explosion effect does not
   change with the surface** (`useMMOnEndEffect`, 4 rounds).
7. **Correction to the weapon table:** the 14 Bazooka/Panzerschreck deviation words
   (`addDevFire`.. `subDevLying`), `projectileVisible` and the bare `startOnEffects` are
   listed OPEN there. They are dead in retail too, because neither binary registers them.
   There is nothing to build, and the table can move them to PLUMBING.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### DIFFERENT [impact: high] [effort: S] Depots serve every item from their first ammo row (`ammoType`, 89 weapons)
- Retail: SUP-2. `SupplyDepot::reloadAmmo` (`0x08323770`) gives a gun the units of the depot row whose
  id matches the gun's `FireArmsTemplate+0x238` tag (`FireArms::getAmmoType` `0x0828d4c0`). The
  data's `ObjectTemplate.ammoType` sets that tag. Vanilla's `AmmoboxSupplyDepot` has three rows:
  `1 -1 15 0` (bullets), `2 -1 1.2 0` (grenades and explosives) and `3 -1 1.2 0` (rockets). The
  airfield depots have `10 -1 100 0` and `8 -1 100 0` for guns and `9 -1 4 0` and `7 -1 4 0`
  for bombs. Vanilla writes `ammoType` on 33 hand weapons and 55 vehicle guns.
- Ours: `bf42/con.py` never reads the word, so `stats.ammoType` and `magazine.ammoType` are
  always null. `viewer/fire-state.js` `rearmTypeFor` then returns the first row that gave units,
  as its own comment says. `viewer/kit-ammo.js` `rearm` and the vehicle path both go through it.
- A player notices: at an ammo box, grenades, TNT and bazooka rockets come back at the bullet
  row's 15/s rather than 1.2/s, which is near-instant. A bomber on an airfield gets its bombs
  back at the gun row's rate. Ammo boxes become grenade fountains.
- To build: read `ammotype` in `bf42/con.py` onto the weapon's magazine and stats block. Both
  readers already expect `magazine.ammoType` and `stats.ammoType`. Re-export the weapon stats.
  Test against the Ammobox's three rows.

### MISSING [impact: medium-high] [effort: S] A destroyed vehicle's own explosion hurts nothing (`explosionDamage`/`explosionRadius`, 52 PCOs)
- Retail: HP-2. `Armor::status` (`0x081739e0`) fires the dying object's own explosion when
  `explosionDamage > 0.001`. HP-8 and HP-9 put it through `GameServer::handleExplosion`
  (`0x08156ef0`): a linear falloff `t = 1 - d/radius` times `explosionDamage` times the
  material damage mod, plus the knockback path (KNOCK-4..9), with `YModOnExplosion` forced to 1.
  The console writes template `+0xe0` (damage, `ConsoleClass121`) and the radius through `ConsoleClass120` (eom `0x081c4f50`). Values:
  every vanilla tank, plane and boat has `explosionRadius 8`, `explosionDamage 5`, and two have 10.
- Ours: `viewer/vehicle-damage.js` and `vehicle-wrecks.js` play the death tier's effect only.
  Nothing in viewer/, server/ or sim/ reads `explosionDamage` or `explosionRadius`, and the
  only splash comes from projectiles (`applySplash`).
- A player notices: in retail, standing beside a tank or plane as it blows up, or parking next
  to one, costs hit points and gives a shove. In ours a wreck going up next to you does nothing.
  This is weak against armour but felt by infantry, depending on the soldier's material mod.
- To build: export the two words onto the hull's Armor block in `bf42/con.py`. At death, call
  the existing splash (`vehicle-damage.js` `applySplash`, `effects-core.js` `splashDamage`, the
  soldier exposure path) with the hull's own explosion material, `sourceArmor` null and Y-mod 1.
  Do the same in `server/room-hits.mjs` for room play. HP-8's open caveat (how the wreck avoids
  damaging itself) means the dying hull should be excluded.

### MISSING [impact: medium] [effort: M] The vehicle help tooltip on entry (`setToolTipType`, 179 PCOs)
- Retail: the word is a method that writes `PlayerControlObjectTemplate+0x1e4` (`setToolTipType`
  `0x0831b9e0`). Its enum is parsed by `operator>>(ToolTipType)` `0x0829be20`: `TTHeavyTank`,
  `TTLightTank`, `TTArtillery`, `TTApc`, `TTScoutCar`, `TTFighter`, `TTDiveBomber`, `TTBomber`,
  `TTAAGun`, `TTStationaryMG`, `TTDestroyer`, `TTBattleship`, `TTCarrier`, `TTSubmarine`,
  `TTLcvp` and so on. In the client, `menu::Vehicle::enterVehicle` calls `enableVehicleTooltip`
  (Mac `0x0046b3b8`) when the profile's tooltip option is on (`menuManager+0xc` `+0x1c`, the
  profile's `Show tooltip` byte in `features/bf1942-in-the-browser/README.md`). That function
  takes `ToolTipManager::getToolTipString(type)` (`TOOLTIP_HEAVY_TANK` .. `TOOLTIP_SASWILLY`),
  fills in key strings for four controls (`0x23`, `0x24`, `0x3e`, `0x22`) and shows the result
  for 15.0 s (`0x402e000000000000`). `c_PIToolTip` (T) is bound in every control map.
- Ours: nothing. `TOOLTIP_*` never appears under viewer/. `comms.js` only builds the radio's
  own tooltip.
- A player notices: on entering a vehicle for the first time, retail shows a block of help text
  for that vehicle class with the player's own keys, and ours shows nothing. New players feel
  this the most.
- To build: export the tooltip type per PCO, the `TOOLTIP_*` lexicon strings, and the
  ToolTipManager's HUD node (`extract_radio.py` already flattens `BfTextNode`). Show it from
  `vehicle-hud.js` on entry for 15 s, behind the profile's tooltip flag, and let T toggle it.
  The rest of `ToolTipManager` (`TOOLTIP_CLOSE_TO_FLAG`, CTF-10) is the same mechanism.

### MISSING [impact: medium] [effort: S] Friendly-mine warning icon (`projectileType`, `addToProjectileList`: `LandmineProjectile`)
- Retail: `addToProjectileList` is ProjectileTemplate byte `+0x1d0`. `Projectile::activate`
  (`0x0831e2f3`) calls `objectManager` vt+0x94 `addProjectile`, and `destroy` and `detonate`
  call vt+0x9c `removeProjectile`. `projectileType` is `+0x1d4` (default -1). The server never
  reads `getProjectileMap` (vt+0x98). The client's `MenuMapNode::onPaint` walks that map
  (Mac dump, `objectManager + 0x98` at line 1580). For each round with projectile type 1 on the
  local player's team, it measures the player's distance to it against 15 m or 30 m (which one
  depends on a HUD state), and sets `hudManager+0x48` (`GamePlay`) `+8`, which is the
  `ShowMineIcon` BoolRefData (`GamePlay::registerMenuData`).
- Ours: `extract_hud_layout.py` exports the `supplyMine` widget gated on `ShowMineIcon`, but
  nothing in viewer/ ever sets `hudBridge.vars['ShowMineIcon']`.
- A player notices: in retail, walking or driving near a mine your own team laid lights a mine
  icon on the HUD, so you don't drive over it. Ours never warns.
- To build: export the two words on the round. Keep a live list of friendly type-1 rounds in
  `round-spawners.js` and `projectile-flight.js`. Set `ShowMineIcon` per frame in
  `soldier-view.js` from the nearest one. First settle which of 15 m and 30 m applies on foot.

### MISSING [impact: medium] [effort: M] Track belts are rigid (`useAsBone` + `setBoneOriginOffset`, 44 AnimatedBundles)
- Retail: `AnimatedBundleTemplate::useAsBone` (`0x082685a0`) and `setBoneOriginOffset`
  (`0x08268680`) bind each bogie dummy to a bone of the track's `.ske`, so the skinned belt
  follows the suspension.
- Ours: `viewer/track-scroll.js` scrolls only the texture: "The belt geometry itself stays
  rigid ... the exporter does not yet ship that skin."
- A player notices: on rough ground the road wheels move but the tread does not wrap them.
- To build: as `features/bf1942-3d-models/parity-audit/animation.md` lays out. Export glTF skins
  for AnimatedBundles with a `.skn` (`bf42/skin.py`, `bf42/ske.py`), then parse the two words to
  bind each Spring to its bone. Re-baking means every tree, per CLAUDE.md.

### MISSING [impact: low-medium] [effort: S] Explosive rounds choose their end effect by surface (`useMMOnEndEffect`: GrenadeAllies, GrenadeAxis, ExpPack, K98RifleGrenade)
- Retail: ProjectileTemplate byte `+0x14e`, read in `Projectile::startEndEffect` (`0x0831f602`).
  When it is set and the round has a collision interface, the effect comes from
  `materialManager` vt+0x50 for the round's material (`+0x208`) against the surface struck (or
  material 1 when vt+0xf4 holds). Otherwise it is the fixed `endEffectTemplate`. Mac
  `Projectile::startEndEffect` reads the same way.
- Ours: `round-impact.js` `detonate` plays `spec.endEffect` (`e_ExplGranade`) whatever is under
  the round.
- A player notices: a grenade in water or sand bursts with the same dirt explosion as on grass,
  and a satchel charge on a hull looks the same as on the ground.
- To build: export the flag. In `detonate`, when it is set, cast for the surface under the
  round and use `impactEffect(guns.damageEffects, attacker, material)` (`collision-materials.js`),
  as `replay-flights.js` `struck` already does for recorded rounds.

### PARTIAL [impact: low] [effort: S] The friendly-fire grunt and `noFFSound` (5 explosive rounds)
- Retail: FF-6. `Projectile::handleCollision` (`0x0831efe6`) calls `BFSoldier::projectileHit(team)`
  (`0x0827ea20`) only when ProjectileTemplate `+0x14f` (`noFFSound`) is clear. That plays sound
  slot 0x13 if the round is the soldier's own team's, at most once every 3.0 s (`0x086d2740`).
  It fires on a round's contact, not on damage. Grenades, TNT, landmines and the rifle grenade
  set `noFFSound 1`.
- Ours: `local-player.js` plays `c_SstFFHitDamage` on any friendly damage, explosives included,
  with a 0.9 s cooldown (`page-audio.js` `playSoldierHurtSound`).
- A player notices: a teammate's grenade that hurts you makes you shout "friendly fire" in ours.
  In retail, explosives never trigger that line.
- To build: carry `noFFSound` on the round and skip the FF variant for it. Moving the cooldown
  to 3 s is part of the same FF-6 alignment.

### MISSING [impact: low] [effort: S] Boarding a submarine shuts its spawns (`disableSpawnPointsOnEnter`: Gato, Sub7C)
- Retail: a PCO-template property (`ConsoleClass510`, eom `0x082f4920`). The reader was not
  traced. The name and the two writers, both XPack2 submarines that carry soldier spawns,
  suggest the hull's spawn points close once someone is aboard.
- Ours: nothing.
- A player notices: in Secret Weapons maps with submarines, players can still deploy onto a
  sub that a teammate has taken under.
- To build: read the template byte and its reader first (search for the getter's PCO vtable slot
  in `BFSpawnPoint::getActive` `0x08163de2`), then gate `deploy-screen` spawns on occupancy.

### MISSING [impact: low] [effort: S] Use-button vehicle spawner (`useButtonRadius 2`: GatoDaiHatsuSpawner, Sub7CDaiHatsuSpawner)
- Retail: `ObjectSpawnerTemplate+0x170` (`ConsoleClass432`), with getter
  `ObjectSpawner::getUseButtonRadius` `0x08314980`. The test table reads it as "the spawner is used
  by the action button, not by walking in", and `features/bf1942-parity-round-2026-09-19` touches
  the neighbouring literal.
- Ours: nothing. The submarine's boat pads spawn as any pad does.
- A player notices: the submarine's dinghy appears without anyone asking for it.
- To build: trace the getter's caller, then a use-key path in `level-statics.js` pads.

### MISSING [impact: low] [effort: S] Rocket heat bar (`inverseHeatBar 1`, `setHeatBarType B`: NatterEngine, WasserfallRocketEngine)
- Retail: `Engine+0x148` is the bar type. The client's `menu::Vehicle::update` takes
  `Engine::getHeat`, inverts it when `isHeatInversed`, and hands it with `getHeatBarType` to
  `OverHeatRecover::setRecoverData`. That is the vehicle HUD's engine heat bar, which for these
  two rocket motors reads as burn remaining.
- Ours: no engine-heat HUD bar at all. `vehicle-hud.js` has none, and the `Heatbar_*` textures
  are packed by `extract_hud_pack.py` but unused for engines.
- A player notices: flying the Natter, retail shows how much rocket burn is left, and ours does
  not.
- To build: model Engine heat for these engines (the Engine words are already read for the
  drivetrain), then drive the HUD's OverHeatRecover node.

### MISSING [impact: low] [effort: S] Wasserfall launcher self-disable (`destroyVehicleWhenNoAmmo`, `disableWhenFired`, 1 each)
- Retail: FireArmsTemplate `+0x1ed` and `+0x34a`, read in `FireArms::fireFinished`
  (`0x0828853d`, `0x08288569`, `0x082885a9`) and `ReloadFinished` (`0x08289ed0`). The launcher
  is destroyed once out of ammo, and its fire bundle disables after a shot.
- Ours: nothing.
- A player notices: on XPack2 maps with the Wasserfall, the launch pad keeps standing after
  its missile is gone.
- To build: honour both in `fire-state.js` and `vehicle-damage.js`, which kill the hull through
  `damage(1e10)` as SEAT-38 does.

### MISSING [impact: low] [effort: S] Seat look limits (`up/down/left/right/headMaxAngleMultiplier 0.1`: Sherman_T34CalliopeSeat)
- Retail: `SeatObjectTemplate+0x164..+0x174` (setters `0x083210a0`..`0x08321160`). The Mac
  `BFSoldier::handlePlayerInput` reads the getters.
- Ours: nothing reads them.
- A player notices: in the XPack2 Calliope's rocket seat, retail cuts free look to a tenth.
- To build: scale the seat's look clamps in `viewer-soldier-camera` and `seats.js`.

### MISSING [impact: low] [effort: S] Riding a missile shakes the camera (`vehicleCameraShake CstMachinegun`: WasserfallRocket)
- Retail: `PlayerControlObjectTemplate+0x244` (`setVehicleCameraShake` `0x0831c010`), read through
  `PlayerControlObject::getVehicleCameraShake` `0x08318c30`. It triggers the soldier's
  `triggerCameraShake` (`0x0827de20`) state.
- Ours: nothing.
- A player notices: only when steering a Wasserfall.
- To build: when the PCO is driven, play the named shake from `bf42/animstates.py`'s
  camera-shake blocks.

### DIFFERENT [impact: low] [effort: S] SPAWN-14's air exemption never fires
- Retail: SPAWN-14. `createObjectOnAllClients` (`0x08133a10`) does not hold an air hull whose
  `getToolTipType` is `0x24` (`TOOLTIP_WASSERFALL` in the client's `getToolTipString`).
- Ours: `level-statics.js` holds every air hull, as its comment says ("the trees carrying no
  tooltip type").
- A player notices: almost never. It only matters for a human standing on the Wasserfall's pad.
- To build: falls out of exporting `setToolTipType` for the tooltip above.

### UNREAD [impact: medium] `addPcoPosId` (9 PCOs: Fletcher and Hatsuzuki driver and deck PCOs)
- Retail: `PlayerControlObjectTemplate::addPcoPosId` (`0x0831be50`) appends to a vector at
  template `+0x1f4`, and `PlayerControlObject::getPcoPosId` (`0x083193a0`, PCO vtable +0x11c)
  returns it. The destroyer's driver PCO (`setPcoId 0`) adds pos 1 (the rear cannons' PCO id),
  and the deck MG PCOs add 6. This reads like "this PCO also answers for seat id N", for
  example the destroyer driver firing the rear guns when that seat is empty, but no caller was
  traced.
- Would settle it: the callers of PCO vt+0x11c and of the IPlayerControlObject thunk
  (`0x0831abf0`). Check `BFPlayer::_setVehicle`, `PlayerControlObject::handleMessage`
  (PHY-31's functions) and the seat-switch input.

### UNREAD [impact: low] `hasStaticColor` (35 damage-smoke sprites, mostly planes)
- Retail: template byte `+0x13c8`, read once in `Emitter::handleUpdate` (`0x081e4d5d`). When it is
  set and the emitter's host flag `+0x414` is set, the particle is added with a factor computed
  from the host's IID 0xc4a4 interface (`vt+0x1c / vt+0x14`, then `1 - x`) instead of the plain
  `addParticle`. This looks like smoke whose colour or alpha follows the host's speed.
- Would settle it: decompile that branch and `SpriteParticleNew::addParticle`'s 4-argument path.

### UNREAD [impact: low] `invisibleAtEndEffect 0` (KatyushaRocket, K98RifleGrenadeProjectile)
- Retail: ProjectileTemplate `+0x1a6`. lnxded never reads it, so it is a client draw gate.
  Katyusha also writes `stopAtEndEffect 0`. `features/rocket-flight/README.md` item 7 leaves the
  same question open.
- Would settle it: the client reader of `getInvisibleAtEndEffect`, and whether a round with
  `stopAtEndEffect 0` outlives its end effect.

### UNREAD [impact: low] `projectile2Template` (Binoculars)
- Open in `features/artillery-spotting/README.md` line 914. The console writes a string on
  the FireArmsTemplate (`ConsoleClass`, eom `0x082c74d0`).

### UNREAD [impact: low] `setForwardMod 100` (WasserfallRocket)
- Retail: `PlayerControlObjectTemplate+0x254` (default -1.0). The registered word is `forwardMod`
  (type 1, so `set` strips). lnxded has no reader past the constructor, so it is the client's
  (Mac `getForwardMod`) or nobody's.

### UNREAD [impact: low] `removeAtRestart` (Eagles_Safe_wreck1_M1, Krupp_silowreck_M1)
- Objective-mode wrecks. The `ConsoleClass431` eom works through virtual calls on the object.
  The likely meaning is that a wreck spawned during the round is not stood back up on a round
  restart. Settle it by reading `0x08187c10`'s callees.

### UNREAD [impact: low] `setFireCameraShakeAnimationState FireMachineGunShake` (14 mounted MGs), `hasResponsePhysics` (WasserfallFireArmsBundle)
- `setFireCameraShakeAnimationState` writes FireArmsTemplate `+0x25c` (default -1), and lnxded
  has no reader, so it is a client camera shake while firing a mounted MG. The viewer's fire
  shake covers hand weapons only (`hand-weapon-barrels-sight-and-heat` section 6). Settle it with
  the client reader of the getter.

## From the sweep: retail behaviour with no ledger row

- The vehicle tooltip (`ToolTipManager`, `enableVehicleTooltip`, 15 s, the four key slots) has no
  row. Neither does the T key's `c_PIToolTip`.
- The friendly-mine icon: `MenuMapNode::onPaint`, the projectile map, `projectileType 1`, the
  15 m / 30 m radii and `GamePlay` `ShowMineIcon`.
- `useMMOnEndEffect`: `Projectile::startEndEffect`'s material-manager branch.
- Dead console words that the data writes. The engine rejects these, and that is worth a ledger
  row so nobody builds them: `addDevFire`, `addDevJump`, `addDevPitch`, `addDevRun`,
  `addDevStrafe`, `addDevWalk`, `addDevYaw`, `minDevCrouching`, `minDevLying`,
  `minDevStanding`, `subDev`, `subDevCrouching`, `subDevLying`, `subDevStanding`,
  `projectileVisible`, `setProjectileVisible`, `hasStartEffect`, `canBeRepaiedAsDestroyed`,
  `deathEffectName`, `noCollisionsAsDestroyed` (the ledger's COL-1 lists it as live vocabulary,
  and hitpoints-and-damage.md already notes the string is absent) and `stalingradHouse`.
  None of them has a string in lnxded or BF1942.exe. `startOnEffects` is a special case:
  `setStartOnEffects` is a registered method (type 0, `ConsoleClass193`), so under CON-15 the
  data's bare `startOnEffects` (64 templates) is *Unknown object or method!*.

## BUILT and NOT-GAME, one line each

- BUILT `invisibleAtEndEffect 1` (36 bullets and rockets): rounds are removed at their end
  (`projectile-flight.js` `endRound`, `round-impact.js`).
- BUILT `setHasMag`: the HUD's `SoldierAmmoHasMag` is the template byte (FireArmsTemplate
  `+0x2bc`, default 1; client `SoldierAmmo::setSoldierAmmoData`). `soldier-hud.js` feeds true
  for magazine-bar weapons and leaves it unset for icon weapons, which matches every vanilla
  writer of 0 (grenades, TNT, mines, knives, kits). The Bazooka, Panzerschreck and rifle
  grenade writing 1 is worth one check.
- NOT-GAME `setSpawnPositionOffset`, `setSpawnRotation`, `setSpawnPreventionDelay` (27 ship
  spawn points): every write is 0/0/0 or 0, the `BFSpawnPointTemplate` constructor's own default
  (`0x0816a542`..`0x0816a563`), and no code reads the fields.
- NOT-GAME `disarmMinesDistance 2.0` (12 soldiers): the default is 2.0 (`0x0827a39a`). lnxded has
  no reader and no disarm code at all, so mines are never disarmed by distance.
- NOT-GAME `dragOffset` (5): `subsystems/physics.md` says neither law reads it and nothing calls
  the setter.
- NOT-GAME `useUVRotation 0` (1 sprite): equals the constructor default (`+0x59d = 0`).
- NOT-GAME `alphaTestRefOverTime` (4 sprites): written with no argument, so the ramp keeps its
  1.0 seed (SPR-4).
- NOT-GAME `isPortalPassing`, `portalPassingPosition` (12 soldiers): the indoor portal system
  (`PortalPassing`, `IPortalPassing.cpp`), a visibility and event subscription the browser
  renderer has no counterpart for.
- NOT-GAME (dead) `hasStartEffect`, `canBeRepaiedAsDestroyed`, `deathEffectName`,
  `noCollisionsAsDestroyed`, `stalingradHouse`: no string in either binary.
- NOT-GAME (dead) `projectileVisible`, `setProjectileVisible`, `startOnEffects`, and the 14
  `addDev*`/`minDev*`/`subDev*` words: see the sweep above.
- NOT-GAME (plumbing, as the table says) `networkableInfo`, `setNetworkableInfo`,
  `hasDynamicShadow`, `guiIndex`, `setInputId`, `cullRadiusScale`, `delayToUse`.
