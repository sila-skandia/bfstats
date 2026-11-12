# soldier-weapons

## Summary

35 ledger rows: BUILT 32, NOT-GAME 2, UNREAD 1. The sweep found 6 more, read in
`bf1942_lnxded.static`: MISSING 2, DIFFERENT 3, PARTIAL 1.

The rows are almost all built. Hand-weapon fire, zoom, shake, deviation, recoil,
reload, the item gates and kit drops all follow retail and cite it. The gaps sit
around the engineer's and medic's special items:

1. **MISSING, high**: an engineer who crouches with the wrench disarms mines and
   explosive packs, and gets the round back. `disarmMinesDistance` is that
   reach. A crouched engineer also repairs nothing. Our wrench has no disarm and
   repairs in any stance.
2. **DIFFERENT, medium**: a dead engineer's mines and packs vanish unexploded
   when his kit is destroyed (30 s after a death on foot, at once after a death
   in a seat). Ours run out their 240 s / 360 s fuse and then explode.
3. **DIFFERENT, medium**: the wrench will not repair a hull whose team is the
   other side's. Ours repairs any hull.
4. **DIFFERENT, medium**: a bot medic heals one friend, in a 20 deg cone, at
   0.3 HP a round (3 HP/s), and never heals itself. Retail heals every wounded
   soldier within 10 m at 0.25 a round, and the holder at 0.15.
5. **MISSING, medium (also for the AI bucket)**: bots never lay mines, place
   charges, repair or resupply. `BBMine`, `BBExplosives`, `BBRepair` and
   `BBResupply` are in lnxded, and no ledger row covers them.
6. **PARTIAL, low**: the projectile pool. The 10th live mine recycles the
   oldest. A picked-up kit brings the dead man's laid packs onto the new
   holder's detonator.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [MISSING] [impact: high] [effort: S] A crouched engineer's wrench disarms mines and explosive packs, and gives the round back
- Retail: `BFSoldier::useRepairPack` `0x08276100` sets a flag from `getPose() == 1`, which is crouched (`0x0827612d`..`0x08276139`; pose 1 = crouch per BODY/DIE rows, `0x0827ddc0`). The sweep radius is `max(repairDistance +0x2ec, disarmMinesDistance +0x2f0)` (`0x0827613d`). `disarmMinesDistance` is `BFSoldierTemplate+0x2f0`: `ConsoleClass188::executeObjectMethod` `0x082bd7f0` stores it, and the ctor default is 2.0 (`movl $0x40000000, 0x2f0` at `0x0827a39a`). For each candidate:
  - **Crouched** (`0x082764ed`), only candidates whose template id is `ExpPackProjectile` (`+0x2a0`) or `LandmineProjectile` (`+0x2b4`) count. `BFSoldierTemplate::init` resolves those two names at `0x0827a8c5` / `0x0827aa6e` and stores them at `0x0827c0fb` / `0x0827beb2`. A candidate qualifies when `distSqr <= (candidate.getBoundingRadius() + disarmMinesDistance)^2` (`0x08276546`..`0x08276572`). The holder's item at index 4 (for a pack) or index 5 (for a mine) is then checked: it must be a `FireArms` whose projectile template is this one. If it is, `FireArms::reloadAmmo(1)` runs (`0x082765f6`), so the engineer gets the charge back. Either way `Projectile::resetProjectile` (`0x082765e4`) removes the round and the function returns. That is one disarm per invocation, with **no team test**, so friendly mines are lifted too.
  - **Not crouched**, the repair branch runs (`0x08276690`). While crouched no hull candidate is ever kept: the best-hull local `-0x74` is only written in the uncrouched branch, so the post-loop heal at `0x082761d6` is skipped.
- Ours: `viewer/hand-fire.js` `useRepairPack` repairs the nearest wounded hull in any stance. Nothing anywhere disarms a mine or a pack (`git grep -i disarm` finds only audio code). The comment there also misreads `+0x2a0`/`+0x2b4` as "the vehicle class tables". They are the two projectile templates above.
- A player notices: in retail, an engineer crouches over an enemy mine field with the wrench and clears it, picking the mines up. That is standard engineer play. On our page a mine can only be set off by a vehicle, or left to its 360 s fuse.
- To build: in `hand-fire.js` `useRepairPack`, branch on the holder's stance. When crouched, look for the first live `LandmineProjectile` / `ExpPackProjectile` round within `round radius + disarmMinesDistance` (data key from `kit-loadout.js` `REPAIR_PACK`, default 2.0, through `holderValue('disarmMinesDistance')`). Retire it without a blast (`gunfire.js` / `round-launch.js` pool) and add one round to the holder's matching item (`kit-ammo.js`). When not crouched, repair as today. In multiplayer the server room needs the same removal. Add a ledger row (none cites `+0x2f0`).

### [DIFFERENT] [impact: medium] [effort: S] A dead engineer's mines and packs vanish with his kit; ours explode minutes later
- Retail: the rounds come from the weapon's projectile pool (FA-2). `releaseProjectilePool` `0x08287ee0`, run from `~FireArms`, hands every pooled round to `GameServer::destroyObject`, with no `detonate`. The weapon dies with its kit. A death in a seat destroys the kit at once (KITDROP-1). A death on foot leaves the kit for 30 s, after which `Kit::handleMessage` destroys it with its items (KITDROP-5). A server recording confirms it: `replay-props.js` header, kit 14434 of `replay_20260928-133433` at 187.46 s, four mines gone unexploded.
- Ours: `demolitions.js` says leftover packs "run their 240 s fuse out on their own, exactly as they do in the game", and mines use `projectile-damage.js` `roundTimeToLive` (360 s), then detonate. `kit-drops-page.js` removes no rounds when a kit expires. The replay path (`net-server-rounds.js` `gone`) already does it right, because it follows the server.
- A player notices: on the page, an engineer's mine field stays deadly for 6 minutes after the engineer dies, and his packs go off by themselves 4 minutes later. In retail both are gone half a minute after the death, and at once if he died in a tank.
- To build: tag each pooled round with the kit object that fired it. When `kit-drops-page.js` expires or destroys a kit (including a death in a seat), retire that kit's live rounds without a blast. `demolitions.js` and the round-launch pool are touched.

### [DIFFERENT] [impact: medium] [effort: S] The wrench will not repair a hull held by the other side
- Retail: in `useRepairPack`'s hull branch (`0x08276690`..`0x08276737`), the candidate's Armor component is queried (`0xc4a4`). The code walks up its parents to the first object answering interface `0xc4c5` (the PlayerControlObject interface; class `0xc4c2`). If that object's `vt+0x74` (its team) is non-zero and differs from the soldier's `+0x53c` (`BFSoldier::getTeam` `0x0827fa30` reads it), the candidate is skipped (`cmp 0x53c(%edi),%eax; jne skip`). That `vt+0x74` is `getTeam` on that interface is inferred from the compare against the soldier's team. Naming the vtable of interface `0xc4c5` would settle it.
- Ours: `hand-fire.js` `useRepairPack` has no team test.
- A player notices: on our page an engineer can repair an enemy tank that is sitting next to it, or one the enemy has just left if that hull keeps its team. In retail the wrench does nothing to it.
- To build: in `useRepairPack`, skip a hull whose current team (`vehicleDamage` / the seat's team, `teamOnVehicle`) is set and is not the holder's. Add a ledger row.

### [DIFFERENT] [impact: medium] [effort: S] A bot medic heals at the wrench's numbers, one friend in a cone, and never itself
- Retail: `useMedPack` `0x082768d0` (SUP-15) heals every wounded soldier within `healDistance` (vanilla 10 m), friend or enemy, by `healFactor` (0.25) per invocation. It then heals the holder by `selfHealFactor` (0.15). At the MedPack's 10 rounds/s that is 2.5 HP/s to each soldier in reach and 1.5 HP/s to the holder. The player's pack on our page does this already (`hand-fire.js` `useMedPack`).
- Ours: `bot-referee.js` `fireRound` handles a `healing` weapon with `resolveHeal`, which takes one same-team friend inside a 20 deg cone within `maxRange + 0.5`. It heals that friend by `BOT_HEAL_PER_ROUND` = 0.3, which is 3 HP/s. The bot never heals itself. The constant's comment derives it from `useRepairPack` and `+0x2e0`, which is `repairFactor`, not the medic's factor (`bot-behaviours.js` `healPerRound` says the same).
- A player notices: a bot medic heals one person, 20% faster than a human medic. It never patches itself up, and it does not heal the whole group around it the way a human's pack does.
- To build: have `bot-referee.js` call the same sweep `hand-fire.js` `useMedPack` uses (every wounded soldier within `healDistance` plus self-heal, factors from `kit-loadout.js` `MEDIC_PACK`). Keep `BBPMedicAssist`'s approach for the walk only.

### [MISSING] [impact: medium] [effort: L] Bots never lay mines, place charges, repair hulls or go to resupply (AI bucket: please cross-check)
- Retail: lnxded has `dice::bf::ai::BBMine` (`calculateUrgency` `0x08574b50`), `BBExplosives` (`0x085627b0`), `BBRepair` (`0x085760f0`) and `BBResupply` (`0x08576920`), with their plans. No ledger row reads any of them (`grep BBMine|BBRepair|BBExplosives|BBResupply ledger.md`: none).
- Ours: `viewer/bot-behaviours.js` builds `BBScout` and `BBMedicAssist` among the infantry specials. Nothing names a mine, a charge, a repair or a resupply behaviour.
- A player notices: a bot engineer never mines a road or blows a bridge or tank, and never fixes a damaged tank. A bot never walks back to an ammo crate.
- To build: read the four `calculateUrgency` functions and their `BBP*::createPlan` into AI rows, then add them beside `MedicState` in `bot-behaviours.js` / `bot-plans.js`. A bot laying mines also makes the first two findings matter more.

### [PARTIAL] [impact: low] [effort: S] Projectile pool limits: the oldest mine is recycled, and a picked-up kit brings its laid packs
- Retail: FA-2. The pool holds `2 x magSize + 1` rounds for the weapons named `ExpPack` and `Landmine`. `createProjectile` takes `pool[+0x1e8]` and wraps, so once an engineer has refilled at a depot and laid past the pool, the oldest live mine is reset and disappears. The pool lives on the weapon, which goes with the kit. Whoever picks up a dead engineer's kit (KITDROP-7) can set off the dead man's laid packs with its detonator, and that player's own packs go with the kit they dropped.
- Ours: no cap on live rounds per weapon. `demolitions.js` clears `thrownPackGroup` on every spawn and keeps it per page, not per kit.
- A player notices: rarely. Only on a long life with depot refills, or after picking up an engineer kit next to his charges.
- To build: keep a per-weapon pool, sized as FA-2 says, in `round-launch.js`. Store the pack group on the kit record that `kit-ammo.js` adopts on pickup.

### [UNREAD] [impact: low] [effort: M] KIT-5: does every machine see the kit variant the server rolled
- Retail: open in the row. `CreateObjectEvent::eventReceivedByRemote` `0x0811d420` builds the kit on each client, and it is unread whether `KitNetworkable` overwrites the client's own `Random*` roll.
- Ours: the server room and the page each roll.
- A player notices: only with FHSW random kits in multiplayer, as a weapon drawn differently from the one fired.
- To build: read `KitNetworkable` (`0x0822b600`..) to settle it. Then either have the room send the roll, or keep the current approach.

## From the sweep: retail behaviour with no ledger row

- `disarmMinesDistance` (`BFSoldierTemplate+0x2f0`, default 2.0) is read by `useRepairPack` (`0x0827613d`, `0x08276561`). It is the crouched disarm reach above, not a dead word.
- `useRepairPack` repairs nothing while the holder is crouched, and disarms only then.
- `useRepairPack` has a team gate on hulls (`0x08276731`).
- `BFSoldierTemplate+0x2a0` = `ExpPackProjectile`, `+0x2b4` = `LandmineProjectile` (completing SUP-27's `+0x2a4`..`+0x2b0`).
- The engineer AI behaviours `BBMine`, `BBExplosives`, `BBRepair` and `BBResupply` are unread.
- Checked and already built, uncited or cited elsewhere: grenade throw strength from alt fire (`hand-alt-fire.js`, GUN-19). Grenades have no cooking: the fuse runs from creation. Reload drops zoom (`hand-fire.js` `startReload`). `selectBestLoadedWeapon` on an empty item (`hand-fire.js`). The refill sound at a depot (`page-audio.js` `playRefillSound`). Hand recoil (`recoil.js`, FA-22/FA-26). The detonator/pack swap (`demolitions.js`). Binocular spotting (SPOT rows). The medic pack heals enemies too (`hand-fire.js` `useMedPack`). Kit pickup (KITDROP-6/7). Mines are never set off by soldiers (`proximity-fuse.js`).
- The client's weapon camera: the Mac dump has no separate "weapon camera" class. The first-person weapon view is `BFSoldier::applyFovModifier`, `set1pFov` / `SoldierZoomFov` and the drawFov pass, all built in `hand-fire.js` (the two-FOV block) and `arms-rig.js` (VIEW-8/9/10, EMT-12). `BFSoldier::nextCamera` is empty (`soldier-camera.js`).

## BUILT and NOT-GAME, one line each

- CS-2 BUILT: shake slots chained 0..2 -> `viewer/fire-shake.js` `CameraShake` (slot advance).
- CS-5 BUILT (a negative): the shake is not scaled by speed -> `fire-shake.js`/`foot-body.js` pass dt only.
- CS-7 BUILT: the sniper's two-slot shake -> `extract_viewmodel.py` `clips.<family>.cameraShake` + `fire-shake.js`.
- CS-13 BUILT: shake end resets the trigger machine -> `viewer/replay-camera.js` `hurt` / `triggerSlots('CstHitShake')`, `foot-body.js`.
- CS-14 BUILT: `cameraShakeFactor` clamp -> `viewer/soldier.js` `setCameraShakeFactorGlobal`.
- CS-15 BUILT: BF1918's 0.8 bob -> `bf42/con.py` `read_soldier_global`, `foot-body.js` `applySoldierMovement`.
- MLK-4 BUILT: the look key in every view -> `viewer/mouse-look-key.js`, `local-look.js`.
- MLK-5 BUILT: `toggleMouseLook` on the pilots' cameras -> `mouse-look-key.js`, `local-look.js:683`.
- MLK-6 BUILT: `c_PIMouseLook` on Air's Left Shift -> `controls-defaults.js` air map, `controls-rows.js`.
- MLK-11 BUILT (a negative): keyboard sensitivity is stored and never applied -> `controls-rows.js`/`controls-edit.js`, `world-input.js:23`.
- MLK-12 NOT-GAME: the analogue mask is never sent; nothing to play (`mouse-input.js:61` notes it).
- MLK-18 BUILT: a look axis with no acceleration stays still -> `mouse-look-key.js:169`, `bf42/con.py` `rig()`.
- VIEW-5 BUILT: +x = right in `soldierCameraPosition` -> `hand-weapon.js` / `arms-rig.js` view frame.
- VIEW-9 BUILT: the 1P near pass with its own projection -> `arms-rig.js:702`, `hand-weapon.js:824`.
- VIEW-10 BUILT: zoom scales the mouse by `zoomFov` -> `viewer/local-look.js:144-171`.
- VIEW-13 BUILT: 1 rad vertical FOV for every view -> `local-player.js:298`, `seat-view.js:230`, `mesh-cull.js`.
- ZOOM-2 BUILT: un-zoom between shots, reload and switch unzoom -> `hand-fire.js` (`rezoom`, `startReload` `hw.zoomed = false`).
- ZOOM-3 BUILT: the sniper's 3 s un-zoom, rifle hidden while scoped -> `hand-fire.js`.
- DEV-1 BUILT: the channels add -> `viewer/deviation.js` header `total = minDev + fire + speed + turn + misc`.
- DEV-4 BUILT: fire bloom adds and decays -> `deviation.js`, `fire-state.js:86`.
- DEV-6 BUILT: turn scales with |MouseLook|, speed gated -> `deviation.js:16-18`.
- DEV-7 BUILT: miscDev on the jump tick only -> `deviation.js:19-25`, `hand-fire.js:988`.
- FA-15 BUILT: `cantSelectWhenNoAmmo` -> `viewer/kit-select.js`.
- FA-16 BUILT: `isSticky` -> `projectile-flight.js` `followStuck`, `gunfire.js` `FuseRoundBody`.
- FA-18 BUILT: `hideDuringFireTime` in ticks -> `fire-timer.js` `hideTicks`.
- FA-21 BUILT: reload lets the trigger through after `timerTicks(reloadTime)` -> `hand-fire.js` `startReload` (`reloadTicks`).
- FA-24 BUILT: magazines vector and `getTotalAmmo` -> `kit-ammo.js`, `kit-select.js` `totalAmmo`.
- KIT-6 BUILT: two weapons at one `itemIndex` -> `kit-select.js` `heldKitSlots`, `kit-loadout.js`.
- KITDROP-3 BUILT: the kit's geometry, no HUD mark -> `kit-drops-page.js`.
- KITDROP-4 BUILT: 30 deg/s yaw -> `kit-drops.js` `KIT_YAW_SPEED`.
- KITDROP-5 BUILT: 30 s life -> `kit-drops.js` `KIT_TIME_TO_LIVE` (but see the "vanish with his kit" finding: the rounds are not tied to it).
- KITDROP-8 BUILT: bots never pick up kits -> `kit-drops.js:62`.
- SCOPE-5 BUILT: the scope HUD variables -> `soldier-hud.js` (`471ced32`).
- CAM-3 NOT-GAME: `updateFlags(set, clear)` argument order, an internal reading.
