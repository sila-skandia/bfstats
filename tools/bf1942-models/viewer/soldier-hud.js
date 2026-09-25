import { AMMO_TYPE_CODES, AMMO_TYPES_WITH_ROUNDS, hitFromDirAlpha } from './hud.js';

/**
 * The in-game HUD's soldier side: health, stance, kit and nation art, the
 * soldier ammo bars, the combat-area warning, the damage-direction arc and the
 * crosshair group (its hit marks and scope). Split out of `hud-feed.js`, which
 * keeps the HUD itself and the sprite pack.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `carriedKit`, `combatArea`, `combatFrame`, `crossHairColor`, `currentDir`, `deployKit`, `deployTeamId`,
 * `feedFlagIconVars`, `feedTicketVars`, `gameHud`, `handSlot`, `handWeapon`,
 * `isZoomed`, `kitLoadout`, `kitWeaponSlots`, `loadouts`, `occupancy`,
 * `optOnFoot`, `optPilot`, `playSoldierHurtSound`, `soldier`,
 * `soldierArmor`, `soldierDead`, `teamNation`, `WEAPON_ICON_VARS`,
 * `weaponBarUntil`.
 */
export function createSoldierHud(page) {
  const soldierHud = {};

  // c_BfSoldierStanding/Crouching/Lying, the engine's own pose vocabulary
  // (CommonSoldierData.inc), against the sprite pack's own suffix — a direct
  // rename, not an inference.
  const STANCE_TEXTURE = { stand: 'standing', crouch: 'crouching', prone: 'lying' };

  // OPEN [R1-12]: the nation key BFSoldierHud's stance icon actually reads was
  // never traced (verify-r1.md leaves it open). Approximated with the same
  // per-side nation the deploy screen's own kit art already resolves
  // (`teamNation`), translated only where the icon set's own filenames spell a
  // nation differently from the flag-mesh table (`jap`, where `hud.json`'s
  // `flagMeshNation` says `jp`) — an asset-naming difference this file already
  // has to bridge elsewhere, not a new engine fact.
  const STANCE_NATION = { us: 'us', ger: 'ger', brit: 'brit', rus: 'rus', jp: 'jap' };

  // The kit's own health-bar art, memoised: `kitLoadout` allocates a small
  // object per call, so this only re-resolves it when the level/team/kit
  // actually changed instead of on every rendered frame
  // (features/mesh-viewer-performance, rule 5). Compared field by field, not
  // via a joined-string key: a template literal built fresh every call to
  // throw away immediately is itself the per-frame allocation rule 5 rules out.
  // The kit is the one the soldier CARRIES: the client reads the art off the
  // template of the kit object his soldier holds (`getKitId` -> the object ->
  // its template's `+0x238` / `+0x254`, BF1942.exe 0x006ad7c4..0x006ad810),
  // so a kit picked up off the ground (`carried`, `kit-drops-page.js`) brings
  // its own bar with it.
  soldierHud.kitArtDir = null;
  soldierHud.kitArtTeam = null;
  soldierHud.kitArtKitName = null;
  soldierHud.kitArtCarried = null;
  soldierHud.kitArtCache = null;
  function kitHealthArt(team, kitName, carried = null) {
    if (team !== soldierHud.kitArtTeam || kitName !== soldierHud.kitArtKitName
        || carried !== soldierHud.kitArtCarried || page.currentDir !== soldierHud.kitArtDir) {
      soldierHud.kitArtDir = page.currentDir;
      soldierHud.kitArtTeam = team;
      soldierHud.kitArtKitName = kitName;
      soldierHud.kitArtCarried = carried;
      const resolved = carried ?? page.kitLoadout(team, kitName).kit;
      soldierHud.kitArtCache = (resolved && page.loadouts?.kits?.[resolved]) || null;
    }
    return soldierHud.kitArtCache;
  }

  // The stance icon's own nation, memoised the same way and for a bigger
  // reason: `teamNation` allocates a `Map` and walks every control point on
  // the level (found while reviewing this track — it was being called
  // unmemoised, once per rendered frame, the exact per-frame-allocation-plus-
  // O(n)-scan shape rule 5 exists to catch). The team's nation cannot change
  // without a fresh spawn, so this only re-runs it when the team or level did.
  soldierHud.nationArtDir = null;
  soldierHud.nationArtTeam = null;
  soldierHud.nationArtCache = null;
  function stanceNation(team) {
    if (team !== soldierHud.nationArtTeam || page.currentDir !== soldierHud.nationArtDir) {
      soldierHud.nationArtDir = page.currentDir;
      soldierHud.nationArtTeam = team;
      soldierHud.nationArtCache = STANCE_NATION[page.teamNation(team)] || (team === 1 ? 'ger' : 'us');
    }
    return soldierHud.nationArtCache;
  }

  /**
   * Keep `gameHud.vars` current with the soldier's own state, once per
   * rendered frame (HUD-3: the engine itself recomputes this HUD once per
   * `Renderer_drawFrame`, not the 30Hz tick) — called from `frame()`, right
   * before `gameHud.paint()`. Writes plain fields on an existing object only;
   * the nation and kit-art lookups are memoised above (rule 5), so the only
   * per-call allocation left is the display-string template literal itself.
   */
  // The "nothing to warn about" frame: what `CombatArea.step` returns inside
  // the area, hoisted so `updateSoldierHud` allocates nothing per frame.
  const IN_COMBAT_AREA = { countdown: 0 };

  // `setHudAmmoType` -> `Ammo/AmmoType`, and which of those print a round
  // count: both live in `hud.js` beside the rest of the layout's own
  // vocabulary, so `tests/hud_harness.mjs` can drive them under node. HUD-10.
  //
  // Every `soldierAmmo` variable this file writes, so a weapon swap starts from
  // nothing. The `Ammo/Primary*` names are shared with the vehicle panel, which
  // is fine: the two groups are mutually exclusive in the layout
  // (`Vehicle/ShowVehicleIcon` gates one and `NotData` of it the other), and
  // only one of them is fed at a time.
  const SOLDIER_AMMO_VARS = [
    'Ammo/AmmoType', 'Ammo/PrimaryAmmo', 'Ammo/MaxPrimaryAmmo', 'Ammo/PrimaryMag',
    'Ammo/SoldierAmmo/SoldierAmmoHasMag', 'Ammo/SoldierAmmo/SoldierAmmoIcon',
    'Ammo/SoldierAmmo/SoldierAmmoBar', 'Ammo/SoldierAmmo/SoldierAmmoBarFill',
    'Ammo/SoldierAmmo/SoldierAmmoBarSize',
  ];

  // The damage indicator: the red wash over the whole screen and the arc on
  // the side the damage came from (ledger HFD-1..HFD-6). The game keeps two
  // HUD fields, `HitFromDir` (0 is off, 1..8 the octant) and
  // `HitFromDirAlpha`, and only ever writes them together, on a hit. Nothing
  // fades them: the alpha holds until the layout's own `TimeoutActionNode`
  // puts `HitFromDir` back to 0, 0.2 s of menu time later. The menu's time
  // is not the frame's -- `BfMenu::paint` steps it 1/30 per painted frame,
  // whatever the frame rate -- so the flash is exactly six painted frames.
  // Written here and nowhere else, as is the HP the poll below last saw.
  const MENU_STEP = Math.fround(1 / 30);         // `Setup+0x184`, 1 / g_simulationFps
  const HIT_FROM_DIR_TIMEOUT = Math.fround(0.2);  // menu/InGame TimeoutActionNode
  soldierHud.hitFromDir = 0;
  soldierHud.hitFromDirClock = 0;
  soldierHud.lastSoldierHp = null;

  /** `BfMenu::setHitFromDir` (client 0x006acb60): both fields, and nothing
   *  else -- the timeout's clock keeps running through a second hit, so a
   *  burst does not stretch the flash. `alpha` is `hitFromDirAlpha`'s. The
   *  HP this hit took is marked seen, so the poll does not raise it again. */
  function triggerHitIndicator(direction, alpha) {
    soldierHud.hitFromDir = direction;
    page.gameHud.vars['HitFromDir/HitFromDir'] = direction;
    page.gameHud.vars['HitFromDir/HitFromDirAlpha'] = alpha;
    if (page.soldierArmor) soldierHud.lastSoldierHp = page.soldierArmor.hitPoints;
    page.gameHud.requestRepaint();
  }

  // The crosshair's hit marks (ledger XHIT-1..XHIT-4): the local player's own
  // `CrossHair/HitIndicationTime`. The game sets it to 1.0 when his round lands
  // directly on a soldier or on a manned hull -- friend or foe, the server never
  // compares teams -- and runs it down `t = max(0, t - dt)` every frame
  // (`BFPlayer::update`, client 0x00406890). The layout multiplies the four
  // marks' alpha by it, so they flash at full and are gone a second later; a
  // new hit starts them at full again rather than adding. `vehicle-hits.js`
  // raises it, where every round's impact is resolved.
  soldierHud.hitIndicationTime = 0;
  function raiseHitIndication() {
    soldierHud.hitIndicationTime = 1.0;
  }

  // Whether the loaded layout carries the marks' own alpha binding. A
  // `hud-layout.json` from before it has the four quads as plain unrotated
  // fills in near-black, which is why hip fire used to keep the group down;
  // until the file is re-extracted it still has to.
  soldierHud.hitMarksLayout = null;
  function layoutHasHitMarks() {
    if (soldierHud.hitMarksLayout?.layout === page.gameHud.layout) return soldierHud.hitMarksLayout.has;
    const has = (page.gameHud.layout?.groups?.crosshair?.elements || [])
      .some(el => el.alphaVars?.includes('CrossHair/HitIndicationTime'));
    soldierHud.hitMarksLayout = { layout: page.gameHud.layout, has };
    return has;
  }

  /** Put the wash and the arc out and forget the HP they were tracking (the
   *  body is gone). The game has no such reset; this one leaves its clock at
   *  zero, where every one of the game's own flashes starts. */
  function clearHitIndicator() {
    soldierHud.hitFromDir = 0;
    soldierHud.hitFromDirClock = 0;
    if (page.gameHud?.vars) {
      page.gameHud.vars['HitFromDir/HitFromDir'] = 0;
      page.gameHud.vars['HitFromDir/HitFromDirAlpha'] = 0;
    }
    soldierHud.lastSoldierHp = null;
  }

  function updateSoldierHud(dt = 0.016) {
    const vars = page.gameHud.vars;
    const inVehicle = page.optPilot.checked && !!page.occupancy;

    soldierHud.hitIndicationTime = Math.max(0, soldierHud.hitIndicationTime - dt);
    vars['CrossHair/HitIndicationTime'] = soldierHud.hitIndicationTime;

    if (page.soldierArmor && !page.soldierDead && !inVehicle) {
      if (soldierHud.lastSoldierHp !== null && page.soldierArmor.hitPoints < soldierHud.lastSoldierHp - 0.01) {
        const drop = soldierHud.lastSoldierHp - page.soldierArmor.hitPoints;
        page.playSoldierHurtSound(false);
        // HP lost outside `applyDamageToPlayer` -- a fall, drowning, the
        // combat area, a room's snapshot. The game washes the screen for
        // every one of them (they all reach `_giveDamage`, HFD-4), but points
        // the arc at a source this poll cannot name: the landing's contact
        // point, or the world's origin. So it raises 1, whose arc the data
        // never draws (MEME-14): the wash alone, which every octant shares.
        triggerHitIndicator(1, hitFromDirAlpha(drop, page.soldierArmor.maxHitPoints));
      }
      soldierHud.lastSoldierHp = page.soldierArmor.hitPoints;
    } else {
      soldierHud.lastSoldierHp = page.soldierArmor?.hitPoints ?? null;
    }

    // The layout's `TimeoutActionNode`, once per painted frame (HFD-5,
    // HFD-6). It runs only while its CullNode shows the group, and it fires
    // in the same update that still draws the frame, so the sixth frame
    // shows and the seventh does not. The clock is float32, as the game's is.
    if (soldierHud.hitFromDir !== 0) {
      vars['HitFromDir/HitFromDir'] = soldierHud.hitFromDir;
      soldierHud.hitFromDirClock = Math.fround(soldierHud.hitFromDirClock + MENU_STEP);
      if (soldierHud.hitFromDirClock >= HIT_FROM_DIR_TIMEOUT) {
        soldierHud.hitFromDirClock = 0;
        soldierHud.hitFromDir = 0;
      }
    } else if (vars['HitFromDir/HitFromDir']) {
      vars['HitFromDir/HitFromDir'] = 0;
    }
    // Any seat at all, which `seats.js` answers for: `occupancy` is non-null
    // from the moment `setPilot` seats someone until `leaveVehicle` /
    // `exitManned` clears it, whatever the seat is — a cockpit, a driver's
    // bench, or a Defgun that has no drivetrain to be an `aircraft`/`car` at
    // all. This runs after `frame()`'s dispatch has already called
    // `feedVehicleHud`, so testing `aircraft || car` here would blank the
    // vehicle groups that a manned gun had just filled in.
    // A seated soldier's optOnFoot box is still ticked — he is only suspended,
    // per disposeHandWeapon's own comment on the old #ammo element — so the
    // vehicle check has to be explicit here too.
    // A dead body is in the world (his corpse and the ticket counter stay) but
    // his HUD is not: retail drops the stance/health, weapon and ammo groups
    // the instant the local player dies -- the death cam shows only the
    // minimap, the tickets and the spawn chrome -- so everything below the
    // ticket feed gates on `onFootActive`, which a death clears.
    const inWorld = page.optOnFoot.checked && !!page.soldier && !inVehicle;
    const onFootActive = inWorld && !page.soldierDead;
    // The `CrossHair` group itself (XHIT-10). The client builds it shown and
    // only a generic HUD show()/hide() moves it: `CrossHairType` and
    // `ScopeIndex` decide what it draws, not whether it is up. So it is up
    // whenever the player is in the world, on foot or in any seat, and it
    // stays up through the death cam -- the owner's recording draws the cross
    // over the dropped helmet -- which is what lets a hit landed in the last
    // instant finish its fade. No periscope is modelled, and that gate has to
    // read false, not unfed, or the whole group culls. Nothing feeds
    // `CrossHairType`: the DOM `#crosshair` draws the cross (updateCrosshair),
    // so the layout's share is the hit marks and, below, the scope.
    vars['CrossHair/ShowCrossHair'] = (inWorld || inVehicle) && layoutHasHitMarks();
    vars['Submarine/ShowPeriscope'] = false;
    vars['CrossHair/ScopeIndex'] = 0;
    // `game.setCrossHairColor`, in the profile's 0-255: the layout divides by
    // 256 itself, as the game's does (XHIT-7).
    const crossHairRgb = page.crossHairColor();
    vars['CrossHair/CrossHairRed'] = crossHairRgb[0];
    vars['CrossHair/CrossHairGreen'] = crossHairRgb[1];
    vars['CrossHair/CrossHairBlue'] = crossHairRgb[2];
    // The ticket counter is not the soldier's, and its own `when` is only
    // `ShowTicket`, so it would otherwise ride over a free-fly camera — where
    // this viewer deliberately shows no HUD chrome at all and the game would
    // not be in a round. Gate it on the player being in the world (on foot or
    // in any seat), which is the same condition that raises the rest of the
    // HUD. Fed before every early return below, because a soldier who has just
    // died leaves `soldier` null while the counter is still up in the game.
    page.feedTicketVars(vars);
    if (!inWorld && !inVehicle) vars['ShowTicket'] = false;
    // The soldier ammo panel is gated on `Ammo/AmmoType` alone (plus not being
    // in a vehicle), and the live branches below only ever write it, so a
    // death would leave the last magazine readout painted over the death cam.
    // In a seat the shared `Ammo/Primary*` names carry the vehicle's own feed,
    // hence dead-only here.
    if (page.soldierDead) for (const name of SOLDIER_AMMO_VARS) delete vars[name];
    // The flag-status disc beneath the minimap: the layout's own `ShowFlagIcon`
    // leaf at (720,230) 64x64 (the neutral white flag while the local player
    // stands inside a neutral control point's radius; the screenshot's little
    // white flag). One question, answered from `nearestEnemyFlag` over the same
    // `flags` the capture law reads. `AxisFlagIcon` / `AlliedFlagIcon` stay
    // unfed — CTF-only leaves with no conquest meaning.
    page.feedFlagIconVars(vars);
    // The combat-area warning, drawn by the layout's own `outside` group.
    // `stepCombatArea` leaves `combatFrame` null whenever nothing the engine
    // would call a player is in the world, and its countdown is 0 while that
    // player is inside — either way the group culls, the engine's own gate
    // being `0 < Outside/OutsideTime`. Not gated on `onFootActive`: the warning
    // is exactly as much the pilot's as the rifleman's.
    page.combatArea.feed(vars, page.combatFrame || IN_COMBAT_AREA);
    // T4a / V-R4: retail keeps the soldier stance icon inside vehicles.
    vars['Soldier/ShowSoldierIcon'] = !!page.soldier && (onFootActive || inVehicle);
    vars['Vehicle/ShowVehicleIcon'] = inVehicle;
    vars['Weapon/ShowWeaponIcon'] = onFootActive && !!page.handWeapon;
    // The weapon bar (the kit's inventory row the game paints while a weapon
    // is being selected — layout group `weaponBar`, gated on this one var, so
    // a stale true could draw it over a cockpit): up for a beat after the last
    // selection input, on foot only. Written before every early return below.
    const weaponBarUp = onFootActive && performance.now() < page.weaponBarUntil;
    vars['Weapon/SelectingWeapon'] = weaponBarUp;
    if (!weaponBarUp) {
      // Only cleared here — the icon/slot values themselves may stay stale
      // while the bar is down, because every weaponBar leaf is gated on
      // SelectingWeapon and culls whole.
      for (const key of page.WEAPON_ICON_VARS) vars[key] = null;
      vars['Weapon/WeaponSelect'] = null;
    }

    if (!page.soldier) return;

    const iconNation = stanceNation(page.deployTeamId);
    const stanceWord = STANCE_TEXTURE[page.soldier.stance] || 'standing';
    vars['Soldier/SoldierIcon'] = `Soldier/Icon_${iconNation}_soldier_${stanceWord}.tga`;

    // The kit glyph is baked into these two textures already (opened
    // healthbar_full_scout_64x64.png directly: the scout scope icon sits in the
    // art itself), not a separate layout element — feeding these two is the
    // whole of "the health bar and its kit art".
    const art = kitHealthArt(page.deployTeamId, page.deployKit, page.carriedKit ?? null);
    vars['Soldier/SoldierHealthBarIcon'] = art?.healthBarIcon;
    vars['Soldier/SoldierHealthBarFullIcon'] = art?.healthBarFullIcon;

    // TEMPORARY seed, not a feed: `Soldier/SoldierHitPoints` and
    // `SoldierMaxHitPoints` are supply-and-health's (BRIEFING2), and nothing in
    // this worktree tracks damage yet. Vanilla's own constant
    // (CommonSoldierData.inc: HitPoints 30, MaxHitPoints 30) seeds the bar so
    // its fill layer has something to paint before that track lands; the `??=`
    // means a real tracked value, once written, is never stomped back to this.
    vars['Soldier/SoldierMaxHitPoints'] ??= 30;
    vars['Soldier/SoldierHitPoints'] ??= 30;

    // SCOPE-1 / V-R5: CrossHair/* is owned here (T5). Off-foot, `ScopeIndex`
    // stays at the 0 written above so the overlay cannot stick into a seat.
    // Soldier art above already ran for the seated case (T4a).
    if (!onFootActive) return;

    // The weapon bar's own contents while it is up: the spawned kit's
    // inventory — one icon per `addWeaponIcon` entry (slot order, loadouts'
    // `weapons` list), painted at the slot's own numbered rect the way the
    // engine raises it (a mod kit with no slot-2 weapon leaves that rect's
    // variable unfed, so the layout's literal picture shows — HUD-1), and the
    // highlighted fill on the slot in hand. The variable names come from the
    // prebuilt WEAPON_ICON_VARS so nothing allocates per frame.
    if (weaponBarUp && page.kitWeaponSlots) {
      for (let slot = 1; slot <= page.WEAPON_ICON_VARS.length; slot++) {
        const entry = page.kitWeaponSlots.find(w => w.slot === slot);
        vars[page.WEAPON_ICON_VARS[slot - 1]] = entry ? (entry.icon || null) : null;
      }
      vars['Weapon/WeaponSelect'] = page.handSlot;
    }

    const hw = page.handWeapon;
    if (!hw) return;
    // SCOPE-1 / V-R5: FireArms::setZoom writes ScopeIndex 0/1 when useScope;
    // weapon sync copies ScopeIcon / SniperSight / SightIcon. spriteKeyFromRef
    // in hud.js turns `sniper.tga` into atlas key `sniper`. The group is forced
    // up here for the one layout that could not otherwise show it: one from
    // before the hit marks' binding, whose group stays down in hip fire.
    const zoom = hw.data?.zoom;
    const scoped = !!(zoom?.scope && page.isZoomed());
    if (scoped) {
      vars['CrossHair/ShowCrossHair'] = true;
      vars['CrossHair/ScopeIndex'] = 1;
      vars['CrossHair/SniperSight'] = !!zoom.sniperSight;
      vars['CrossHair/ScopeIcon'] = zoom.icon || 'sniper.tga';
      if (!zoom.sniperSight) {
        // Binoculars branch (SCOPE-3): ring via SightIcon. sightIcon is not yet
        // extracted on weaponStats — fall back to the layout's authored default.
        vars['CrossHair/SightIcon'] = zoom.sightIcon || 'scout_ring_128x128.tga';
      }
    }
    const magazine = hw.data?.magazine;
    const hudAmmo = (hw.data?.hudAmmo || '').toLowerCase();
    const ammoHud = hw.data?.hud;
    const ammoType = AMMO_TYPE_CODES[hudAmmo];
    // Every branch below only ever WRITES, so without this a weapon swap left
    // the previous weapon's leaves behind: switch off a bazooka and its rocket
    // icon stayed in `SoldierAmmoIcon`, switch to a knife (`ATNone`, which no
    // branch feeds) and the rifle's `AmmoType 1` kept the whole magazine panel
    // on screen. Harmless while only two branches existed and only one of them
    // fed an icon; not once every type in HUD-10's enum is reachable. Cleared
    // to undefined rather than to a zero, which is the painter's own rule.
    for (const name of SOLDIER_AMMO_VARS) delete vars[name];
    if (hudAmmo === 'atammobar' && magazine) {
      // R1-19/HUD-9, the magazine-bar branch. PrimaryAmmo is the loaded round
      // count (top-right, "14" in the retail shot); PrimaryMag is a SEPARATE
      // int, the spare-magazine count (bottom-right small box, "5") — the two
      // numbers verify-r1.md's report was asked to settle, and they are not
      // the same count.
      vars['Ammo/AmmoType'] = 1;
      vars['Ammo/PrimaryAmmo'] = hw.rounds;
      vars['Ammo/MaxPrimaryAmmo'] = magazine.size;
      vars['Ammo/PrimaryMag'] = hw.mags;
      // OPEN: no `.con` word or client write-site for SoldierAmmoHasMag turned
      // up in R1's survey; fed true unconditionally so the spare-count readout
      // shows at all for a magazine weapon — an assumption this file is making,
      // not a confirmed engine default.
      vars['Ammo/SoldierAmmo/SoldierAmmoHasMag'] = true;
      // The weapon's own bar art/size (weaponStats.hud), tolerant per HUD-1:
      // absent leaves hud-layout.json's own literal (vanilla's rifle-style bar).
      if (ammoHud?.ammoBar) vars['Ammo/SoldierAmmo/SoldierAmmoBar'] = ammoHud.ammoBar;
      if (ammoHud?.ammoBarFill) vars['Ammo/SoldierAmmo/SoldierAmmoBarFill'] = ammoHud.ammoBarFill;
      if (ammoHud?.ammoBarSize) vars['Ammo/SoldierAmmo/SoldierAmmoBarSize'] = ammoHud.ammoBarSize;
    } else if (ammoType >= 2) {
      // Every icon-style type. HUD-10 closed the enum: the `.meme` value and
      // the `.con` value are THE SAME enumeration, so the weapon's own
      // `setHudAmmoType` goes straight through with no converter to write.
      //
      // The one real change is `ATIcon`, which this fed as **6** on the
      // reasoning that 6 and 7 painted identically and the choice was
      // arbitrary. It is 2, and it is not arbitrary: the layout's `{2,3,4,5}`
      // group draws the rounds text (gated `ne 4 && ne 5 && ne 6`) where the
      // `{6,7}` group does not, so a Bazooka, Panzerschreck, ExpPack,
      // Detonator or Landmine was showing an icon with no rocket count beside
      // it. 6 is `ATIconAndHeatBar`, which in vanilla is the MedPack alone.
      //
      // `Ammo/PrimaryAmmo` is fed for every type whose layout branch prints it,
      // and left alone for the two that do not (4 `ATIconAndReloadBar`, the
      // RepairPack; 5 `ATIconNoText`).
      vars['Ammo/AmmoType'] = ammoType;
      // `magSize -1` is the engine's unlimited ammo (`hw.rounds` = Infinity),
      // and the detonator is the one weapon in vanilla that declares it AND an
      // icon type that prints a count — left alone it painted the word
      // "Infinity" beside the demokit icon. An unlimited weapon has no count to
      // print, so it gets none.
      if (AMMO_TYPES_WITH_ROUNDS.has(ammoType) && Number.isFinite(hw.rounds)) {
        vars['Ammo/PrimaryAmmo'] = hw.rounds;
      }
      if (ammoHud?.icon) vars['Ammo/SoldierAmmo/SoldierAmmoIcon'] = ammoHud.icon;
    }
    // `ATNone` (0, the two knives) and anything unrecognised leave
    // `Ammo/AmmoType` unset: every soldierAmmo leaf requires it, so the whole
    // panel culls rather than guessing a shape for a weapon this file cannot
    // classify. For a knife that is also what the engine does -- 0 is tested by
    // no layout branch at all.
  }

  Object.assign(soldierHud, {
    clearHitIndicator,
    kitHealthArt,
    raiseHitIndication,
    stanceNation,
    triggerHitIndicator,
    updateSoldierHud,
  });
  return soldierHud;
}
