// The weapon in the human's hand: what is in it (`soldierKit.handWeapon`,
// its load token, the kit's ammunition), the inventory slots and the weapon
// bar, the item gate, and the load, raise and teardown of a weapon. Lifted out
// of map.html (features/vehicle-instance-refactor Part 2) and split up after it;
// the rest is composed here from its own modules, each handed only what it
// reads:
//
//   kit-loadout.js      the kits and loadouts (the deploy row to a kit to its
//                       items, the bots' kits too); owns `loadouts.json`
//   arms-rig.js         the first-person arms rig, its near pass and the clip
//                       machine that follows the soldier's gait
//   hand-fire-sound.js  the report at the shoulder
//   demolitions.js      the engineer's pack and plunger
//   hand-fire.js        the fire loop: trigger, deviation, rounds on the bots,
//                       reload, zoom, and the page's `guns.onShot` hooks
//
// `createHandWeapon` stays the page's one entry point, and the object it
// returns (`soldierKit`) carries the same members it always did; a member
// another module owns is a read-only getter onto that module.

import * as THREE from 'three';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import { DeviationModel } from './deviation.js';
import { KitAmmo } from './kit-ammo.js';
import { createKitLoadout } from './kit-loadout.js';
import { createHandFireSound } from './hand-fire-sound.js';
import { createArmsRig } from './arms-rig.js';
import { createDemolitions } from './demolitions.js';
import { createHandFire } from './hand-fire.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `aimHeld`, `aircraft`, `applyDamage`, `AUDIO_OFF`, `audioListener`, `bodyAt`, `capsulesOf`,
 * `botRoundDamage`, `bots`, `bust`, `camera`, `captured`, `car`,
 * `clickQueued`, `currentDir`, `deployKit`, `deployTeamId`, `dropClick`,
 * `ensureFootBody`, `fireStates`, `footView3p`, `guns`, `hemi`,
 * `isCollision`, `KITS`, `lineOfSight`, `loader`, `LOCAL_PLAYER`,
 * `MAPS_BASE`, `masterVolume`, `MODELS_BASE`, `modelSoundBuffer`,
 * `optOnFoot`, `optPilot`, `params`, `playSupplyGive`, `renderer`, `scene`,
 * `soldier`, `SOLDIER_MAX_HP_FALLBACK`, `soldierDead`, `spawnLayout`, `sun`,
 * `supplyTarget`, `teamNation`, `triggerHeld`, `vehicleAudio`,
 * `warmSubtree`, `warmups`, `world`.
 */
export function createHandWeapon(page) {
  const soldierKit = {};

  // The kits and loadouts (`kit-loadout.js`): owns `_shared/loadouts.json`,
  // fetched here, at the same moment it always was.
  const loadout = createKitLoadout({
    get bust() { return page.bust; }, get currentDir() { return page.currentDir; },
    get deployKit() { return page.deployKit; },
    get deployTeamId() { return page.deployTeamId; },
    get handWeapon() { return soldierKit.handWeapon; }, get KITS() { return page.KITS; },
    get MAPS_BASE() { return page.MAPS_BASE; }, get params() { return page.params; },
    get SOLDIER_MAX_HP_FALLBACK() { return page.SOLDIER_MAX_HP_FALLBACK; },
    get spawnLayout() { return page.spawnLayout; },
    get teamNation() { return page.teamNation; },
  });
  const { kitLoadout, kitSlotsFor, slotOf, soldierTemplateFor, weaponTemplateFor } = loadout;
  Object.defineProperty(soldierKit, 'loadouts', {
    get: () => loadout.loadouts, enumerable: true,
  });

  // The shot's report (`hand-fire-sound.js`): owns the manifest, the bus and
  // the Fire Loop voice.
  const sound = createHandFireSound({
    get AUDIO_OFF() { return page.AUDIO_OFF; },
    get audioListener() { return page.audioListener; }, get bust() { return page.bust; },
    get masterVolume() { return page.masterVolume; },
    get MODELS_BASE() { return page.MODELS_BASE; },
    get modelSoundBuffer() { return page.modelSoundBuffer; },
    get weaponToken() { return soldierKit.weaponToken; },
  });
  const { ensureHandFireBus, fetchHandFireSound, playHandFire, refetchHandFireSound,
          releaseHandFireLoop, weaponSoundsManifest } = sound;
  Object.defineProperties(soldierKit, {
    weaponSoundsIndex: { get: () => sound.weaponSoundsIndex, enumerable: true },
    handFireBus: { get: () => sound.handFireBus, enumerable: true },
    handFireLoop: { get: () => sound.handFireLoop, enumerable: true },
  });

  // The first-person arms rig (`arms-rig.js`): owns the viewmodel scene, its
  // camera and light proxies, and the arms' clip machine.
  const armsRig = createArmsRig({
    get aircraft() { return page.aircraft; }, get bust() { return page.bust; },
    get camera() { return page.camera; }, get car() { return page.car; },
    get isCollision() { return page.isCollision; }, get loader() { return page.loader; },
    get MODELS_BASE() { return page.MODELS_BASE; }, get optPilot() { return page.optPilot; },
    get soldier() { return page.soldier; }, get warmSubtree() { return page.warmSubtree; },
    get warmups() { return page.warmups; },
    get weaponToken() { return soldierKit.weaponToken; },
  });
  const { playViewmodelClip, stanceDeployName, updateViewmodelAnimation,
          viewmodelRigFor, vmCamera, vmHemi, vmRoot, vmScene, vmSun } = armsRig;

  // The engineer's pack and plunger (`demolitions.js`): owns which pair the
  // kit carries and the gun group the plunger reaches.
  const demolitions = createDemolitions({
    get beginHandFire() { return fire.beginHandFire; }, get deployKit() { return page.deployKit; },
    get deployTeamId() { return page.deployTeamId; }, get dropClick() { return page.dropClick; },
    get guns() { return page.guns; }, get handWeapon() { return soldierKit.handWeapon; },
    get itemsLocked() { return itemsLocked; }, get kitAmmo() { return kitAmmo; },
    get kitLoadout() { return kitLoadout; },
    get kitWeaponSlots() { return soldierKit.kitWeaponSlots; },
    get loadHandWeapon() { return loadHandWeapon; },
    get loadouts() { return loadout.loadouts; }, get optOnFoot() { return page.optOnFoot; },
    get optPilot() { return page.optPilot; },
    get selectKitWeapon() { return selectKitWeapon; },
    get showWeaponBar() { return showWeaponBar; }, get slotOf() { return slotOf; },
    get soldier() { return page.soldier; },
    get soldierTemplateFor() { return soldierTemplateFor; },
  });
  const { altFireDemolitions, fireDetonator, isDetonator, isExplosives, packAmmo, packsLeft,
          selectDetonator } = demolitions;
  Object.defineProperties(soldierKit, {
    explosivesTemplate: { get: () => demolitions.explosivesTemplate, enumerable: true },
    detonatorTemplate: { get: () => demolitions.detonatorTemplate, enumerable: true },
    thrownPackGroup: { get: () => demolitions.thrownPackGroup, enumerable: true },
  });

  soldierKit.handWeapon = null;    // { name, data, rig, group, model, ammo, ... }
  // The soldier's ammunition, per kit item, for the life of the soldier
  // (`kit-ammo.js`). The rig in hand is destroyed and rebuilt on every slot
  // switch, so the counts cannot live on it: `hw.rounds` / `hw.mags` are
  // accessors onto this kit's entry for the weapon, which a switch away and
  // back finds exactly as it was left — a pouch thrown empty stays empty
  // until a spawn (`ensureHandWeapon`'s reset) or a depot (`refillAmmo`).
  const kitAmmo = new KitAmmo();
  // A supply depot's "give ammo" call (`supplyTarget`, above): the whole kit,
  // not just the item in hand — the engine's `reloadAmmo` walks every item
  // the soldier carries. Wired here rather than where `supplyTarget` is
  // declared only because this is where the kit's ammunition first exists.
  page.supplyTarget.refillAmmo = () => {
    // "Refill fully" is this viewer's own approximation of `reloadAmmo` — see
    // `supply.js`'s `SupplyDepot.tick` for why (SUP-8, SUP-23). Restores the
    // same full loadout a spawn equips with (`magazines - 1` spares) — one
    // magazine less than the pre-existing `__refill` perf-cheat below, which
    // is deliberately generous for a stress test rather than standing in for
    // a real mechanic.
    // A soldier who is owed nothing gets nothing, and hears nothing: the depot
    // ticks every half second for as long as he stands on it.
    if (!kitAmmo.refill()) return;
    // A magazine change in progress was for a magazine the box just filled.
    if (soldierKit.handWeapon) soldierKit.handWeapon.reload = 0;
    page.playSupplyGive();
  };
  soldierKit.weaponToken = 0;      // guards a slow load landing after a mode/map switch
  const crosshairEl = document.getElementById('crosshair');
  const aimOrigin = new THREE.Vector3();
  // Where the throwing hand is at the release frame, camera space (metres).
  const THROW_RELEASE = new THREE.Vector3(0.22, -0.10, -0.40);
  const throwHand = new THREE.Vector3();
  const aimDirection = new THREE.Vector3();

  // --- kit rotation ------------------------------------------------------------
  //
  // The engine's soldier carries every kit item in an inventory slot and the
  // number keys raise one: 1 knife, 2 pistol, 3 primary, 4 grenade, then the
  // special items (5 medpack / binoculars / ...), each weapon's slot being its
  // own `ObjectTemplate.itemIndex` (kit.py's census). `PRIMARY_ITEM_INDEX` 3 is
  // the slot the engine selects on spawn — `weaponTemplateFor` above — and
  // these two bring the rest of the inventory: keys 1..N and the scroll wheel
  // cycle what the level's kit actually hands out, from `_shared/loadouts.json`'s
  // per-kit `weapons` list (slot, template, weapon-bar icon).

  soldierKit.kitWeaponSlots = null;  // [{ slot, weapon, icon }] for the spawned kit
  soldierKit.handSlot = null;        // the slot number currently in hand, or null
  // How long the weapon bar stays up after the last selection input. The
  // engine's own read is `Weapon/SelectingWeapon`, whose client write site was
  // never identified (the layout's gating var is certain, its lifetime is not);
  // ~2 s after the last input matches the retail rhythm of scroll-and-fade.
  const WEAPON_BAR_MS = 2000;
  soldierKit.weaponBarUntil = 0;     // performance.now() deadline for the weapon bar
  // The weapon-bar icon variable names, built once (rule 5: nothing per frame).
  const WEAPON_ICON_VARS = Array.from({ length: 8 },
    (_, i) => `Weapon/Icon/WeaponIcon${i + 1}`);

  /**
   * THE ENGINE'S ITEM GATE: is there an active item at all?
   *
   * `c_AsmHideWeapon` (bit 0x2 of the LOWER animation machine's state flags) is
   * declared by all five swim states, and while it is up the engine leaves the
   * soldier with nothing in his hands. It is not a gate on the *input*: it is a
   * gate on the item, in three places, and `viewer/swim.js`'s `itemsLocked` has
   * the full derivation with addresses. The short version:
   *
   *   `BFSoldier::handleMessage`     `0x082772ac` — discards **every** message its
   *                                  jump table dispatches (6..22): Fire (6),
   *                                  AltFire (7), the MenuSelect slots (13 is
   *                                  MenuSelect4), everything.
   *   `selectBestLoadedWeapon`       `0x08273af4` — no automatic switch either.
   *   `enableItem(char)`             `0x082784b2` — nothing can be enabled.
   *
   * So every one of the page's own item verbs consults this, and none of them
   * special-cases the trigger. That is what the owner means by "locked down".
   */
  function itemsLocked() {
    return !!page.soldier?.itemsLocked;
  }

  /** Raise the weapon in `slot` (1..N) — the engine's
   *  `c_PIMenuSelect<slot>` (`c_PIWeaponSelect1..6` on the MemeFile side).
   *  Selecting the slot already in hand is a no-op, like the engine's. */
  function selectKitWeapon(slot) {
    if (!page.optOnFoot.checked || !page.soldier || page.optPilot.checked) return false;
    // `handleMessage`'s gate: a MenuSelect never reaches the dispatch while
    // `c_AsmHideWeapon` is up, so a swimmer cannot change weapon.
    if (itemsLocked()) return false;
    const entry = soldierKit.kitWeaponSlots?.find(w => w.slot === slot);
    if (!entry) return false;
    // `cantSelectWhenNoAmmo 1`: the engine refuses to raise a weapon with
    // nothing in it, and for the explosives pack that refusal is load-bearing
    // — its MenuSelect4 branch falls through to `selectItem(11)`, the
    // detonator, which is how you reach the plunger after putting all four
    // charges down. See `demolitions.js`.
    if (isExplosives(entry.weapon) && !packsLeft()) return selectDetonator();
    showWeaponBar();
    if (entry.slot === soldierKit.handSlot && !isDetonator(soldierKit.handWeapon?.name)) return true;
    soldierKit.handSlot = entry.slot;
    loadHandWeapon(entry.weapon, soldierTemplateFor({ team: page.deployTeamId }));
    return true;
  }

  /** Put the weapon bar up: `WEAPON_BAR_MS` from now. */
  function showWeaponBar() {
    soldierKit.weaponBarUntil = performance.now() + WEAPON_BAR_MS;
  }

  /** Scroll the inventory one entry `dir`(+1/-1) through slot order, wrapping —
   *  the wheel's own behaviour in the game. */
  function cycleKitWeapon(dir) {
    if (!soldierKit.kitWeaponSlots || soldierKit.kitWeaponSlots.length < 2) return false;
    const order = soldierKit.kitWeaponSlots.map(w => w.slot);
    const at = order.indexOf(soldierKit.handSlot ?? order[0]);
    const next = order[(at + dir + order.length) % order.length];
    return selectKitWeapon(next);
  }

  /** Tear down the viewmodel, its gun group and the HUD it owns. */
  function disposeHandWeapon() {
    releaseHandFireLoop();
    const hw = soldierKit.handWeapon;
    soldierKit.weaponToken++;
    soldierKit.handWeapon = null;
    page.dropClick();
    crosshairEl.hidden = true;
    if (!hw) return;
    if (hw.group) {
      page.guns.setFiring(hw.group, false);
      // Surgical, not `collect(replace: true)`: that would evict a flown
      // aircraft's guns too. Rounds already in the air keep their reference to
      // the group and finish their flight.
      const index = page.guns.groups.indexOf(hw.group);
      if (index >= 0) page.guns.groups.splice(index, 1);
    }
    armsRig.disposeRig(hw);
    // An aim in progress was narrowing the FOV; hand the soldier his own back.
    if (page.optOnFoot.checked && page.soldier) {
      page.camera.fov = FOOT_FOV;
      page.camera.updateProjectionMatrix();
    }
  }

  /** Load the weapon into hand — the arms rig where one is extracted for
   *  `soldierName` holding it, the bare `name`.glb where not — hang it off the
   *  camera-following `vmRoot` and index its gun. The template name must not be called `soldier`:
   *  that would shadow the live soldier the guard and `platformVelocity` read. */
  async function loadHandWeapon(name, soldierName = null) {
    disposeHandWeapon();
    const token = soldierKit.weaponToken;
    // The third-person body carries the same weapon welded into its hand, so it
    // is rebuilt beside the arms rig rather than only on spawn — raising the
    // knife has to change the body too. Fire-and-forget: it has its own token and
    // cannot delay the arms.
    page.ensureFootBody(soldierName, name).catch(
      err => console.warn('3P body:', err));
    // Kicked off now, in parallel with the (usually much bigger) visual load
    // below, rather than after `hw` exists: a JSON manifest plus one small mp3
    // almost always resolves before a rigged, textured glb does, so by the
    // time a soldier can even pull the trigger — which needs `hw` published,
    // which needs the glb below to finish first — the report is normally
    // already decoded. Sequencing it after `hw` (the previous shape of this
    // function) meant the fetch for a weapon's very first equip in the session
    // hadn't even started yet when firing became possible; a shot taken in
    // that window played the round but not its sound, on every hand weapon —
    // reproduced headless on the Garand, No4, Type5 and Thompson alike, worse
    // on Wake's Marine Garand once it gained its own first-person rig (a much
    // bigger fetch to queue behind) via the kit-loadout fix.
    const firePromise = fetchHandFireSound(name);
    const fetched = await armsRig.fetchRig(name, soldierName);
    if (!fetched) return null;
    const { gltf, fp, rigFile } = fetched;
    if (token !== soldierKit.weaponToken || !page.optOnFoot.checked || !page.soldier) return null;
    const { doc, data, rig, fov1p, viewHip, viewZoom, mixer, actions, fireVariants,
            fidgetNames, weaponNode } = armsRig.mountRig(gltf, fp, name, token);
    const magazine = data?.magazine || null;
    const hw = {
      name, data, rig,
      soldier: soldierName,  // whose sleeves were asked for
      rigFile: fp ? rigFile : null,   // the arms rig that answered, if one did
      fov1p,                 // `set1pFov` in radians, or null for a bare weapon
      mixer, actions,        // the arms rig's state machine; both empty when bare
      // Which families this rig baked — what `stance-clips.js` resolves a
      // stance's chain against. A rig extracted before the crouch/prone families
      // existed answers false for them and every chain falls back to a standing
      // clip, which is what the page did for all three stances before — except
      // for a moving crouched or prone soldier, who now lands on the walk clip
      // rather than idle.
      hasClip: name => Object.hasOwn(actions, name),
      fireVariants,          // the fire one-shot variants (`fire1..fireN`), when the
                             // weapon's aim state registers several (the knife)
      clips: fp ? doc.clips ?? null : null,   // per-family frames/speed/span extras
      active: null,          // the clip currently owning the arms
      fidgetNames,           // baked idle fidget families (`idle1..idleN`)
      fidget: null,          // the fidget selected/playing, or null
      fidgetTimer: null,     // seconds left of the ANIM-6 dwell, null = parked
      group: null,
      // The loaded magazine plus the spares — the KIT's entry for this item
      // (`kit-ammo.js`), created full the first time the item is raised this
      // life and found as it was left on every raise after. `magazines 5` is
      // read as the total carried, which is how the game's HUD counts them. A
      // negative `magSize` is the engine's unlimited ammo (the knife's -1):
      // rounds is Infinity so the trigger gate and the reload checks read it
      // plainly. `rounds` / `mags` below are accessors onto it, so every
      // reader and writer in this file keeps its plain `hw.rounds`.
      ammo: kitAmmo.entry(name, magazine),
      get rounds() { return this.ammo.rounds; },
      set rounds(n) { this.ammo.rounds = n; },
      get mags() { return this.ammo.mags; },
      set mags(n) { this.ammo.mags = n; },
      reload: 0,       // seconds left of a reload in progress
      reloadPlayed: false,  // the arms' reload clip has been started for this magazine
      cool: 0,         // seconds until a semi-auto weapon has cycled
      weaponNode,      // the welded weapon inside the rig, or null when bare
      hideFire: 0,     // seconds of `hideDuringFireTime` left on the weapon mesh
      throwWind: 0,    // seconds of `fireDelay` wind-up left before the round leaves
      throwBegun: false,  // the wind-up already played this round's clip and report
      pulse: false,    // a semi-auto trigger pull is being held for its round
      pulseShots: 0,   // `group.shots` when it was pulled; moving means it fired
      pulseHeld: 0,    // seconds it has been held
      fire: null,      // { spec, buffer } once firePromise (above) resolves
      fireRetry: false, // the shot path has already asked again for a missing report
      zoomed: false,   // the press-toggle latch (`altFireOnce`)
      rezoom: 0,       // seconds of `UnZoomBetweenFireTime` un-zoom left
      fovCur: 1,       // the eased ARMS FOV factor, 1 hip .. `zoom.soldierFov` zoomed
      worldFov: FOOT_FOV,   // the eased world FOV, degrees, FOOT_FOV .. `zoom.fov` zoomed
      viewHip, viewZoom,
      pos: { ...viewHip },   // the eased rig offset, chasing hip or zoom
      model: new DeviationModel({ deviation: data?.deviation }),
    };
    if (data) {
      const found = page.guns.collect(rig, {
        replace: false,          // the flown aircraft's guns must survive this
        speedScale: 1,           // real muzzle velocity, like the pilot path
        maxRange: 1200,
        roundLifetime: 'data',
        platformVelocity: () => (page.soldier ? page.soldier.body.velocity : null),
        // `fireInCameraDof 1`: the round leaves the eye down the view axis and
        // the muzzle node only places the flash. All 25 armed hand weapons
        // declare it; a mod one that does not falls back to its muzzle.
        aimRay: data.fireInCameraDof ? () => {
          page.camera.getWorldPosition(aimOrigin);
          page.camera.getWorldDirection(aimDirection);
          // A thrown weapon leaves the hand, not the bridge of the nose. The
          // direction stays the view axis (`fireInCameraDof`), so it still lands
          // where the crosshair says to within the hand's own 0.4 m; only where
          // the round first appears moves, to where the fire clip has the fist
          // at its release frame — up-right of centre and an arm's length out.
          // Presentation, and named as such: the engine's own origin is the eye.
          if (data.throw?.fireDelay > 0) {
            aimOrigin.add(throwHand.copy(THROW_RELEASE).applyQuaternion(page.camera.quaternion));
          }
          return { origin: aimOrigin, dir: aimDirection };
        } : null,
        spreadDeg: () => (soldierKit.handWeapon ? soldierKit.handWeapon.model.current() : 0),
      });
      hw.group = found[0] || null;
    }
    soldierKit.handWeapon = hw;
    if (mixer && actions.idle) {
      // Idle underneath from the first frame — the breathing sway, slow enough
      // at its declared 0.1x to read as stillness — and the raise over it:
      // §11's deploy one-shot on spawn.
      actions.idle.play();
      hw.active = 'idle';
      playViewmodelClip(hw, stanceDeployName(hw), { restart: true });
    }
    // The fetch has been in flight since the top of this function; attach it
    // to `hw` whenever it lands. The guard is the load token, not
    // `handWeapon === hw`: a report that beats the glb home would otherwise be
    // dropped for the very weapon about to be published, while the token still
    // keeps one from landing on a weapon the soldier has already swapped away
    // from.
    firePromise.then(fire => { if (fire && soldierKit.weaponToken === token) hw.fire = fire; });
    return hw;
  }

  /** The right weapon for `flag` and the chosen kit, loaded only if it is not
   *  already in hand — in the right sleeves: a redeploy across the team line
   *  with the same weapon still changes soldier, so the rig is compared too.
   *  Also (re)arms the kit-rotation slots: the spawned kit's inventory, with
   *  the slot in hand matching whatever `weaponTemplateFor` picked (slot 3 on
   *  a normal spawn, `?weapon=`'s own slot under the override). */
  function ensureHandWeapon(flag) {
    soldierKit.kitWeaponSlots = kitSlotsFor(flag);
    // A fresh kit: a fresh pouch, and a plunger wired to nothing. Charges left
    // over from the last life keep running their own 240 s fuse in the world,
    // which is what the game does — the array the plunger walks belongs to the
    // weapon, and the weapon died with the soldier.
    demolitions.armDemolitions(flag);
    demolitions.forgetThrownPacks();
    // A new life is a new kit: every item full again. This is the one place
    // ammunition comes back other than a depot — a slot switch rebuilds the
    // rig but never passes through here.
    kitAmmo.reset();
    const name = weaponTemplateFor(flag);
    soldierKit.handSlot = soldierKit.kitWeaponSlots ? slotOf(soldierKit.kitWeaponSlots, name) : null;
    const who = soldierTemplateFor(flag);
    if (soldierKit.handWeapon?.name === name
        && (soldierKit.handWeapon.rigFile || null) === (viewmodelRigFor(name, who) || null)
        && (!soldierKit.handWeapon.group || page.guns.groups.includes(soldierKit.handWeapon.group))) {
      // Same weapon, new life: the raise plays again on every spawn. The body is
      // already the right one — `ensureFootBody` is a no-op for the pair it holds
      // — but a redeploy across the team line changes soldier, and that it is not.
      // The rig survived the last life; its counts did not — it is re-pointed at
      // the new kit's full entry, and a magazine change in progress is dropped.
      soldierKit.handWeapon.ammo = kitAmmo.entry(name, soldierKit.handWeapon.data?.magazine || null);
      soldierKit.handWeapon.reload = 0;
      page.ensureFootBody(who, name).catch(err => console.warn('3P body:', err));
      playViewmodelClip(soldierKit.handWeapon, stanceDeployName(soldierKit.handWeapon), { restart: true });
      return;
    }
    loadHandWeapon(name, who);
  }

  // The fire loop (`hand-fire.js`): the trigger, the reload clock, zoom and the
  // shot hooks. Built last, where its `guns.onShot` was always installed: after
  // the depot's refill, and before the chained hooks it sets up itself.
  const fire = createHandFire({
    get aimHeld() { return page.aimHeld; }, get applyDamage() { return page.applyDamage; },
    get bodyAt() { return page.bodyAt; }, get capsulesOf() { return page.capsulesOf; },
    get botRoundDamage() { return page.botRoundDamage; }, get bots() { return page.bots; },
    get camera() { return page.camera; }, get captured() { return page.captured; },
    get clickQueued() { return page.clickQueued; },
    get deployTeamId() { return page.deployTeamId; }, get dropClick() { return page.dropClick; },
    get fireDetonator() { return fireDetonator; }, get fireStates() { return page.fireStates; },
    get guns() { return page.guns; }, get handWeapon() { return soldierKit.handWeapon; },
    get isDetonator() { return isDetonator; }, get isExplosives() { return isExplosives; },
    get itemsLocked() { return itemsLocked; }, get lineOfSight() { return page.lineOfSight; },
    get LOCAL_PLAYER() { return page.LOCAL_PLAYER; },
    get packThrown() { return demolitions.packThrown; }, get params() { return page.params; },
    get playHandFire() { return playHandFire; },
    get playViewmodelClip() { return playViewmodelClip; },
    get refetchHandFireSound() { return refetchHandFireSound; },
    get releaseHandFireLoop() { return releaseHandFireLoop; },
    get soldier() { return page.soldier; }, get triggerHeld() { return page.triggerHeld; },
    get updateViewmodelAnimation() { return updateViewmodelAnimation; },
    get vehicleAudio() { return page.vehicleAudio; }, get world() { return page.world; },
  });
  const { footFire, isZoomed, startReload } = fire;
  // Summed from the page's look (`addFootLook`), drained by `footFire`.
  Object.defineProperties(soldierKit, {
    footLookX: { get: () => fire.footLookX, enumerable: true },
    footLookY: { get: () => fire.footLookY, enumerable: true },
  });
  soldierKit.addFootLook = fire.addFootLook;

  /** Climbing into a seat: only the presentation is packed away. The trigger
   *  lets go and the viewmodel hides; holstering drops zoom
   *  (`HandFireArms::disable`, lnxded 0x08293da0, calls setZoom(false)) and
   *  the eased FOV factor goes home with it. */
  soldierKit.holster = () => {
    const hw = soldierKit.handWeapon;
    if (!hw) return;
    if (hw.group) page.guns.setFiring(hw.group, false);
    hw.rig.visible = false;
    hw.zoomed = false;
    hw.rezoom = 0;
    hw.fovCur = 1;
    hw.worldFov = FOOT_FOV;
  };
  /** Back on foot (out of a seat, or a fresh body): the weapon in hand again. */
  soldierKit.drawWeapon = () => {
    if (soldierKit.handWeapon) soldierKit.handWeapon.rig.visible = true;
  };

  /** The near pass: the arms rig and its muzzle emitters, drawn over the
   *  frame just rendered. */
  soldierKit.renderViewmodel = () => {
    // The near pass: everything in vmScene — the arms rig and the muzzle
    // emitters inside it, all on VIEWMODEL_LAYER — drawn over a cleared depth buffer, so
    // the world can occlude none of it (§11 step 6). Retail does exactly this:
    // `Renderer_drawView` (0x004662c0) draws the world, clears depth to 1.0,
    // forces the finest mip and calls `StandardMeshRenderer::drawFov`
    // (0x0062cb00), where each first-person part is drawn with a projection
    // baked when its field of view was set (`BStandardMesh::setFieldOfView`
    // 0x005ad160): the render view's own perspective for `set1pFov` × the
    // eased `SoldierZoomFov` factor as a whole vertical angle, the window's
    // aspect, and the world's near plane — 0.1 m, nothing moves it. That is
    // the code (corpus doc §3, "The drawFov pass"), and retail has now been
    // caught drawing it: an Engineer's Garand and Type 5, screenshotted at
    // 2560x1440, reproduce the 0.47 rad framing (forearm only, hand off the
    // corner) at 1.7-2.1x this rig's old 57.3 degree size. Retail also has a
    // *smaller* first-person state — Thompson-at-the-hip OBS clips that
    // measure at the world's 57.3 degrees instead — with the trigger between
    // the two still open (corpus doc §7). So this pass now defaults to
    // `set1pFov`, the value the code actually bakes, and keeps the world's
    // FOV only for `?fov1p=world` and the bare 3P fallback, whose
    // VIEWMODEL_BASE was eyeballed under it. See first-person-soldier.md's
    // 2026-09-16 note and handweapon-view-and-deviation.md §3/§7.
    // `footView3p.firstPerson` is the soldier's `CVMInside`: an arms rig drawn
    // over a chase view would hang in front of the camera with nothing holding
    // it. It is true everywhere but under a canopy with C pressed. A dead man
    // holds no weapon either: the death cam (on foot or over a wreck) is a shot
    // of the body from outside, and retail draws no first-person rig over it.
    if (!(soldierKit.handWeapon?.rig.visible && page.footView3p.firstPerson && !page.soldierDead)) return;
    page.renderer.autoClear = false;
    page.renderer.clearDepth();
    // Two traps in an overlay pass, both learned the hard way. Three draws
    // `scene.background` in EVERY render call, autoClear or not — rendered
    // over the world scene, this pass painted the fog-coloured backdrop over
    // the entire frame, and every on-foot map read as one wall of colour.
    // `vmScene` has no background to paint (and nothing to walk but the rig:
    // the reason it exists, see its declaration). And the pass gets its own
    // camera rather than flipping the main camera's layer mask, so nothing
    // the pass does can leak into the world render's view of that page.camera.
    // The fog is the world's own object, shared, so the rig's materials
    // compile and shade against exactly the fog they always did.
    soldierKit.vmScene.fog = page.scene.fog;
    soldierKit.vmHemi.color.copy(page.hemi.color);
    soldierKit.vmHemi.groundColor.copy(page.hemi.groundColor);
    soldierKit.vmHemi.intensity = page.hemi.intensity;
    soldierKit.vmHemi.position.copy(page.hemi.position);
    soldierKit.vmSun.color.copy(page.sun.color);
    soldierKit.vmSun.intensity = page.sun.intensity;
    soldierKit.vmSun.position.copy(page.sun.position);
    soldierKit.vmCamera.matrixWorld.copy(page.camera.matrixWorld);
    soldierKit.vmCamera.matrixWorldInverse.copy(page.camera.matrixWorld).invert();
    // `set1pFov` (handWeapon.fov1p) by default now that retail is confirmed
    // to draw it; `?fov1p=world` forces the old world-FOV reading (`fov1p=
    // engine` still works — it is no longer a distinct branch, just not
    // `world`). A bare 3P fallback (no fov1p) keeps FOOT_FOV unconditionally,
    // because its VIEWMODEL_BASE was eyeballed under that projection, not
    // set1pFov.
    const baseFov = soldierKit.handWeapon.fov1p && page.params.get('fov1p') !== 'world'
      ? soldierKit.handWeapon.fov1p / soldierKit.DEG_TO_RAD : FOOT_FOV;
    soldierKit.vmCamera.fov = baseFov * soldierKit.handWeapon.fovCur;
    soldierKit.vmCamera.aspect = page.camera.aspect;
    soldierKit.vmCamera.near = 0.1;   // the engine's render-view near, baked unchanged
    soldierKit.vmCamera.far = page.camera.far;
    soldierKit.vmCamera.updateProjectionMatrix();
    page.renderer.render(soldierKit.vmScene, soldierKit.vmCamera);
    page.renderer.autoClear = true;
  };

  Object.assign(soldierKit, {
    DEG_TO_RAD: fire.DEG_TO_RAD,
    KIT_ROW_KEYS: loadout.KIT_ROW_KEYS,
    WEAPON_ICON_VARS,
    altFireDemolitions,
    botKitFor: loadout.botKitFor,
    crosshairEl,
    cycleKitWeapon,
    disposeHandWeapon,
    ensureHandFireBus,
    ensureHandWeapon,
    fetchHandFireSound,
    footFire,
    isZoomed,
    itemsLocked,
    kitLoadout,
    kitRowLabelFor: loadout.kitRowLabelFor,
    kitRowLayoutText: loadout.kitRowLayoutText,
    loadoutsLoad: loadout.loadoutsLoad,
    localWeaponSoundRadius: loadout.localWeaponSoundRadius,
    packAmmo,
    packsLeft,
    playHandFire,
    selectKitWeapon,
    soldierMaxHp: loadout.soldierMaxHp,
    soldierTemplateFor,
    startReload,
    viewmodelRigFor,
    vmCamera,
    vmHemi,
    vmRoot,
    vmScene,
    vmSun,
    weaponSoundsManifest,
    weaponTemplateFor,
  });
  return soldierKit;
}
