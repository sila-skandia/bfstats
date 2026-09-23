// The engineer's demolitions: the explosives pack and the detonator, two
// weapons on one slot, and the engine's rule that binds them (AltFire swaps
// them, the "4" key falls through to the plunger on an empty pouch, Fire on
// the plunger sets off every pack this kit put down). Owns which pack/plunger
// pair the kit carries and the gun group the plunger reaches. Lifted out of
// hand-weapon.js (features/vehicle-instance-refactor Part 2c).

/**
 * Built once by `createHandWeapon`. `page` is the narrow bag of getters it
 * builds, naming what this module reads:
 * `beginHandFire`, `deployKit`, `deployTeamId`, `dropClick`, `guns`,
 * `handWeapon`, `itemsLocked`, `kitAmmo`, `kitLoadout`, `kitWeaponSlots`,
 * `loadHandWeapon`, `loadouts`, `optOnFoot`, `optPilot`, `selectKitWeapon`,
 * `showWeaponBar`, `slotOf`, `soldier`, `soldierTemplateFor`.
 */
export function createDemolitions(page) {
  const demolitions = {};

  // --- the engineer's plunger --------------------------------------------------
  //
  // The explosives pack and the detonator are two weapons on one slot, and the
  // rule that binds them is the engine's, read out of
  // `BFSoldier::handleMessage` (lnxded `0x08277260`). `BFSoldierTemplate::init`
  // (`0x0827a8a2`) resolves five templates BY NAME — `ExpPackProjectile`,
  // `ExpPack`, `Detonator`, `MedPack`, `RepairPack` — and caches them at
  // `+0x2a4`..`+0x2b0`; the message handler then compares whatever is in hand
  // against those pointers:
  //
  //   AltFire (message 7) holding **ExpPack**    -> `selectItem(11)`, the
  //                                                 Detonator's `itemIndex`
  //                                                 (`0x82779c0`)
  //   AltFire holding **Detonator**              -> posts message 13 to itself
  //                                                 (`0x82779a9`), which is
  //                                                 MenuSelect4 -> `selectItem(4)`
  //                                                 -> back to the pack
  //   Fire (message 6) holding **Detonator**     -> `getItemFromIndex(4)`, and
  //                                                 if that is the ExpPack,
  //                                                 `FireArms::detonateProjectiles`
  //   MenuSelect4 (the "4" key)                  -> `selectItem(4)`; if what
  //                                                 ends up in hand is NOT the
  //                                                 ExpPack, `selectItem(11)`
  //
  // That last rule is why the plunger is reachable at all once the pouch is
  // empty: `ExpPack` declares `cantSelectWhenNoAmmo 1`, so with four packs
  // already down `selectItem(4)` refuses and the fallback hands you the
  // detonator. The debug string the engine keeps for the Fire path is literally
  // `"ExpPack NotFound!"` (`0x86d2091`).
  //
  // The names are hardcoded in the engine and so they are hardcoded here. What
  // is NOT hardcoded is whether this kit carries them: a kit's `items` list in
  // `_shared/loadouts.json` is the engine's own `addTemplate` order, and a kit
  // without a Detonator in it never reaches any of this.
  const EXPLOSIVES_ITEM = 'exppack';
  const DETONATOR_ITEM = 'detonator';
  // The kit's own spelling of each, or null — a mod may case them differently,
  // and `loadHandWeapon` wants the name the data uses.
  demolitions.explosivesTemplate = null;
  demolitions.detonatorTemplate = null;
  // The gun group whose rounds the plunger reaches: the engine keeps the live
  // list on the ExpPack weapon object itself (`FireArms+0x1d8`), which survives
  // a weapon switch because the kit owns it. This page destroys a weapon when
  // it leaves the hand, so the group is remembered here instead — the rounds
  // already in the air keep their own reference to it, which is what makes
  // that survivable (`disposeHandWeapon`'s surgical splice). Cleared on every
  // spawn, because a new life is a new kit and an empty array; packs left over
  // from the last one run their 240 s fuse out on their own, exactly as they
  // do in the game.
  demolitions.thrownPackGroup = null;

  /** The pouch's own counts (`kitAmmo`), which outlive the pack's rig the way
   *  every item's do — null until the pack has been raised once this life. */
  function packAmmo() {
    return demolitions.explosivesTemplate ? page.kitAmmo.peek(demolitions.explosivesTemplate) : null;
  }

  /** Charges left in the pouch. 1 (i.e. "some") when the pack has never been
   *  raised, or declares no magazine, so a mod whose pack has no `magSize` is
   *  never locked out of it. */
  function packsLeft() {
    const pouch = packAmmo();
    return pouch && Number.isFinite(pouch.size) ? Math.max(0, pouch.rounds) : 1;
  }

  /** Is `template` the pack, or the plunger? Case-insensitive, like `slotOf`. */
  function isExplosives(template) {
    return String(template || '').toLowerCase() === EXPLOSIVES_ITEM;
  }
  function isDetonator(template) {
    return String(template || '').toLowerCase() === DETONATOR_ITEM;
  }

  /** Re-read which pack/plunger pair this kit carries. Called wherever the kit
   *  is (re)armed, next to `kitWeaponSlots`. */
  function armDemolitions(flag) {
    const { kit } = page.kitLoadout(flag?.team, page.deployKit);
    const items = page.loadouts?.kits?.[kit]?.items;
    demolitions.explosivesTemplate = Array.isArray(items)
      ? items.find(isExplosives) || null : null;
    demolitions.detonatorTemplate = Array.isArray(items)
      ? items.find(isDetonator) || null : null;
  }

  /** Raise the plunger.
   *
   *  No number key reaches it: its `itemIndex` is 11, past `c_PIMenuSelect9`,
   *  which is exactly why the engine spends an AltFire branch and a
   *  MenuSelect4 fallback on getting there. `_shared/loadouts.json` does carry
   *  it as slot 11, so the ordinary selector can do the work and the weapon bar
   *  stays honest; a kit table that does not list it still loads by name.
   *  True if it came up (or was already up). */
  function selectDetonator() {
    if (!demolitions.detonatorTemplate || !page.optOnFoot.checked || !page.soldier || page.optPilot.checked) {
      return false;
    }
    // Reached only by AltFire (message 7) or MenuSelect4 (message 13), and both
    // are on the far side of `handleMessage`'s `c_AsmHideWeapon` gate.
    if (page.itemsLocked()) return false;
    if (isDetonator(page.handWeapon?.name)) return true;
    const slot = page.slotOf(page.kitWeaponSlots || [], demolitions.detonatorTemplate);
    if (slot != null) return page.selectKitWeapon(slot);
    page.showWeaponBar();
    page.loadHandWeapon(demolitions.detonatorTemplate, page.soldierTemplateFor({ team: page.deployTeamId }));
    return true;
  }

  /** AltFire on the demolitions pair: pack <-> plunger. True if it took the
   *  press, so the zoom/aim branch does not also see it. */
  function altFireDemolitions() {
    // Message 7. `handleMessage` drops it while `c_AsmHideWeapon` is up, so a
    // swimming engineer can neither reach his plunger nor come back off it.
    if (page.itemsLocked()) return false;
    const name = page.handWeapon?.name;
    if (isExplosives(name)) return selectDetonator();
    if (isDetonator(name)) {
      // The engine posts itself MenuSelect4 here, so this is exactly the "4"
      // key — including its own fallback, which hands the plunger straight
      // back when the pouch is empty.
      page.selectKitWeapon(page.slotOf(page.kitWeaponSlots || [], demolitions.explosivesTemplate) ?? 4);
      return true;
    }
    return false;
  }

  /** Work the plunger: every pack this kit's ExpPack put down goes off at once,
   *  through the same `Projectile::detonate` the end of a fuse calls. */
  function fireDetonator(hw) {
    page.dropClick();
    // The Fire message reaches the held weapon as well as the packs (the
    // engine leaves its forward flag set on this path), so the plunger plays
    // its own clip and its own `Detonator.ssc` report whether or not anything
    // was out there to set off.
    page.beginHandFire(hw);
    hw.cool = Math.max(hw.cool, 1 / (hw.data?.roundOfFire || 1));
    if (!demolitions.thrownPackGroup) return 0;
    const count = page.guns.detonateProjectiles(demolitions.thrownPackGroup);
    if (!page.guns.liveProjectiles(demolitions.thrownPackGroup)) demolitions.thrownPackGroup = null;
    return count;
  }

  /** A charge just left the hand, from `group`: the group the plunger reaches
   *  from now on. */
  function packThrown(group) {
    demolitions.thrownPackGroup = group;
  }

  /** A fresh kit: a plunger wired to nothing. */
  function forgetThrownPacks() {
    demolitions.thrownPackGroup = null;
  }

  Object.assign(demolitions, {
    altFireDemolitions,
    armDemolitions,
    fireDetonator,
    forgetThrownPacks,
    isDetonator,
    isExplosives,
    packAmmo,
    packThrown,
    packsLeft,
    selectDetonator,
  });
  return demolitions;
}
