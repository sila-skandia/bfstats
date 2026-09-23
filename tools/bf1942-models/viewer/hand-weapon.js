// The weapon in the human's hand: the kits and loadouts (the deploy row to a
// kit to its items, the bots' kits too), the first-person arms rig and its
// near pass, the weapon's load, slots, zoom, reload and demolitions, its
// fire (the trigger, the deviation, the rounds on the bots, the sound at the
// shoulder) and the animation that follows the soldier's gait. Lifted out of
// map.html (features/vehicle-instance-refactor Part 2).

import * as THREE from 'three';
import { chainOnShot } from './seats.js';
import { WEAPON_HEADROOM } from './engine-audio.js';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import { DeviationModel } from './deviation.js';
import { wantViewmodelClip } from './viewmodel-anim.js';
import { fireVariantsFor, stanceClip, stanceFor } from './stance-clips.js';
import { KitAmmo } from './kit-ammo.js';
import { kitRowLabel } from './kit-icon.js';
import { BOT_BODY_RADIUS, BOT_BODY_HEIGHT, BOT_FIRE_RANGE } from './bot-referee.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `AUDIO_OFF`, `LOCAL_PLAYER`, `MAPS_BASE`, `MODELS_BASE`,
 * `SOLDIER_MAX_HP_FALLBACK`, `audioListener`, `botRoundDamage`, `bust`,
 * `camera`, `captured`, `currentDir`, `deployScreen`, `ensureFootBody`,
 * `fireStates`, `guns`, `isCollision`, `loader`, `localPlayer`,
 * `mapSurfaces`, `masterVolume`, `modelSoundBuffer`, `optOnFoot`, `optPilot`,
 * `params`, `playSupplyGive`, `referee`, `soldier`, `supplyTarget`,
 * `vehicleAudio`, `warmSubtree`, `warmups`, `world`.
 */
export function createHandWeapon(page) {
  const soldierKit = {};

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
    if (!page.referee.bots.length || !page.world || !page.soldier) return;
    const myTeam = page.world.player(page.LOCAL_PLAYER)?.team ?? page.deployScreen.deployTeamId;

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
    for (const bot of page.referee.bots) {
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
      if (!page.referee.lineOfSight(origin, at)) continue;
      if (t < bestT) { bestT = t; best = bot.playerId; }
    }
    if (best) page.referee.applyDamage(best, page.botRoundDamage(), page.LOCAL_PLAYER, origin);
  }

  /**
   * A bot's kit: uniform among the side's kits on this level (the engine's
   * `findKitDiff` weight is 1 for every allowed kit), with the AI weapon
   * templates of its items (`aiWeapons` in `_shared/loadouts.json`), the
   * primary first.
   */
  function botKitFor(team, index) {
    const slots = soldierKit.loadouts?.levels?.[page.currentDir]?.[team]?.slots;
    const names = (Array.isArray(slots) ? slots : Object.values(slots ?? {})).filter(Boolean);
    if (!names.length) return null;
    const kitName = names[Math.floor(Math.random() * names.length)];
    const kit = soldierKit.loadouts?.kits?.[kitName];
    if (!kit) return null;
    const items = [...(kit.items ?? [])];
    if (kit.primary) items.sort((a, b) => (a === kit.primary ? -1 : 0) - (b === kit.primary ? -1 : 0));
    const weapons = items.map(item => {
      const ai = soldierKit.loadouts?.aiWeapons?.[item];
      return ai ? { ...ai, name: item } : null;
    }).filter(Boolean);
    return { name: kitName, primary: kit.primary ?? items[0] ?? null, weapons };
  }

  /** The human's current weapon's AI sound radius, for the bots' hearing. */
  function localWeaponSoundRadius() {
    const template = soldierKit.handWeapon?.template ?? soldierKit.handWeapon?.group?.template ?? null;
    return soldierKit.loadouts?.aiWeapons?.[template]?.soundSphereRadius ?? null;
  }

  // --- the weapon in hand ------------------------------------------------------
  //
  // A spawned soldier holds one glb, loaded from the models tree the way
  // `flight.js` fetches a cockpit, parented to the camera and indexed by the
  // same `GunFire` that fires the vehicles. For the pairings §11 of
  // `first-person-soldier.md` has extracted, that glb is the first-person arms
  // rig — camo sleeves and full-detail hands welded around the weapon, the six
  // clip families baked in — mounted at the data's own `center1pHands` and
  // driven by an AnimationMixer off the soldier's gait. Every other weapon
  // draws its bare 3P glb at the eyeballed stand-in offset, exactly as before.
  // Either way the document extras carry the armoury block (rate, spread,
  // magazine, zoom, recoil) and a node stamped `fireArms` with a `muzzle`
  // child, so nothing about any weapon is declared below.
  //
  // One deliberate shortcut remains, visible and documented: scoped weapons get
  // the data's FOV change and no scope art.
  //
  // Crouch and prone no longer play the standing aim. The engine declares a
  // separate upper-body state per stance per weapon — `Ub_Crouch<W>`,
  // `Ub_Lie<W>`, `Ub_{Crouch,Lie}Forward<W>`, `Ub_Lie{Fire,Reload,RaiseWeapon}<W>`
  // and `Ub_CrouchRaiseWeapon<W>`, all 26 vanilla weapons, all with 1P clips —
  // the exporter bakes them, and `stance-clips.js` is the chain that picks one.
  // A rig published before those families existed answers `hasClip` false for
  // them and falls back down its chain to a standing clip. Only the two tracked
  // fixtures carry the new families today; the other 97 rigs in
  // models/viewmodels take that fallback until the lead re-extracts, and for
  // them the one visible change is that a moving crouched or prone soldier now
  // plays the standing walk where he used to play idle.

  // Which weapon the deploy screen's kit puts in hand is the game's own data,
  // read from two places neither of which is the level's scene: the level's
  // `Init.con` (`game.setTeamSkin` / `game.setKit <team> <slot> <kit>`) and the
  // kit's `Objects.con` (the `HandFireArms` it carries at `itemIndex 3`, the
  // slot the engine selects on spawn). `extract_loadouts.py` reads both through
  // the kit readers and writes them as `_shared/loadouts.json` beside the
  // levels; `kitPrimary` below looks the answer up by level, team and row.
  soldierKit.loadouts = null;
  const loadoutsLoad = fetch(`${page.MAPS_BASE}/_shared/loadouts.json${page.bust()}`)
    .then(r => (r.ok ? r.json() : null))
    .then(data => { soldierKit.loadouts = data; return data; })
    .catch(err => { console.warn('loadouts unavailable', err); return null; });
  // The stand-in for a maps tree published before `_shared/loadouts.json`
  // existed, or a mod not yet run through the extractor: vanilla's kit
  // primaries by the nation a side flies (`teamNation`), in the spawn screen's
  // row order. Read from the same `Objects/Items/<Nation>Kit/*/Objects.con`
  // files the extractor reads — not a guess, but frozen here, so the file wins
  // whenever it is present.
  const FALLBACK_PRIMARIES = {
    us:   ['No4Sniper', 'Bar1918', 'Bazooka', 'Thompson', 'No4'],
    brit: ['No4Sniper', 'Bar1918', 'Bazooka', 'Thompson', 'No4'],
    rus:  ['No4Sniper', 'DP', 'Bazooka', 'Mp18', 'No4'],
    ger:  ['K98Sniper', 'Sg44', 'Panzershreck', 'Mp40', 'K98'],
    jp:   ['K98Sniper', 'Type99', 'Panzershreck', 'Mp18', 'Type5'],
  };
  // And the soldier those nations dress, for the arms rig, when the file is
  // not there to say which template the level actually names.
  const FALLBACK_SOLDIERS = {
    us: 'USSoldier', brit: 'BritishSoldier', rus: 'RussianSoldier',
    ger: 'GermanSoldier', jp: 'JapaneseSoldier',
  };

  // Nothing stands on a soldier spawn pad.
  //
  // There used to be a decorative 3P figure on every one of them — a clone of
  // `<Soldier>__<assault primary>.pose.glb`, so that a flythrough had people in
  // it as well as flags and vehicles. What it actually put on the map was a
  // **row of rifles hovering at chest height**, one per pad, and no people at
  // all: `Object3D.clone()` does not rebind a skeleton, so every clone's
  // `SkinnedMesh.skeleton` still pointed at the template's own bones, which are
  // not in the scene and sit at the origin. The bodies therefore all skinned to
  // the same spot near (0, 1.5, 0) while the weapon — a plain `Mesh` parented
  // into the *cloned* bone tree, so carried by the clone's own transform —
  // stayed out at the pad. Twenty-eight floating Sg44s on Berlin, and the same
  // on every level with spawns.
  //
  // The pads are empty in the real game, and this is a playable map now rather
  // than a flythrough, so the figures are gone rather than rebound: a row of
  // motionless mannequins at every spawn point is not what a player should walk
  // into. `splashTargets()` loses them as grenade targets with no replacement —
  // the player's own body is still in that list, and so is every vehicle.

  // The extracted first-person arms rigs — `<Soldier>__<Weapon>.fp.glb` under
  // models/viewmodels (§11) — one per soldier and weapon the vanilla levels
  // pair, because the sleeves are the nation's camo and the hands are welded
  // to that weapon. Every weapon the kits can put in a hand: the primaries,
  // the knife and grenade (the knife's fire family is five variants, ANIM-6's
  // c_AsmRandom), the pistols, and the engineer/medic/scout gadgets. Looked up
  // by `viewmodelRigFor`; a pairing absent here, or a mod tree without the
  // folder, draws the bare 3P glb.
  const VIEWMODEL_RIGS = [
    'USSoldier__Bar1918', 'USSoldier__Bazooka', 'USSoldier__Binoculars',
    'USSoldier__Colt', 'USSoldier__Detonator', 'USSoldier__ExpPack',
    'USSoldier__GrenadeAllies', 'USSoldier__KnifeAllies', 'USSoldier__Landmine',
    'USSoldier__M1Garand', 'USSoldier__MedPack', 'USSoldier__No4',
    'USSoldier__No4Sniper', 'USSoldier__RepairPack', 'USSoldier__Thompson',
    'USMarineSoldier__Bar1918', 'USMarineSoldier__Bazooka',
    'USMarineSoldier__Binoculars', 'USMarineSoldier__Colt',
    'USMarineSoldier__Detonator', 'USMarineSoldier__ExpPack',
    'USMarineSoldier__GrenadeAllies', 'USMarineSoldier__KnifeAllies',
    'USMarineSoldier__Landmine', 'USMarineSoldier__M1Garand',
    'USMarineSoldier__MedPack', 'USMarineSoldier__No4Sniper',
    'USMarineSoldier__RepairPack', 'USMarineSoldier__Thompson',
    'BritishSoldier__Bar1918', 'BritishSoldier__Bazooka',
    'BritishSoldier__Binoculars', 'BritishSoldier__Colt',
    'BritishSoldier__Detonator', 'BritishSoldier__ExpPack',
    'BritishSoldier__GrenadeAllies', 'BritishSoldier__KnifeAllies',
    'BritishSoldier__Landmine', 'BritishSoldier__MedPack', 'BritishSoldier__No4',
    'BritishSoldier__No4Sniper', 'BritishSoldier__RepairPack',
    'BritishSoldier__Thompson',
    'RussianSoldier__Bazooka', 'RussianSoldier__Binoculars',
    'RussianSoldier__Colt', 'RussianSoldier__DP', 'RussianSoldier__Detonator',
    'RussianSoldier__ExpPack', 'RussianSoldier__GrenadeAllies',
    'RussianSoldier__KnifeAllies', 'RussianSoldier__Landmine',
    'RussianSoldier__MedPack', 'RussianSoldier__Mp18', 'RussianSoldier__No4',
    'RussianSoldier__No4Sniper', 'RussianSoldier__RepairPack',
    'GermanSoldier__Binoculars', 'GermanSoldier__Detonator',
    'GermanSoldier__ExpPack', 'GermanSoldier__GrenadeAxis', 'GermanSoldier__K98',
    'GermanSoldier__K98Sniper', 'GermanSoldier__KnifeAxis',
    'GermanSoldier__Landmine', 'GermanSoldier__MP40', 'GermanSoldier__MedPack',
    'GermanSoldier__Panzershreck', 'GermanSoldier__RepairPack',
    'GermanSoldier__Sg44', 'GermanSoldier__WalterP38',
    'GermanDesertSoldier__Binoculars', 'GermanDesertSoldier__Detonator',
    'GermanDesertSoldier__ExpPack', 'GermanDesertSoldier__GrenadeAxis',
    'GermanDesertSoldier__K98', 'GermanDesertSoldier__K98Sniper',
    'GermanDesertSoldier__KnifeAxis', 'GermanDesertSoldier__Landmine',
    'GermanDesertSoldier__MedPack', 'GermanDesertSoldier__Mp40',
    'GermanDesertSoldier__Panzershreck', 'GermanDesertSoldier__RepairPack',
    'GermanDesertSoldier__Sg44', 'GermanDesertSoldier__WalterP38',
    'JapaneseSoldier__Binoculars', 'JapaneseSoldier__Detonator',
    'JapaneseSoldier__ExpPack', 'JapaneseSoldier__GrenadeAxis',
    'JapaneseSoldier__K98Sniper', 'JapaneseSoldier__KnifeAxis',
    'JapaneseSoldier__Landmine', 'JapaneseSoldier__MedPack',
    'JapaneseSoldier__Mp18', 'JapaneseSoldier__Panzershreck',
    'JapaneseSoldier__RepairPack', 'JapaneseSoldier__Type5',
    'JapaneseSoldier__Type99', 'JapaneseSoldier__WalterP38',
  ];
  const viewmodelRigIndex = new Map(VIEWMODEL_RIGS.map(stem => [stem.toLowerCase(), stem]));

  /** The arms rig for `weapon` in `soldier`'s hands, or null for the bare glb.
   *  Case-insensitive on both halves: the kit files spell `MP40` and `k98Sniper`
   *  where the weapons' own `create` lines spell `Mp40` and `K98Sniper`, and
   *  the rig files were named as the exporter was invoked. A weapon with rigs
   *  only in other nations' sleeves borrows one — `?weapon=Thompson` on the
   *  Axis side has always drawn the US rig, and sleeves of the wrong camo
   *  beat no arms at all. */
  function viewmodelRigFor(weapon, soldier) {
    if (!weapon) return null;
    const exact = viewmodelRigIndex.get(`${soldier || ''}__${weapon}`.toLowerCase());
    if (exact) return exact;
    const suffix = `__${weapon}`.toLowerCase();
    for (const [key, stem] of viewmodelRigIndex) if (key.endsWith(suffix)) return stem;
    return null;
  }
  // The rig and everything in it render in their own pass over a cleared depth
  // buffer (frame(), below) so a wall pressed against the chest can never
  // truncate the barrel — the game's equivalent is drawing 1P parts in their
  // own pass (§11 step 6).
  const VIEWMODEL_LAYER = 1;
  // The pass has a scene of its own, not a layer mask over the world.
  // `WebGLRenderer.render` walks every node of whatever scene it is handed —
  // `updateMatrixWorld` and `projectObject` across all ~5,100 level objects —
  // before the mask drops any of them, and that second walk to find one rig
  // was 9% of the frame (features/mesh-viewer-performance, rule 1). The arms
  // hang off `vmRoot`, whose world matrix IS the main camera's: both ways
  // three arrives at a matrix — the renderer's top-down `updateMatrixWorld`
  // and a muzzle's bottom-up `updateWorldMatrix(true)` when a shot asks where
  // the barrel is — read the camera's pose fresh, so the rig sits where the
  // camera is this frame, not last.
  const vmScene = new THREE.Scene();
  const vmRoot = new THREE.Group();
  vmRoot.name = 'viewmodel root';
  vmRoot.matrixAutoUpdate = false;
  vmRoot.updateMatrixWorld = function () {
    page.camera.updateWorldMatrix(true, false);
    this.matrixWorld.copy(page.camera.matrixWorld);
    for (const child of this.children) child.updateMatrixWorld(true);
  };
  vmRoot.updateWorldMatrix = function (updateParents, updateChildren) {
    page.camera.updateWorldMatrix(true, false);
    this.matrixWorld.copy(page.camera.matrixWorld);
    if (!updateChildren) return;
    for (const child of this.children) child.updateWorldMatrix(false, true);
  };
  vmScene.add(vmRoot);
  // A light reaches only the scene it is in, so the pass carries proxies of
  // the two world lights; frame() copies colour, intensity and position across
  // before each pass, so applyLighting() and show() keep writing the originals.
  const vmHemi = new THREE.HemisphereLight();
  const vmSun = new THREE.DirectionalLight();
  vmHemi.layers.enable(VIEWMODEL_LAYER);
  vmSun.layers.enable(VIEWMODEL_LAYER);
  vmScene.add(vmHemi, vmSun);
  // The near pass's own camera: it sees only the rig's layer and copies the
  // main camera's matrices each frame (frame(), below). matrixAutoUpdate off —
  // the copied world matrix IS its pose; letting three recompose it from an
  // unset position would drag the pass to the origin.
  const vmCamera = new THREE.PerspectiveCamera();
  vmCamera.matrixAutoUpdate = false;
  vmCamera.layers.set(VIEWMODEL_LAYER);
  // Where the rig hangs is the engine's own arithmetic, not a calibration.
  // `BFSoldier::updateAnimations` (client 0x004fb150, lnxded 0x0826e630)
  // places the first-person skeleton at
  //
  //     rotate90aroundX · T(center1pHands + easedOffset) · S · M
  //
  // (row-vector products, left applied first) and hands it to
  // `Skeleton::transform`. M is the SoldierCamera's transform relative to
  // the soldier, so the chain reads in camera space; S is the camera-shake
  // matrix the camera itself rides, which cancels in view; the eased offset
  // chases `soldierCameraPosition` / `soldierZoomPosition`; rotate90aroundX
  // is a fixed axis swap, (x,y,z) -> (x,-z,y), from the raw skeleton into the
  // camera's frame. No yaw, pitch or extra offset exists anywhere in it. In
  // three.js terms that is exactly: parent the rig to the camera, turn it
  // half a revolution about Y, translate by center1pHands + offset with z
  // negated for the handedness flip (corpus doc
  // `handweapon-view-and-deviation.md` §3). The calibrated x/y/z/yaw that
  // used to sit on top stood in for a pose error, not a mount error: the
  // engine applies no lower-body clip in first person, so the exporter now
  // bakes the rest pose under the arms (§11 of first-person-soldier.md).
  //
  // Retail's view frame is D3D's — +x right, +y up, +z forward
  // (`convertWorldPosToScreenPos` 0x00440790 divides by view z and maps +x
  // straight to screen right) — so a positive `soldierCameraPosition` x moves
  // the gun to the viewer's right, and vanilla's `center1pHands` −0.12
  // carries the whole rig 12 cm left of the eye.
  //
  // The bare 3P fallback (a weapon with no extracted arms rig) has no
  // skeleton to mount, so it keeps an eyeballed camera-space base. The
  // engine's base is `center1pHands` (BFSoldierTemplate +0x15c, the console
  // word of that name), which the fp rigs read from their extras; the bare
  // glb is authored view-ready and only this stand-in remains. Chosen so the
  // Thompson's hip pose lands where the eyeballed viewmodel used to sit; the
  // hip<->zoom *shift* is entirely the data's.
  const VIEWMODEL_BASE = { x: 0.17, y: -0.10, z: -0.26 };   // OPEN [bare fallback]
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
  // Crossfade between viewmodel clips. The engine blends *into* a state at
  // that state's `setMorphFactor` per second — weight += dt · factor
  // (`AnimationStateMachineInstance::updateState`, lnxded 0x0832b50f, client
  // 0x00613c60), against whatever pose the skeleton currently holds
  // (`Skeleton::setRelativeBoneTransform`, lnxded 0x0832f6e0, client
  // 0x0066b5c0) — so a fade lasts 1/factor and a factor of 1000 or more is a
  // cut (lnxded 0x0832b481). The exporter carries each family's factor in
  // the glb extras (`clips.<family>.morphFactor`); vanilla's Thompson aim is
  // 0.7 (a 1.4 s settle back onto the sights), fire 4.0, deploy 10000. The
  // constant below is only the engine's own constructor default (lnxded
  // 0x08328bf8), for a rig whose extras predate the field.
  const VIEWMODEL_MORPH_DEFAULT = 5.0;
  const VIEWMODEL_MORPH_SNAP = 1000;
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
  soldierKit.triggerHeld = false;  // left button, while pointer-locked on foot
  soldierKit.clickQueued = false;  // one queued semi-auto shot per press
  soldierKit.aimHeld = false;      // right button held — zooms only mod weapons without `altFireOnce`
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
    return soldierKit.aimHeld && page.captured;
  }
  const crosshairEl = document.getElementById('crosshair');
  const aimOrigin = new THREE.Vector3();
  // Where the throwing hand is at the release frame, camera space (metres).
  const THROW_RELEASE = new THREE.Vector3(0.22, -0.10, -0.40);
  const throwHand = new THREE.Vector3();
  const aimDirection = new THREE.Vector3();

  // The kit row's class, for finding a level's kit by class when its slot
  // numbering is not the vanilla one. `extract_kits.py` writes these labels
  // from the kit's `setType`; the row names are the page's.
  const KIT_CLASS = {
    scout: 'Scout', assault: 'Assault', antitank: 'Anti-tank',
    medic: 'Medic', engineer: 'Engineer',
  };

  /** What the chosen kit hands a soldier of `team` on this level: the kit the
   *  level binds to that row (`game.setKit <team> <row> <kit>`), the weapon at
   *  its `itemIndex 3`, and the soldier template the team wears. Every field
   *  null where `_shared/loadouts.json` is absent or does not name the level;
   *  `weaponTemplateFor` then falls back to the vanilla table by nation. */
  function kitLoadout(team, kitName = page.deployScreen.deployKit) {
    const side = soldierKit.loadouts?.levels?.[page.currentDir]?.[team];
    if (!side) return { kit: null, primary: null, soldier: null };
    const slot = page.deployScreen.KITS.indexOf(kitName);
    let kit = side.slots?.[String(slot)] || null;
    if (!kit || !soldierKit.loadouts.kits?.[kit]) {
      // A mod may file its classes in other rows; the class label is the
      // engine's own `setType`, so match on that before giving up.
      const wanted = KIT_CLASS[kitName];
      kit = Object.values(side.slots || {})
        .find(name => soldierKit.loadouts.kits?.[name]?.class === wanted) || kit;
    }
    return {
      kit,
      primary: soldierKit.loadouts.kits?.[kit]?.primary || null,
      soldier: side.soldier || null,
    };
  }

  // The five kit-row text leaves of the spawn layout, by their own lexicon
  // keys, mapped onto the page's row names. The keys are the layout's — the
  // menu's `Kit/Strings/KitName1..5` defaults — not the kits' `setKitName`
  // keys, which is exactly why the label cannot be the leaf's own text: a mod
  // re-points the row's kit (and its name) without touching the menu.
  const KIT_ROW_KEYS = {
    RESPAWN_SCOUT: 'scout', RESPAWN_ASSAULT: 'assault', RESPAWN_AT: 'antitank',
    RESPAWN_MEDIC: 'medic', RESPAWN_ENGINEER: 'engineer',
  };

  /** The display string for the kit row `role` on the current deploy team:
   *  the level's kit for that row, its own `ObjectTemplate.setKitName`
   *  resolved through the mod chain's lexicon (`loadouts.kits[kit].kitName`),
   *  falling back to the spawn layout's own string for the row and, last, the
   *  page's class word. Shared by the canvas text (`deployText`) and the
   *  kit buttons' aria-labels, so both say the same. */
  function kitRowLabelFor(role, layoutText) {
    const { kit } = kitLoadout(page.deployScreen.deployTeamId, role);
    const name = kit ? soldierKit.loadouts?.kits?.[kit]?.kitName : null;
    return kitRowLabel(name, layoutText, KIT_CLASS[role] || role);
  }

  /** `kitRowLabelFor`'s fallback, for the callers without the leaf in hand
   *  (the buttons' aria-labels): the spawn layout's own resolved string for
   *  the row. */
  function kitRowLayoutText(role) {
    const key = Object.entries(KIT_ROW_KEYS).find(([, r]) => r === role)?.[0];
    if (!key) return null;
    const el = page.deployScreen.spawnLayout.data?.groups?.spawn?.elements
      ?.find(e => e.kind === 'text' && e.key === key);
    return el?.text ?? null;
  }

  /** The max HP a soldier of `flag`'s team, holding the deploy screen's chosen
   *  kit, spawns with — `_shared/loadouts.json`'s own `maxHitpoints` for that
   *  kit, or `SOLDIER_MAX_HP_FALLBACK` when the field or the file is not there
   *  yet (the same fallback shape `weaponTemplateFor` uses for a primary). */
  function soldierMaxHp(flag) {
    const { kit } = kitLoadout(flag?.team, page.deployScreen.deployKit);
    const maxHp = soldierKit.loadouts?.kits?.[kit]?.maxHitpoints;
    return Number.isFinite(maxHp) ? maxHp : page.SOLDIER_MAX_HP_FALLBACK;
  }

  /** The template a soldier of `flag`'s team spawns holding, with the kit the
   *  deploy screen chose. `?weapon=` overrides everything, as it always has. */
  function weaponTemplateFor(flag, kitName = page.deployScreen.deployKit) {
    const forced = page.params.get('weapon');
    if (forced) return forced;
    const team = flag?.team;
    const loadout = kitLoadout(team, kitName);
    if (loadout.primary) return loadout.primary;
    const slot = Math.max(0, page.deployScreen.KITS.indexOf(kitName));
    return FALLBACK_PRIMARIES[page.mapSurfaces.teamNation(team)]?.[slot]
      || FALLBACK_PRIMARIES[team === 1 ? 'ger' : 'us'][slot];
  }

  /** The soldier template whose sleeves the arms rig should wear: the level's
   *  `game.setTeamSkin`, or the nation's soldier when the file is absent. */
  function soldierTemplateFor(flag) {
    const team = flag?.team;
    return kitLoadout(team).soldier
      || FALLBACK_SOLDIERS[page.mapSurfaces.teamNation(team)]
      || (team === 1 ? 'GermanSoldier' : 'USSoldier');
  }

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

  /** The kit the level binds to `flag.team`'s chosen row, as slots. Null where
   *  `_shared/loadouts.json` is absent, does not know the level, or does not
   *  know the kit — the same "no data, fall back" shape `kitLoadout` has. */
  function kitSlotsFor(flag) {
    const { kit } = kitLoadout(flag?.team, page.deployScreen.deployKit);
    const weapons = kit ? soldierKit.loadouts?.kits?.[kit]?.weapons : null;
    return Array.isArray(weapons) && weapons.length ? weapons : null;
  }

  /** Which slot number `template` occupies in `slots`, or null. Case-insensitive:
   *  the kit files and the weapons' own `create` lines disagree on casing. */
  function slotOf(slots, template) {
    const want = String(template || '').toLowerCase();
    const found = slots.find(entry => entry.weapon.toLowerCase() === want);
    return found ? found.slot : null;
  }

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
    soldierKit.weaponBarUntil = performance.now() + WEAPON_BAR_MS;
    if (entry.slot === soldierKit.handSlot && !isDetonator(soldierKit.handWeapon?.name)) return true;
    soldierKit.handSlot = entry.slot;
    loadHandWeapon(entry.weapon, soldierTemplateFor({ team: page.deployScreen.deployTeamId }));
    return true;
  }

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
  soldierKit.explosivesTemplate = null;
  soldierKit.detonatorTemplate = null;
  // The gun group whose rounds the plunger reaches: the engine keeps the live
  // list on the ExpPack weapon object itself (`FireArms+0x1d8`), which survives
  // a weapon switch because the kit owns it. This page destroys a weapon when
  // it leaves the hand, so the group is remembered here instead — the rounds
  // already in the air keep their own reference to it, which is what makes
  // that survivable (`disposeHandWeapon`'s surgical splice). Cleared on every
  // spawn, because a new life is a new kit and an empty array; packs left over
  // from the last one run their 240 s fuse out on their own, exactly as they
  // do in the game.
  soldierKit.thrownPackGroup = null;

  /** The pouch's own counts (`kitAmmo`), which outlive the pack's rig the way
   *  every item's do — null until the pack has been raised once this life. */
  function packAmmo() {
    return soldierKit.explosivesTemplate ? kitAmmo.peek(soldierKit.explosivesTemplate) : null;
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
    const { kit } = kitLoadout(flag?.team, page.deployScreen.deployKit);
    const items = soldierKit.loadouts?.kits?.[kit]?.items;
    soldierKit.explosivesTemplate = Array.isArray(items)
      ? items.find(isExplosives) || null : null;
    soldierKit.detonatorTemplate = Array.isArray(items)
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
    if (!soldierKit.detonatorTemplate || !page.optOnFoot.checked || !page.soldier || page.optPilot.checked) {
      return false;
    }
    // Reached only by AltFire (message 7) or MenuSelect4 (message 13), and both
    // are on the far side of `handleMessage`'s `c_AsmHideWeapon` gate.
    if (itemsLocked()) return false;
    if (isDetonator(soldierKit.handWeapon?.name)) return true;
    const slot = slotOf(soldierKit.kitWeaponSlots || [], soldierKit.detonatorTemplate);
    if (slot != null) return selectKitWeapon(slot);
    soldierKit.weaponBarUntil = performance.now() + WEAPON_BAR_MS;
    loadHandWeapon(soldierKit.detonatorTemplate, soldierTemplateFor({ team: page.deployScreen.deployTeamId }));
    return true;
  }

  /** AltFire on the demolitions pair: pack <-> plunger. True if it took the
   *  press, so the zoom/aim branch does not also see it. */
  function altFireDemolitions() {
    // Message 7. `handleMessage` drops it while `c_AsmHideWeapon` is up, so a
    // swimming engineer can neither reach his plunger nor come back off it.
    if (itemsLocked()) return false;
    const name = soldierKit.handWeapon?.name;
    if (isExplosives(name)) return selectDetonator();
    if (isDetonator(name)) {
      // The engine posts itself MenuSelect4 here, so this is exactly the "4"
      // key — including its own fallback, which hands the plunger straight
      // back when the pouch is empty.
      selectKitWeapon(slotOf(soldierKit.kitWeaponSlots || [], soldierKit.explosivesTemplate) ?? 4);
      return true;
    }
    return false;
  }

  /** Work the plunger: every pack this kit's ExpPack put down goes off at once,
   *  through the same `Projectile::detonate` the end of a fuse calls. */
  function fireDetonator(hw) {
    soldierKit.clickQueued = false;
    // The Fire message reaches the held weapon as well as the packs (the
    // engine leaves its forward flag set on this path), so the plunger plays
    // its own clip and its own `Detonator.ssc` report whether or not anything
    // was out there to set off.
    beginHandFire(hw);
    hw.cool = Math.max(hw.cool, 1 / (hw.data?.roundOfFire || 1));
    if (!soldierKit.thrownPackGroup) return 0;
    const count = page.guns.detonateProjectiles(soldierKit.thrownPackGroup);
    if (!page.guns.liveProjectiles(soldierKit.thrownPackGroup)) soldierKit.thrownPackGroup = null;
    return count;
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
    soldierKit.clickQueued = false;
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
    vmRoot.remove(hw.rig);
    // The mixer first, while its bindings still resolve, then the GPU half —
    // a skinned rig also owns bone textures its skeleton has to give back.
    if (hw.mixer) {
      hw.mixer.stopAllAction();
      hw.mixer.uncacheRoot(hw.mixer.getRoot());
    }
    hw.rig.traverse(obj => {
      obj.geometry?.dispose();
      obj.skeleton?.dispose?.();
      for (const m of [obj.material].flat().filter(Boolean)) {
        m.map?.dispose();
        m.dispose();
      }
    });
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
    let gltf = null;
    let fp = false;
    // The arms first: §11's `<Soldier>__<Weapon>.fp.glb`, sleeves and hands
    // welded around the weapon with the six clip families baked in. A pairing
    // without one falls through to the bare weapon, which works as it did.
    const rigFile = viewmodelRigFor(name, soldierName);
    if (rigFile) {
      try {
        gltf = await page.loader.loadAsync(
          `${page.MODELS_BASE}/viewmodels/${rigFile}.fp.glb${page.bust()}`);
        fp = true;
      } catch { /* the bare path below */ }
    }
    if (!gltf) {
      try {
        gltf = await page.loader.loadAsync(`${page.MODELS_BASE}/${name}.glb${page.bust()}`);
      } catch {
        // A `?weapon=` naming nothing extracted, or a mod tree without the glb:
        // on foot bare-handed, which already worked.
        return null;
      }
    }
    if (token !== soldierKit.weaponToken || !page.optOnFoot.checked || !page.soldier) return null;
    // A bare 3P weapon ships its collision hulls as drawable siblings of the
    // visual mesh — the grenade's "Complex collision" box in the green
    // `defense material` read as soldier armour riding along with the weapon.
    // The fp rigs never carry hulls; the bare fallback hides them, the way the
    // level path's own cull treats collision nodes (`isCollision`, above).
    if (!fp) {
      gltf.scene.traverse(obj => {
        if (page.isCollision(obj)) obj.visible = false;
      });
    }
    // Document-level extras land on `gltf.userData` (GLTFLoader's
    // `assignExtrasToUserData(result, json)`); the fallbacks cover a vendored
    // loader that files them elsewhere. The fp rig spells its armoury block
    // `weaponStats` — the same shape the bare glb calls `weapon`, and
    // everything downstream reads it through `hw.data` without caring.
    const doc = (Object.keys(gltf.userData ?? {}).length ? gltf.userData : null)
      ?? gltf.parser?.json?.extras ?? {};
    const data = fp
      ? doc.weaponStats ?? null
      : doc.weapon ?? gltf.scene?.userData?.weapon ?? null;
    // Where the rig hangs in camera space: `center1pHands`, read from the
    // extras and not retyped — the engine's base vector, added to the eased
    // weapon offset ahead of the camera transform (the chain above). Its
    // −1.56 puts the skeleton root 1.56 m below the eye and, with the rest
    // pose the exporter bakes under the arms, the head bone 2 cm under the
    // eye: sleeves at the bottom of the frame, weapon raked up-forward. The
    // bare fallback keeps the eyeballed VIEWMODEL_BASE; only it needs one.
    const hands = fp ? doc.view?.center1pHands : null;
    const base = hands
      ? { x: hands[0], y: hands[1], z: -hands[2] }
      : VIEWMODEL_BASE;
    // `set1pFov`, radians, from the same extras: the whole vertical angle the
    // engine bakes into each first-person part's own projection (the near
    // pass in frame() says what becomes of it).
    const fov1p = fp ? (doc.view?.fov1p ?? null) : null;
    // The rig's two authored poses, camera space. Refractor's z is forward,
    // three's camera looks down -z, so z is negated; a weapon that declares no
    // `soldierCameraPosition` (the Bazooka) sits at the base alone, and one
    // with no `soldierZoomPosition` zooms to its hip pose.
    const toCamera = v => ({
      x: base.x + (v?.[0] ?? 0),
      y: base.y + (v?.[1] ?? 0),
      z: base.z - (v?.[2] ?? 0),
    });
    const viewHip = toCamera(data?.view?.cameraPosition);
    const viewZoom = data?.view?.zoomPosition
      ? toCamera(data.view.zoomPosition) : viewHip;
    const rig = new THREE.Group();
    rig.name = `${name} viewmodel`;
    rig.position.set(viewHip.x, viewHip.y, viewHip.z);
    // The fp rig stands +Y up with its arms extending along +Z, and a three.js
    // camera looks down −Z: half a revolution about Y turns the arms into the
    // view (§11 step 1) — the whole of the engine's rotate90aroundX once the
    // exporter's Z-up-to-Y-up pitch and the glTF handedness flip are taken
    // out. Nothing else rotates it. The bare weapon glbs are authored
    // view-ready.
    if (fp) gltf.scene.rotation.y = Math.PI;
    rig.add(gltf.scene);
    // The whole rig lives on the near layer, drawn by frame()'s second pass
    // over cleared depth. Culling goes with it: skinned bounds computed at
    // bind pose lie about where animated sleeves actually are, and a rig this
    // small is cheaper to draw than to test.
    rig.traverse(obj => {
      obj.layers.set(VIEWMODEL_LAYER);
      if (obj.isMesh) obj.frustumCulled = false;
    });
    // The additive mark the exporter leaves on flash and glow materials. The
    // model browser applies it model-wide at load and `GunFire.collect` applies
    // it to the emitter clones it makes; this covers whatever additive surface
    // is neither (a sight glow on the gun body itself).
    gltf.scene.traverse(obj => {
      if (!obj.isMesh) return;
      for (const m of [obj.material].flat().filter(Boolean)) {
        if (!m.userData?.additive) continue;
        m.blending = THREE.AdditiveBlending;
        m.transparent = true;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
    });
    vmRoot.add(rig);
    // The load can resolve after its owner has already climbed into a seat —
    // spawn beside a jeep and press E inside the fetch — and a viewmodel must
    // not materialise over a windscreen. `exitVehicle` shows it again.
    rig.visible = !(page.optPilot.checked && (page.localPlayer.aircraft || page.localPlayer.car));
    // Hidden again until its programs are linked, its textures and its bone
    // textures are on the GPU and each program has had its first use: the
    // arms, the flash emitters `collect` clones below and the baked streak all
    // warm here, in one parallel batch, against the near pass's own scene and
    // camera, rather than one at a time on the frame that first draws each —
    // three's first-use shader check blocks that frame on the link
    // (features/mesh-viewer-performance, rule 6). The seat is checked again
    // when the warm-up lands, for the same reason as above.
    const armsShown = rig.visible;
    rig.visible = false;
    page.warmups.rig = page.warmSubtree(rig, vmCamera, vmScene).then(() => {
      if (token !== soldierKit.weaponToken) return;
      rig.visible = armsShown && !(page.optPilot.checked && (page.localPlayer.aircraft || page.localPlayer.car));
    });
    // The six baked families become mixer actions. Locomotion loops; one-shots
    // clamp on their last frame. Fire follows the ASM loop bit in extras
    // (Thompson Looping vs sniper PlayOnce) — ANIM-7 / T2.
    let mixer = null;
    const actions = {};
    let fireVariants = [];
    if (fp && gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      const clipExtras = doc.clips ?? {};
      for (const clip of gltf.animations) {
        const action = mixer.clipAction(clip);
        const meta = clipExtras[clip.name];
        // ANIM-7: fire→StandReload (returnTo) is PlayOnce even if a stale
        // extract still wrote loop=true (No4Sniper / K98Sniper).
        let loop = meta?.loop ?? LOCO_LOOP.has(clip.name);
        if ((clip.name === 'fire' || clip.name === 'proneFire')
            && /reload/i.test(meta?.returnTo || '')) {
          loop = false;
        }
        if (loop) {
          action.setLoop(THREE.LoopRepeat, Infinity);
        } else {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actions[clip.name] = action;
      }
      // Fire one-shots beyond the lone `fire` family: the knife's aim state
      // registers five swings (ANIM-6's c_AsmRandom — `rand() % n` on every
      // entry into the fire state) and the extractor bakes them as
      // `fire1..fireN`. `onShot` rolls the per-round pick; selection
      // (viewmodel-anim.js) only keeps the swing and releases it to loco.
      // Both stance families' variants, so a prone swing has its own list.
      fireVariants = [...fireVariantsFor('fire', Object.keys(actions)),
                      ...fireVariantsFor('proneFire', Object.keys(actions))];
    }
    const magazine = data?.magazine || null;
    // The idle fidgets this rig baked (`idle1..idleN` — §11's `addIdle`
    // families): the names in slot order, the ANIM-6 dwell clock, and the
    // fidget currently owning the arms.
    const fidgetNames = fp
      ? Object.keys(doc.clips ?? {}).filter(k => /^idle\d+$/.test(k))
          .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
      : [];
    // The `<weapon> grip` node — the weapon itself, welded under the hand, with
    // the arms and sleeves as its siblings rather than its children. It is what
    // `hideDuringFireTime` hides: the engine's `FireArms::Fire` blanks the
    // weapon's own visual for that long from the shot and `handleUpdate` restores
    // it at expiry (lnxded 0x0828a090 / 0x08288890), which is how the grenade
    // leaves the palm at the instant the thrown one appears. Only the four
    // weapons that let go of what they hold declare a time, so on everything
    // else this node is found and never touched.
    let weaponNode = null;
    if (fp) rig.traverse(obj => { if (obj.userData?.weldBone) weaponNode = obj; });
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
    armDemolitions(flag);
    soldierKit.thrownPackGroup = null;
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

  // Walk/run are one baked clip at two rates (§11), and so are stand-aim and
  // crouch-aim. The looping families, for a rig whose extras do not say: the
  // stance chains and what each one resolves to are `stance-clips.js`.
  const LOCO_LOOP = new Set(['idle', 'walk', 'run',
                             'crouch', 'crouchWalk', 'prone', 'crawl']);

  /**
   * Bring `name` to full weight and fade whatever held the arms before it.
   * Loops keep their phase across a fade-out — a walk cycle returned to
   * mid-burst has not restarted — and one-shots pass `restart` to rewind.
   * Silently a no-op for the bare-weapon fallback, which has no mixer.
   */
  /** Seconds the engine takes to blend into `name`: 1 / its state's morph factor. */
  /**
   * Stop every fire one-shot this rig holds, in either stance family.
   *
   * It used to be `hw.actions.fire?.stop()`, which is the wrong action as soon
   * as the man who fired is lying down: a clamped `proneFire` would have gone
   * on holding the arms through the reload that follows it.
   */
  /** The draw-in family for the stance the soldier is in right now. */
  function stanceDeployName(hw) {
    return stanceClip('deploy', stanceFor(page.soldier?.gait, page.soldier?.stance),
                      hw?.hasClip);
  }

  function stopFireActions(hw) {
    for (const name of ['fire', 'proneFire', ...hw.fireVariants]) {
      hw.actions[name]?.stop();
    }
  }

  function viewmodelFade(hw, name) {
    const factor = hw?.clips?.[name]?.morphFactor ?? VIEWMODEL_MORPH_DEFAULT;
    return factor >= VIEWMODEL_MORPH_SNAP || factor <= 0 ? 0 : 1 / factor;
  }

  function playViewmodelClip(hw, name, { restart = false, timeScale = 1,
                                         fade = viewmodelFade(hw, name) } = {}) {
    const to = hw?.actions?.[name];
    if (!to || !hw.mixer) return false;
    if (hw.active === name && !restart) return true;
    const from = hw.active && hw.active !== name ? hw.actions[hw.active] : null;
    if (restart) to.reset();
    to.setEffectiveTimeScale(timeScale);
    to.enabled = true;
    to.play();
    if (from) {
      // Idle settles in ~1.4 s (morphFactor 0.7). crossFadeFrom alone would
      // leave LoopRepeat fire evaluating — and shaking — for that whole fade.
      // The engine leaves the fire state; freeze fire's clock so the last pose
      // holds while idle/walk morphs in. Reload already snaps via fade === 0.
      const leavingLoopFire = (hw.active === 'fire' || hw.active === 'proneFire')
        && from.loop === THREE.LoopRepeat;
      if (leavingLoopFire) from.setEffectiveTimeScale(0);
      if (fade > 0) {
        to.crossFadeFrom(from, fade, false);
      } else {
        from.stop();
        to.setEffectiveWeight(1);
      }
    } else if (restart) {
      to.setEffectiveWeight(1);
    }
    hw.active = name;
    return true;
  }

  /**
   * The clip this frame owes, then the mixer tick. Selection is
   * `wantViewmodelClip` (viewmodel-anim.js): looping fire follows the trigger
   * latch, PlayOnce finishes its punch, bolt rifles ANIM-7 into StandReload.
   * Never hold fire for the ROF `cool` window (that was the sniper dip).
   */
  function updateViewmodelAnimation(hw, dt) {
    if (!hw.mixer) return;
    // Which stance families this rig actually baked; a rig published before they
    // existed resolves back down its chain to the standing ones.
    const has = hw.hasClip;
    const stance = stanceFor(page.soldier?.gait, page.soldier?.stance);
    const fireName = stanceClip('fire', stance, has);
    const reloadName = stanceClip('reload', stance, has);
    // The fire action whose clock matters: this stance's fire family, or — the
    // knife — whichever registered swing currently owns the arms.
    const fireVariant = hw.fireVariants.includes(hw.active) ? hw.active : null;
    const fireAction = hw.actions[fireVariant ?? fireName];
    const fireRunning = !!(fireAction && fireAction.isRunning());
    const fireMeta = hw.clips?.[fireName] || hw.clips?.fire;
    const fireReturnsToReload = /reload/i.test(fireMeta?.returnTo || '');
    // `Ub_StandResetRaiseWeapon<W>` — the thrown weapons' returnTo, where a
    // rifle's is StandReload. Raising the next grenade is its reload.
    const fireReturnsToDeploy = /raiseweapon/i.test(fireMeta?.returnTo || '');
    // Looping fire (Thompson / BAR) — not bolt rifles whose returnTo is
    // StandReload even when a stale extract still marks fire.loop true.
    const fireLoops = !!(fireMeta?.loop) && !fireReturnsToReload;
    // LoopOnce + clampWhenFinished leaves the action scheduled but paused;
    // isRunning() is false then, which used to drop the reload keep-alive.
    const reloadAction = hw.actions[reloadName];
    const reloadRunning = !!(reloadAction
      && (typeof reloadAction.isScheduled === 'function'
        ? reloadAction.isScheduled()
        : reloadAction.isRunning()));
    // The idle-fidget dwell (ANIM-6, read out of `AnimationStateMachine::
    // updateState` / `AnimationState::checkTransitions`): entering a state
    // parks its timer at 1000 s and `updateState` re-arms it at
    // `(rand & 3) + 4.0` s — 4..7 s — expiry picks `rand() % n` among the
    // states the aim state registered through `addIdle`. Only the aim state
    // has a timer, so the clock runs while idle is what holds the arms and the
    // soldier stands still, and anything else (fire, reload, deploy, any gait
    // off stand) parks it again. The fidget itself is a one-shot (LoopOnce,
    // clamped): when it stops running, selection returns idle and the clock
    // re-arms a fresh dwell — the engine's own rhythm, one fidget every 4-7 s
    // of stillness.
    // The dwell belongs to `Ub_StandAim<W>` alone — `addIdle` is registered on
    // the standing aim state and on nothing else — so a crouched or prone
    // soldier fidgets in the engine no more than he does here.
    if (hw.active === 'idle' && page.soldier?.gait === 'stand'
        && stance === 'stand' && hw.fidgetNames.length
        && hw.actions[hw.fidgetNames[0]]) {
      if (hw.fidgetTimer == null) hw.fidgetTimer = 4 + Math.random() * 3;
      hw.fidgetTimer -= dt;
    } else {
      hw.fidgetTimer = null;
      // An interruption that did not go through selection (a shot's direct
      // playViewmodelClip, a seat) leaves the fidget chosen but unowned.
      if (hw.fidget && hw.active !== hw.fidget) hw.fidget = null;
    }
    const fidgetAction = hw.fidget ? hw.actions[hw.fidget] : null;
    const decision = wantViewmodelClip({
      reload: hw.reload,
      reloadPlayed: hw.reloadPlayed,
      reloadRunning,
      deployRunning: !!hw.actions[stanceClip('deploy', stance, has)]?.isRunning(),
      active: hw.active,
      fireRunning,
      fireLoops,
      fireReturnsToReload,
      fireReturnsToDeploy,
      firing: !!hw.group?.firing,
      hasFire: !!fireAction,
      fireVariants: hw.fireVariants.length ? hw.fireVariants : null,
      hasReload: !!reloadAction,
      hasDeploy: !!hw.actions[stanceClip('deploy', stance, has)],
      gait: page.soldier?.gait,
      stance: page.soldier?.stance,
      has,
      fidget: hw.fidget,
      fidgetRunning: !!(fidgetAction && fidgetAction.isRunning()),
      fidgetDue: hw.fidgetTimer != null && hw.fidgetTimer <= 0,
      fidgetPick: hw.fidgetNames.length
        ? hw.fidgetNames[Math.floor(Math.random() * hw.fidgetNames.length)]
        : null,
    });
    // Keyed on the magazine change, not on which clip holds the arms: a change
    // begun while the last reload clip is still clamped rewinds it. The clip
    // runs at the engine's own span (1/speed); DICE fitted rates in
    // 1pAnimationsTweaking.con so one pass matches reloadTime.
    // Latch only after a successful play — a no-op (bare weapon, missing clip)
    // must not burn the one attempt for this magazine.
    // `decision.want` already names the stance's own family, so these branches
    // play what selection resolved rather than the standing name.
    if (decision.startReload) {
      stopFireActions(hw);
      if (playViewmodelClip(hw, decision.want, { restart: true })) {
        if (decision.markReloadPlayed) hw.reloadPlayed = true;
      }
    } else if (decision.startFire) {
      playViewmodelClip(hw, decision.want, { restart: true });
    } else if (decision.startDeploy) {
      // The throw's returnTo: bring the next grenade up. Same shape as the
      // reload branch above — stop the spent fire clip so a clamped one-shot
      // cannot go on holding the arms through the raise.
      stopFireActions(hw);
      playViewmodelClip(hw, decision.want, { restart: true });
    } else if (decision.startFidget) {
      // The pick lands in `hw.fidget` only once the clip actually owns the
      // arms — a bare weapon or a rig without the family would otherwise
      // re-fire the same no-op every frame.
      if (playViewmodelClip(hw, decision.want, { restart: true })) {
        hw.fidget = decision.want;
      } else {
        hw.fidgetNames.length = 0;   // park the clock; nothing to play
      }
    } else {
      if (decision.endFidget) {
        hw.fidget = null;
        hw.fidgetTimer = null;   // back in idle: a fresh 4-7 s dwell arms
      }
      if (decision.want !== hw.active) {
        playViewmodelClip(hw, decision.want);
      }
    }
    // Belt: selection already matches want (idle) but LoopRepeat fire is still
    // scheduled from a prior fade — freeze its clock so the clip cannot keep
    // shaking after hw.active has already flipped. Weight still drains via any
    // in-flight crossfade / fadeOut from playViewmodelClip.
    if (decision.stopLoopFire && fireAction) {
      fireAction.setEffectiveTimeScale(0);
    }
    hw.mixer.update(dt);
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

  // --- the shot it makes -------------------------------------------------------
  //
  // Per-round one-shots from `models/sounds/<Name>.mp3` — the fire sample
  // `extract_weapon_sounds.py` picked out of the weapon's own `.ssc`, with the
  // authored volume, pitch jitter and time gate riding alongside in
  // `weapons.json`. The vehicle guns hold a muted loop and gate it with gain
  // because their fire is authored as a loop patch on a vehicle that outlives
  // any burst; a hand weapon's round is an event, so each shot gets its own
  // BufferSource into one shared bus. Overlap comes free — a Thompson's 0.1 s
  // loop cycle at 700 rpm stacks instead of restarting, so rapid fire never
  // cuts its own tail off — and the bus follows the master volume from
  // updateAudio like every other voice on the page. Decodes go through the
  // shared cache, so the one-decode-per-wav rule holds here too.
  soldierKit.weaponSoundsIndex = null;   // promise for models/sounds/weapons.json
  soldierKit.handFireBus = null;         // every hand-shot voice sums here

  function weaponSoundsManifest() {
    if (!soldierKit.weaponSoundsIndex) {
      soldierKit.weaponSoundsIndex = fetch(`${page.MODELS_BASE}/sounds/weapons.json${page.bust()}`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        // A fetch that lost its race with the page's own load storm must not
        // memoise silence for the rest of the session: drop the cached promise
        // so the next weapon — or the next shot, through `refetchHandFireSound`
        // — asks again. Only a manifest that actually arrived is kept.
        .then(doc => { if (!doc) soldierKit.weaponSoundsIndex = null; return doc; });
    }
    return soldierKit.weaponSoundsIndex;
  }

  /** Resolve + decode `name`'s fire sample; inert until a shot actually plays
   *  it. Takes the bare template name rather than `hw` so `loadHandWeapon` can
   *  fire this off *before* `hw` exists — see the call site's comment on why
   *  that ordering is the whole fix for a shot going silent right after spawn. */
  async function fetchHandFireSound(name) {
    if (page.AUDIO_OFF) return null;
    const manifest = await weaponSoundsManifest();
    const spec = manifest?.weapons?.[name];
    if (!spec) return null;   // a quiet weapon (binoculars), or a mod without the tree
    const buffer = await page.modelSoundBuffer(`sounds/${spec.file}`);
    return buffer ? { spec, buffer } : null;
  }

  /** One more try for a weapon whose report never landed, asked from the shot
   *  path. Once per weapon: a fetch is cheap, but a round is not the place to
   *  queue one every time the trigger falls. */
  function refetchHandFireSound(hw) {
    if (hw.fireRetry) return;
    hw.fireRetry = true;
    const token = soldierKit.weaponToken;
    fetchHandFireSound(hw.name).then(fire => {
      if (fire && soldierKit.weaponToken === token) hw.fire = fire;
    });
  }

  function ensureHandFireBus(ctx) {
    if (!soldierKit.handFireBus) {
      soldierKit.handFireBus = ctx.createGain();
      soldierKit.handFireBus.gain.value = page.masterVolume() * WEAPON_HEADROOM;
      soldierKit.handFireBus.connect(page.audioListener.getInput());
    }
    return soldierKit.handFireBus;
  }

  // The active Fire Loop voice, for weapons whose .ssc marks the fire patch
  // `loop` + `stop FinishSample`: the engine starts the loop when the trigger
  // closes and, on release, lets the playing cycle run out rather than cutting
  // it. Web Audio spells FinishSample as `source.loop = false` mid-play — the
  // buffer is one authored cycle, so it ends exactly at the boundary.
  soldierKit.handFireLoop = null;

  function startHandFireLoop(fire) {
    if (soldierKit.handFireLoop || !fire || !page.audioListener || page.masterVolume() <= 0) return;
    const ctx = page.audioListener.context;
    const source = ctx.createBufferSource();
    source.buffer = fire.buffer;
    source.loop = true;
    // The script's own per-play jitter (`randomStartPitch 0.02/0.01` on the
    // distance layer); the close stereo layer plays straight.
    const gain = ctx.createGain();
    gain.gain.value = Math.min(fire.spec.volume ?? 1, 1);
    source.connect(gain);
    gain.connect(ensureHandFireBus(ctx));
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); } catch (_) {}
      if (soldierKit.handFireLoop && soldierKit.handFireLoop.source === source) soldierKit.handFireLoop = null;
    };
    try { source.start(); soldierKit.handFireLoop = { source, gain }; } catch (_) {}
  }

  function releaseHandFireLoop() {
    // FinishSample: the cycle in flight completes, nothing is cut.
    if (soldierKit.handFireLoop) soldierKit.handFireLoop.source.loop = false;
    soldierKit.handFireLoop = null;
  }

  function playHandFire(fire) {
    if (!fire || !page.audioListener || page.masterVolume() <= 0) return;
    const ctx = page.audioListener.context;
    // A context built before the first gesture starts suspended and stays that
    // way until something resumes it. Pulling a trigger is a gesture, and when
    // the listener was created by a load rather than by a click this is the
    // difference between an audible session and a silent one.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // A looped fire patch is trigger-held, not per-round: `onShot` only has to
    // make sure the loop is running.
    if (fire.spec.loop) {
      startHandFireLoop(fire);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = fire.buffer;
    // The same per-play jitter DICE puts on the loops, applied per shot: a
    // burst reads as many rounds rather than one report stuttering.
    const [up = 0, down = 0] = fire.spec.randomStartPitch || [];
    source.playbackRate.value = 1 + (Math.random() * (up + down) - down);
    const gain = ctx.createGain();
    // The M1's report is authored at volume 10 against the game mixer's own
    // headroom; Web Audio has none to give, so the manifest keeps the authored
    // number and the clamp lives here, next to the bus that motivates it.
    gain.gain.value = Math.min(fire.spec.volume ?? 1, 1);
    source.connect(gain);
    gain.connect(ensureHandFireBus(ctx));
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); } catch (_) {}
    };
    // `delay` is the script's own `Volume <- Time` gate — the knife's swish
    // lands 0.4 s into the swing, and starting it early would un-author that.
    try { source.start(ctx.currentTime + (fire.spec.delay || 0)); } catch (_) {}
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
    if (isExplosives(hw.name)) soldierKit.thrownPackGroup = group;
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
      soldierKit.clickQueued = false;
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
      if (soldierKit.clickQueued && (page.captured || page.params.has('shots')) && hw.cool <= 0) {
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
        if (windUp > 0 && (hw.throwWind > 0 || hw.cool > 0)) soldierKit.clickQueued = false;
        if (hw.throwWind > 0) {
          hw.throwWind -= dt;
          if (hw.throwWind <= 0) {
            hw.throwWind = 0;
            pullHandTrigger(hw);
          }
        } else if (soldierKit.clickQueued && !(hw.rounds > 0) && hw.reload <= 0) {
          // Dry, and not mid-reload: the click is spent on nothing. Left queued
          // it was honoured the moment an ammo box refilled the weapon — spam
          // the trigger on an empty grenade pouch and the resupply threw one.
          soldierKit.clickQueued = false;
        } else if (soldierKit.clickQueued && canFire && hw.cool <= 0 && !hw.pulse) {
          soldierKit.clickQueued = false;
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
        const firing = soldierKit.triggerHeld && canFire;
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
    KIT_ROW_KEYS,
    WEAPON_ICON_VARS,
    altFireDemolitions,
    botKitFor,
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
    kitRowLabelFor,
    kitRowLayoutText,
    loadoutsLoad,
    localWeaponSoundRadius,
    packAmmo,
    packsLeft,
    playHandFire,
    selectKitWeapon,
    soldierMaxHp,
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
