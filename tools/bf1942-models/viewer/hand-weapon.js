// The weapon in the human's hand: the kits and loadouts (the deploy row to a
// kit to its items, the bots' kits too), the first-person arms rig and its
// near pass, the weapon's load, slots, zoom, reload and demolitions, its
// fire (the trigger, the deviation, the rounds on the bots, the sound at the
// shoulder) and the animation that follows the soldier's gait. Lifted out of
// map.html (features/vehicle-instance-refactor Part 2).

import * as THREE from 'three';
import { chainOnShot } from './seats.js';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import { DeviationModel } from './deviation.js';
import { fireVariantsFor, stanceClip, stanceFor } from './stance-clips.js';
import { KitAmmo } from './kit-ammo.js';
import { createKitLoadout } from './kit-loadout.js';
import { createHandFireSound } from './hand-fire-sound.js';
import { createArmsRig } from './arms-rig.js';
import { createDemolitions } from './demolitions.js';
import { BOT_BODY_RADIUS, BOT_BODY_HEIGHT, BOT_FIRE_RANGE } from './bot-referee.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `aimHeld`, `aircraft`, `applyDamage`, `AUDIO_OFF`, `audioListener`,
 * `botRoundDamage`, `bots`, `bust`, `camera`, `captured`, `car`,
 * `clickQueued`, `currentDir`, `deployKit`, `deployTeamId`, `dropClick`,
 * `ensureFootBody`, `fireStates`, `guns`, `isCollision`, `KITS`,
 * `lineOfSight`, `loader`, `LOCAL_PLAYER`, `MAPS_BASE`, `masterVolume`,
 * `MODELS_BASE`, `modelSoundBuffer`, `optOnFoot`, `optPilot`, `params`,
 * `playSupplyGive`, `soldier`, `SOLDIER_MAX_HP_FALLBACK`, `spawnLayout`,
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
    get beginHandFire() { return beginHandFire; }, get deployKit() { return page.deployKit; },
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

  /** Seconds a downed bot stays out before its side puts it back on a flag. */

  const _shotRayDir = new THREE.Vector3();
  const _shotConeDir = new THREE.Vector3();
  const _shotFrameU = new THREE.Vector3();
  const _shotFrameV = new THREE.Vector3();
  const _shotOrigin = new THREE.Vector3();

  /**
   * The human's half of the same parity departure `resolveBotShot` documents
   * below: one hitscan round from the eye down the view axis, rolled into the
   * hand weapon's live deviation cone, against the enemy soldier capsules. The
   * engine resolves a real projectile against a soldier body the viewer's
   * collider does not carry, so without this the player's rounds pass through
   * every bot and only the bots' rounds land.
   */
  function resolvePlayerShotOnBots() {
    if (!page.bots.length || !page.world || !page.soldier) return;
    const myTeam = page.world.player(page.LOCAL_PLAYER)?.team ?? page.deployTeamId;

    page.camera.getWorldPosition(_shotOrigin);
    page.camera.getWorldDirection(_shotRayDir);
    _shotRayDir.normalize();

    // The same polar roll `gunfire.js` `#wander` and `resolveBotShot` use.
    const spread = (soldierKit.handWeapon?.model?.current?.() ?? 0) * DEG_TO_RAD;
    if (spread > 0) {
      const theta = spread * Math.sqrt(Math.random());
      const phi = Math.random() * Math.PI * 2;
      if (Math.abs(_shotRayDir.y) > 0.99) _shotFrameU.set(1, 0, 0);
      else _shotFrameU.set(0, 1, 0);
      _shotFrameU.cross(_shotRayDir).normalize();
      _shotFrameV.crossVectors(_shotRayDir, _shotFrameU);
      _shotConeDir.copy(_shotRayDir).multiplyScalar(Math.cos(theta))
        .addScaledVector(_shotFrameU, Math.sin(theta) * Math.cos(phi))
        .addScaledVector(_shotFrameV, Math.sin(theta) * Math.sin(phi));
    } else {
      _shotConeDir.copy(_shotRayDir);
    }

    const origin = [_shotOrigin.x, _shotOrigin.y, _shotOrigin.z];
    let best = null;
    let bestT = Infinity;
    for (const bot of page.bots) {
      if (bot.team === myTeam) continue;                       // never a teammate
      const player = page.world.player(bot.playerId);
      const s = player?.soldier;
      if (!s || page.world.armorOf(bot.playerId)?.destroyed) continue;
      const cx = s.x - origin[0];
      const cy = (s.y + BOT_BODY_HEIGHT) - origin[1];
      const cz = s.z - origin[2];
      const t = cx * _shotConeDir.x + cy * _shotConeDir.y + cz * _shotConeDir.z;
      if (t < 0 || t > BOT_FIRE_RANGE) continue;
      const px = cx - t * _shotConeDir.x;
      const py = cy - t * _shotConeDir.y;
      const pz = cz - t * _shotConeDir.z;
      if (px * px + py * py + pz * pz > BOT_BODY_RADIUS * BOT_BODY_RADIUS) continue;
      const at = [origin[0] + t * _shotConeDir.x, origin[1] + t * _shotConeDir.y,
                  origin[2] + t * _shotConeDir.z];
      if (!page.lineOfSight(origin, at)) continue;
      if (t < bestT) { bestT = t; best = bot.playerId; }
    }
    if (best) page.applyDamage(best, page.botRoundDamage(), page.LOCAL_PLAYER, origin);
  }

  // The eases are the engine's, both frame-rate dependent by design (no dt in
  // either): the rig moves 25% of the remaining distance per visual update
  // (constant 0.25f, lnxded .rodata 0x086c08ac), the FOV factor converges
  // 0.7·cur + 0.3·target and snaps within 0.001. "Visual update" is the
  // drawer's clock, VERIFIED: `BFSoldier::handleVisualUpdate` is IObject slot
  // vptr+0x4c, called from `ObjectDrawer::objectsVisualUpdate` inside
  // `drawVisible(float)` — once per rendered frame — while the deviation cone
  // below steps on the fixed 30 Hz simulation tick (`deviation.js`). Two
  // clocks, and this page keeps them apart the way the engine does.
  const VIEW_EASE = 0.25;
  const FOV_SNAP = 0.001;
  const CROSSHAIR_MIN_PX = 4;        // bar gap floor, so the cross never closes
  const DEG_TO_RAD = Math.PI / 180;

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
  soldierKit.footLookX = 0;        // |MouseLookX| radians accumulated since last frame
  soldierKit.footLookY = 0;        // |MouseLookY| likewise

  /**
   * Is the weapon in hand zoomed right now. Toggle weapons (`altFireOnce`,
   * all of vanilla) latch `hw.zoomed` per press; `hw.rezoom` is the sniper
   * bolt-cycle un-zoom window (`UnZoomBetweenFireTime`), during which the
   * latch holds but the view sits at the hip. Hold-to-zoom is the fallback
   * for mod weapons that do not declare the toggle.
   */
  function isZoomed() {
    const hw = soldierKit.handWeapon;
    if (!hw || !hw.data?.zoom) return false;
    if (hw.data.zoom.toggle) return hw.zoomed && !(hw.rezoom > 0);
    return page.aimHeld && page.captured;
  }
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
    // charges down. See the demolitions block below.
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

  /** Begin a magazine change. True if one actually started. */
  function startReload() {
    const hw = soldierKit.handWeapon;
    const magazine = hw?.data?.magazine;
    if (!hw || !magazine || hw.reload > 0 || hw.mags <= 0) return false;
    // No active item, no magazine change: the ask goes through `handleMessage`
    // like every other item message and is dropped while `c_AsmHideWeapon` is up.
    // This also covers the automatic change `footFire` starts on a dry magazine.
    if (itemsLocked()) return false;
    if (hw.rounds >= magazine.size) return false;
    hw.reload = magazine.reloadTime ?? 2;
    hw.reloadPlayed = false;   // the arms clip plays once per magazine change
    // `FireArms::Reload` calls setZoom(false): a magazine change drops zoom.
    hw.zoomed = false;
    hw.rezoom = 0;
    if (hw.group) page.guns.setFiring(hw.group, false);
    return true;
  }

  // Every round the soldier's own gun fires: the report plays, the magazine
  // empties, the cone blooms, and the view kicks. `onShot` fires for vehicle
  // guns too, so the group is checked first.
  page.guns.onShot = group => {
    const hw = soldierKit.handWeapon;
    if (!hw || group !== hw.group) return;
    // A report that never arrived — a manifest or an mp3 that failed while the
    // page was still pulling the level down — is asked for once more here
    // rather than leaving this weapon silent for the rest of its life.
    // A wound-up throw (`fireDelay`) played its report and started its clip on
    // the click — `beginHandFire`, below; the round leaving is only the round.
    if (!hw.throwBegun) beginHandFire(hw);
    hw.throwBegun = false;
    // The hand-off. A thrown weapon's own mesh goes away for
    // `hideDuringFireTime` at the moment the round is created — that is one
    // statement in `FireArms::Fire`, not two events to line up — so the grenade
    // in the palm and the grenade in the air are never both on screen. Started
    // here because here is where the round leaves: `guns.onShot` is called from
    // `fireShot`, the same call that spawns the projectile.
    const hide = hw.data?.throw?.hideDuringFireTime;
    if (hide > 0 && hw.weaponNode) {
      hw.hideFire = hide;
      hw.weaponNode.visible = false;
    }
    if (Number.isFinite(hw.rounds)) hw.rounds = Math.max(0, hw.rounds - 1);
    // A bullet round is resolved against the bots here. A thrown charge is not
    // (its damage is the explosion's), and neither is a melee swing — both are
    // weapons whose `onShot` carries no projectile down the view axis.
    if (hw.group?.stats?.projectile && !isExplosives(hw.name)
        && !(hw.data?.throw?.fireDelay > 0)) {
      resolvePlayerShotOnBots();
    }
    // A charge just left the hand: remember whose it was, so the plunger knows
    // what to set off after the pack has been swapped out of the hand. The
    // pouch itself was just charged above, on the kit's own entry, which is
    // what keeps it from refilling on the way back from the plunger.
    if (isExplosives(hw.name)) demolitions.packThrown(group);
    hw.model.onShot();
    hw.cool = Math.max(hw.cool, 1 / (hw.data?.roundOfFire || 1));
    finishHandShot(hw);
  };

  // Longest a semi-auto pulse is held waiting for its round: several world ticks.
  const PULSE_CEILING = 0.25;

  /** One semi-auto trigger pull, held by `footFire` until its round exists. */
  function pullHandTrigger(hw) {
    page.guns.setFiring(hw.group, true);
    hw.pulse = true;
    hw.pulseShots = hw.group.shots;
    hw.pulseHeld = 0;
  }

  /** The trigger's half of a shot: the report and the arms' fire clip. For every
   *  ordinary weapon it runs from `guns.onShot`, on the round; for a throw it
   *  runs on the click, `fireDelay` ahead of the round. */
  function beginHandFire(hw) {
    if (!hw.fire) refetchHandFireSound(hw);
    playHandFire(hw.fire);
    // PlayOnce arms: one restart per round, blended at the fire state's morph
    // factor and clamped between shots. Looping fire (BAR / Thompson) is owned
    // by updateViewmodelAnimation + the trigger latch — restarting it here
    // would un-freeze a just-released LoopRepeat and keep the post-fire shake.
    // The fire family this stance owes: `Ub_LieFire<W>` when he is prone, the
    // standing one otherwise (the engine declares no crouched fire state).
    const fireName = stanceClip('fire', stanceFor(page.soldier?.gait, page.soldier?.stance),
                                hw.hasClip);
    const fireMeta = hw.clips?.[fireName] || hw.clips?.fire;
    const fireReturnsToReload = /reload/i.test(fireMeta?.returnTo || '');
    const fireLoops = !!(fireMeta?.loop) && !fireReturnsToReload;
    if (!fireLoops) {
      // One swing per round, and for the knife one of its five registered
      // swings — the same `rand() % n` the engine's c_AsmRandom rolls on every
      // entry into the fire state. A lone family plays itself.
      const variants = fireVariantsFor(fireName, Object.keys(hw.actions));
      const pick = variants.length
        ? variants[Math.floor(Math.random() * variants.length)]
        : fireName;
      playViewmodelClip(hw, pick, { restart: true });
    }
  }

  /** What follows the round out of the barrel: the un-zoom and the kick. */
  function finishHandShot(hw) {
    // `UnZoomBetweenFireTime > 0` (the snipers' 3.0): the fire path flags it
    // and `FireArms::handleUpdate` un-zooms, then re-zooms when the timer
    // runs out — the bolt-cycle un-zoom. The toggle latch itself holds.
    const unzoom = hw.data?.zoom?.unZoomBetweenFire;
    if (unzoom > 0 && hw.zoomed) hw.rezoom = unzoom;
    // `setRecoil*`: degrees per shot, sampled uniformly inside the declared
    // range (Thompson up 0.21..0.25, leftRight -0.1..0.1) and written into the
    // soldier's own look state, unscaled — the pitch clamp catches a long
    // burst the same way it catches the mouse.
    const recoil = hw.data?.recoil;
    if (recoil && page.soldier) {
      const draw = range => {
        if (!range) return 0;
        const lo = Math.min(range[0], range[1]);
        // The gun's dice, so a seeded check kicks the same way every run.
        return lo + page.guns.rand() * (Math.max(range[0], range[1]) - lo);
      };
      page.soldier.look(draw(recoil.leftRight) * DEG_TO_RAD,
                   draw(recoil.up) * DEG_TO_RAD);
    }
  };
  // Chained on *after* the raw assignment above, never before: `chainOnShot`
  // captures whatever `guns.onShot` already is at the moment it runs and wraps
  // it, but the hand weapon's own `guns.onShot = ...` right above is a plain
  // reassignment that would discard any wrapper installed earlier in the file,
  // silently taking every manned-gun shot's ammo/heat bookkeeping with it (this
  // bit a first pass: every seat's `FireState` sat frozen at its starting ammo
  // through a full firing test). Splices ammo/heat onto every shot `gunfire.js`
  // fires, vehicle or hand weapon alike — a no-op for any group this track
  // never built a `FireState` for (the aircraft/car path has no magazine model
  // of its own yet; the hand weapon manages its own `hw.rounds` above).
  chainOnShot(page.guns, (group, rounds) =>
    page.fireStates.get(group.node)?.registerShot(rounds));
  // How many rounds a weapon still has in the magazine, so `gunfire.js` can serve
  // BOMB-5's partial salvo: a two-barrel dive bomber down to its last round drops
  // ONE bomb, because `FireArms::Fire` fires only as many barrels as the magazine
  // can pay for. Without this the rack would fire a fixed pair and be charged for
  // two it did not have, handing out a free bomb at the bottom of every magazine.
  // Unlimited when this page never built a `FireState` for the group, which is
  // the honest answer for one.
  page.guns.roundsLeft = group => {
    const state = page.fireStates.get(group.node);
    return state && !state.unlimited ? state.ammo : Infinity;
  };
  // And the report. A gun `.ssc` is a one-shot event patch — the muzzle blast,
  // the casing, the crew reloading, the breech — so the round is what plays it,
  // exactly as a hand weapon's own `playHandFire` works two screens up. Chained
  // rather than assigned, for the reason the block above spells out.
  //
  // `vehicleAudio.trigger` reaches every claimed hull's gun patches, so a bot
  // firing a tank's coax is as loud as the player's own — the FPOV assumption
  // stopped at the engine and the guns have the same hole in them.
  chainOnShot(page.guns, group => page.vehicleAudio?.trigger(group?.node));

  /**
   * One frame of the weapon: aim blend and FOV, deviation state, the reload
   * clock, the trigger, and the HUD. Runs from `onFoot` after the camera pose
   * is final, and before `guns.advance` fires this frame's rounds.
   */
  function footFire(dt, input = null) {
    const hw = soldierKit.handWeapon;
    // Drained even bare-handed, or the first frame holding a weapon would see
    // every radian turned since it was picked up.
    const lookX = dt > 0 ? soldierKit.footLookX / dt : 0;
    const lookY = dt > 0 ? soldierKit.footLookY / dt : 0;
    soldierKit.footLookX = 0;
    soldierKit.footLookY = 0;
    if (!hw) return;
    page.guns.firstPerson = true;   // the 0.4 m `em_1P_*` sprite, not the 1.76 m mesh

    // THE ITEM GATE (`itemsLocked` above has the addresses). While the lower
    // machine's `c_AsmHideWeapon` is up there is **no active item**, so the
    // trigger has nothing under it, the reload clock is not his weapon's any
    // more, the plunger is unreachable, and the first-person rig has nothing to
    // draw. Deliberately NOT a special case on the trigger: the engine never
    // blocks `c_PIFire` (index 8 is untouched by `handleSwimAction`), it takes the
    // item away, and modelling it the other way would leave a swimmer reloading
    // and zooming a weapon he does not have.
    //
    // There is no first-person swim clip to put in the rig's place, and that is
    // read rather than assumed: not one of the ten swim states declares a
    // `set1pAnimation` (the five `set1pAnimationSpeed Ub_*Swim*` lines in
    // `animations/1pAnimationsTweaking.con` tune a clip that was never
    // registered), so the engine's own first-person view of a swimmer is his
    // empty hands. The swimming the owner sees is the third-person body, which
    // `syncFootBody` draws from `swim.gait.glb`.
    const locked = itemsLocked();
    if (locked) {
      // Drop anything the trigger had in flight on the tick he went under, the
      // way losing the item does: the group stops firing, the Fire Loop's
      // `stop FinishSample` lets the cycle in flight finish, and no click is
      // banked for the moment he wades back out.
      if (hw.group) page.guns.setFiring(hw.group, false);
      releaseHandFireLoop();
      hw.pulse = false;
      hw.throwWind = 0;
      page.dropClick();
      // `FireArms::Reload` drops zoom; having no item at all certainly does.
      hw.zoomed = false;
      hw.rezoom = 0;
    }

    // The sniper bolt-cycle un-zoom window counts down here; when it empties,
    // the still-set toggle latch zooms the view back in on its own.
    if (hw.rezoom > 0) hw.rezoom = Math.max(0, hw.rezoom - dt);
    const zoomed = !locked && isZoomed();

    // Two fields of view, as the engine keeps them. `zoom.soldierFov`
    // (`SoldierZoomFov`, a factor: the Mp40's 0.9 barely leans in, the
    // Thompson's 0.6 commits) belongs to the ARMS: `BFSoldier::applyFovModifier`
    // multiplies it into `set1pFov` and hands the product to every
    // first-person part through `setFirstPersonFov` (0x004f7120). It eases
    // `0.7·cur + 0.3·target` per visual frame and snaps within 0.001 —
    // `BFSoldier::handleVisualUpdate`, no dt, frame-rate dependent by design.
    // The near pass in frame() draws the rig with it.
    const fovTarget = zoomed ? (hw.data?.zoom?.soldierFov ?? 1) : 1;
    hw.fovCur = Math.abs(fovTarget - hw.fovCur) <= FOV_SNAP
      ? fovTarget
      : 0.7 * hw.fovCur + 0.3 * fovTarget;
    // The world camera is the other: zoom switches it to the weapon's
    // `zoomFov`, a whole field of view in the unit `renderer.fieldOfView 1`
    // uses (radians; the Thompson's 0.5 = 28.6°, a sniper's 0.1 = 5.7°), and
    // back to FOOT_FOV. INFERRED [zoomFov unit]: read off the vehicleFov path
    // (`Camera::setVehicleFOV` replaces the render view's FOV wholesale), not
    // off the camera-mode switch itself, which is a raw-byte read
    // (0x004fc8b6). Whether that side eases or snaps is unread, so it borrows
    // the arms' 0.7/0.3 ease. OPEN [stand-in].
    const worldTarget = zoomed && hw.data?.zoom?.fov
      ? hw.data.zoom.fov / DEG_TO_RAD : FOOT_FOV;
    hw.worldFov = Math.abs(worldTarget - hw.worldFov) <= FOV_SNAP
      ? worldTarget
      : 0.7 * hw.worldFov + 0.3 * worldTarget;
    page.camera.fov = hw.worldFov;
    page.camera.updateProjectionMatrix();
    // And displaces the rig from its hip pose to its zoom pose, eased 25% of
    // the remaining distance per visual frame (0.25f, same function, no dt).
    const at = zoomed ? hw.viewZoom : hw.viewHip;
    hw.pos.x += (at.x - hw.pos.x) * VIEW_EASE;
    hw.pos.y += (at.y - hw.pos.y) * VIEW_EASE;
    hw.pos.z += (at.z - hw.pos.z) * VIEW_EASE;
    hw.rig.position.set(hw.pos.x, hw.pos.y, hw.pos.z);
    // A scoped weapon aims through glass this page does not draw yet; hiding
    // the rifle is the half of the scope view the data can already pay for.
    // And an item that is not enabled is not drawn at all: that is the whole of
    // what first person looks like while swimming.
    hw.rig.visible = !locked && !(hw.data?.zoom?.scope && zoomed);

    // The deviation inputs, named for the engine's PlayerInput channels. Note
    // what is NOT fed: zoom — aiming has no effect on deviation, in either
    // binary. `jumping` gates miscDev; the engine's gate is the c_PIAction
    // input masked by a soldier state bit, and airborne is this page's
    // stand-in for that mask. `dt` here is the frame's; the model converts it
    // to whole 1/30 s ticks itself (`TICK_HZ`), the engine's simulation step,
    // so the cone decays at the same rate on every monitor.
    hw.model.update(dt, {
      stance: page.soldier.stance,
      throttle: input?.forward ?? 0,
      strafe: input?.strafe ?? 0,
      lookX,
      lookY,
      jumping: !page.soldier.grounded,
    });

    const magazine = hw.data?.magazine;
    if (locked) {
      // The reload clock is `FireArms::handleUpdate`'s, and that is not running on
      // an item the soldier does not have: a change begun on the bank finishes
      // where he left it when he wades out, and a dry magazine is not refilled in
      // the water either.
    } else if (hw.reload > 0) {
      hw.reload -= dt;
      if (hw.reload <= 0) {
        hw.reload = 0;
        hw.mags -= 1;
        hw.rounds = magazine.size;
      }
    } else if (magazine && hw.rounds <= 0 && hw.mags > 0) {
      // Dry means a magazine change, asked for or not — `autoReload` in the
      // data or no. R merely asks early. Both go through startReload, so every
      // change drops zoom and owes the arms a fresh pass of the reload clip.
      startReload();
    }

    // The plunger has no `projectileTemplate` and so no gun group at all, which
    // is why it needs its own trigger: a click on it is a `detonateProjectiles`
    // call, not a round.
    // Both triggers are `handleMessage` message 6, so both are gated: a swimming
    // engineer cannot work the plunger and cannot put a charge down either.
    if (!locked && isDetonator(hw.name)) {
      hw.cool = Math.max(0, hw.cool - dt);
      if (page.clickQueued && (page.captured || page.params.has('shots')) && hw.cool <= 0) {
        fireDetonator(hw);
      }
    }
    if (!locked && hw.group) {
      hw.cool = Math.max(0, hw.cool - dt);
      // `__setTrigger` stands in for the mouse under ?shots, where headless
      // Chromium never grants pointer lock — the capture gate would otherwise
      // dead-trigger every harness shot.
      const canFire = (page.captured || page.params.has('shots'))
        && hw.reload <= 0 && hw.rounds > 0;
      if (hw.data?.fireOnce) {
        // Semi-auto: one queued click becomes exactly one frame of trigger,
        // which `advance` turns into exactly one round; `cool` holds the
        // declared cycle (a No4 works its bolt for 2.7 s) across clicks.
        // The pulse is held until the round it asked for exists, not for one
        // frame: `guns.advance` runs on the world's 30 Hz tick and this runs per
        // rendered frame, so a one-frame pulse that fell on a frame with no tick
        // in it fired nothing — the grenade stayed in the fist through the whole
        // fling and sank with the raise, on roughly every other throw at 60 fps.
        // `shots` moving is the round; the ceiling only stops a gun that cannot
        // fire (a collider mid-rebuild) from holding the trigger for ever.
        if (hw.pulse) {
          hw.pulseHeld += dt;
          if (hw.group.shots !== hw.pulseShots || hw.pulseHeld > PULSE_CEILING) {
            page.guns.setFiring(hw.group, false);
            hw.pulse = false;
          }
        }
        // A throw winds up first. `fireDelay` (the grenades' 1.0 s) is the time
        // from the click to the round: the fire clip pulls the pin and swings
        // through its fling over exactly that span, the `.ssc` lands its swoosh
        // at 0.9 s of it, and `hideDuringFireTime` (0.4) then covers what is
        // left of the 1.35 s clip before the next one is raised — three
        // independently authored numbers that only agree under this reading.
        // So the click starts the clip and the report, and the trigger pulse
        // that makes the round waits for the countdown. A weapon swapped or a
        // soldier killed mid-wind-up never throws: `hw` goes with them.
        const windUp = hw.data?.throw?.fireDelay || 0;
        // Clicks made during a throw are not banked either: the rifles keep
        // their one queued shot across the bolt cycle, but a grenade mashed
        // through its wind-up would follow itself with a second nobody asked for.
        if (windUp > 0 && (hw.throwWind > 0 || hw.cool > 0)) page.dropClick();
        if (hw.throwWind > 0) {
          hw.throwWind -= dt;
          if (hw.throwWind <= 0) {
            hw.throwWind = 0;
            pullHandTrigger(hw);
          }
        } else if (page.clickQueued && !(hw.rounds > 0) && hw.reload <= 0) {
          // Dry, and not mid-reload: the click is spent on nothing. Left queued
          // it was honoured the moment an ammo box refilled the weapon — spam
          // the trigger on an empty grenade pouch and the resupply threw one.
          page.dropClick();
        } else if (page.clickQueued && canFire && hw.cool <= 0 && !hw.pulse) {
          page.dropClick();
          if (windUp > 0) {
            hw.throwWind = windUp;
            hw.throwBegun = true;
            // Held past the release so a second click cannot start a second
            // wind-up over this one; `onShot` then adds the declared cycle.
            hw.cool = windUp;
            beginHandFire(hw);
          } else {
            pullHandTrigger(hw);
          }
        }
      } else {
        const firing = page.triggerHeld && canFire;
        page.guns.setFiring(hw.group, firing);
        // The Fire Loop follows the trigger, not the rounds: the .ssc's
        // `stop FinishSample` lets the cycle in flight complete on release,
        // on running dry, and on a magazine change alike.
        if (!firing) releaseHandFireLoop();
      }
    }

    // `hideDuringFireTime` running out puts the weapon back in the hand, which
    // the engine does unconditionally — `handleUpdate` shows the visual again and
    // only then considers switching weapons (`changeWeaponWhenNoAmmo`, which this
    // page does not do yet, so a soldier out of grenades keeps holding one he
    // cannot throw).
    if (hw.hideFire > 0) {
      hw.hideFire -= dt;
      if (hw.hideFire <= 0) {
        hw.hideFire = 0;
        if (hw.weaponNode) hw.weaponNode.visible = true;
      }
    }
    // A thrown weapon with nothing left to throw is an empty hand. The engine
    // gets there by switching weapons (`changeWeaponWhenNoAmmo`); until this
    // page does that, the fist at least does not hold a grenade the pouch does
    // not have — and an ammo box puts one back in it the moment it refills.
    if (hw.weaponNode && hw.data?.throw && hw.hideFire <= 0) {
      hw.weaponNode.visible = hw.rounds > 0 || hw.mags > 0;
    }

    // The arms last, once the reload clock and the trigger have settled what
    // this frame is: a reload begun above starts its clip this same frame. Not
    // while the item gate is shut: the rig is not drawn, and a fire or reload clip
    // must not run itself out behind the water — the engine's upper machine is in
    // `Ub_Floating`, which declares no 1P clip at all.
    if (!locked) updateViewmodelAnimation(hw, dt);
  }

  Object.assign(soldierKit, {
    DEG_TO_RAD,
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
