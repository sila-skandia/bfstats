// The first-person arms rig: the extracted `<Soldier>__<Weapon>.fp.glb` (or
// the bare 3P glb where none is extracted), mounted on the camera the way the
// engine mounts it, drawn in its own near pass (the viewmodel scene, camera
// and light proxies this module owns), and driven by an AnimationMixer off
// the soldier's gait. Lifted out of hand-weapon.js
// (features/vehicle-instance-refactor Part 2c).

import * as THREE from 'three';
import { wantViewmodelClip } from './viewmodel-anim.js';
import { fireVariantsFor, stanceClip, stanceFor } from './stance-clips.js';

/**
 * Built once by `createHandWeapon`. `page` is the narrow bag of getters it
 * builds, naming what this module reads:
 * `aircraft`, `bust`, `camera`, `car`, `isCollision`, `loader`,
 * `MODELS_BASE`, `optPilot`, `soldier`, `warmSubtree`, `warmups`,
 * `weaponToken`.
 */
export function createArmsRig(page) {
  const armsRig = {};

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

  /** Fetch the weapon's glb — the arms rig where one is extracted for
   *  `soldierName` holding it, the bare `name`.glb where not. Null when
   *  neither loads. The first half of `loadHandWeapon`, which checks its load
   *  token once this resolves. */
  async function fetchRig(name, soldierName) {
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
    return { gltf, fp, rigFile };
  }

  /** Mount a fetched glb as the viewmodel: hide a bare weapon's hulls, read
   *  the document extras, hang the rig at its hip pose off `vmRoot` on the
   *  near layer, warm it, and build the arms' mixer. `token` is the load's
   *  `weaponToken`, which the warm-up checks when it lands. */
  function mountRig(gltf, fp, name, token) {
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
    rig.visible = !(page.optPilot.checked && (page.aircraft || page.car));
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
      if (token !== page.weaponToken) return;
      rig.visible = armsShown && !(page.optPilot.checked && (page.aircraft || page.car));
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
    return { doc, data, rig, fov1p, viewHip, viewZoom, mixer, actions, fireVariants,
             fidgetNames, weaponNode };
  }

  /** Take the rig down: off `vmRoot`, its mixer stopped, its GPU half freed. */
  function disposeRig(hw) {
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
  }

  Object.assign(armsRig, {
    disposeRig,
    fetchRig,
    mountRig,
    playViewmodelClip,
    stanceDeployName,
    updateViewmodelAnimation,
    viewmodelRigFor,
    vmCamera,
    vmHemi,
    vmRoot,
    vmScene,
    vmSun,
  });
  return armsRig;
}
