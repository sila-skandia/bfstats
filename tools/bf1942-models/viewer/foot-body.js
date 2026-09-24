// The human's own body on foot, for the third-person views and the canopy:
// the kit's soldier with the gait families and the stance clips, the
// parachute canopy, drawn at the interpolated feet. Lifted out of map.html
// (features/vehicle-instance-refactor Part 2); `soldier-body.js` stays the
// clip rules.

import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { rigCapsules } from './rig-capsules.js';
import { BODY_CLIPS, BODY_DEATHS, BODY_ONCE, BODY_HIDES_WEAPON, bodyClipFamily, canopyClip } from './soldier-body.js';
import { createSoldierDress, undress, weaponNodeOf } from './soldier-dress.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bindDynamicShading`, `bust`, `deathFamily`, `deathYaw`, `deployKit`,
 * `deployTeamId`, `footFeetCur`, `footFeetPrev`, `footView`, `footView3p`,
 * `kitLoadout`, `MODELS_BASE`, `optOnFoot`, `optPilot`, `presentAlpha`,
 * `scene`, `soldier`, `soldierDead`.
 */
export function createFootBody(page) {
  const footBodies = {};

  // --- the third-person body ---------------------------------------------------
  //
  // The local player's own soldier, drawn in the world. Until this existed the
  // page drew him as a first-person arms rig parented to the camera and nothing
  // else: every external view framed an empty point in space, and so the external
  // views were gated off.
  //
  // The assets are the pose pipeline's, and they already existed for the
  // remotes -- `<Soldier>__<Weapon>.pose.glb` is the body, head, hands and the
  // welded weapon, and the shared sidecars under `poses/gaits/` carry the clips,
  // now seven locomotion families as lower/upper pairs plus the parachute's
  // eleven. `soldier-body.js` picks the family; the two halves are played at full
  // weight together because the engine runs two state machines over disjoint bone
  // sets (11 lower bones, 44 upper), which is the same reason the seat poses play
  // `seat.lower` and `seat.upper` together.
  //
  // Three placement facts, all of them read rather than chosen:
  //
  //  * `soldier.y` is the FEET (`Soldier.spawn`: "place the soldier's feet"), and
  //    a pose glb's root is the skeleton root at the same place, which is why
  //    `netcode-render.js` puts a remote's group straight at his snapshot
  //    position.
  //  * the body's own yaw is the drawn view yaw and NOTHING else. The remote
  //    renderer multiplies a remote's quaternion by a baked half turn
  //    (`SOLDIER_YAW_FLIP`) and this path must not: driven on Wake with the flip
  //    in, the chase view showed the man's FACE -- the camera sits behind him at
  //    `-forward * R` and he had been turned to meet it. The pose export's root
  //    already carries the pitch that stands the bind pose up
  //    (`quat_from_ypr(0, -90, 0)`), and the page's own forward convention,
  //    `(sin yaw, 0, cos yaw)`, is the one that rig is built in.
  //  * the canopy hangs at the soldier template's own `addTemplate Parachute`
  //    offset, which every vanilla soldier writes as `0/0.3/0` and which rides
  //    out in the canopy bundle's `extras.attach` rather than being written here.
  //
  // The rig is hidden whenever the camera is inside the man (`CVMInside`), which
  // is everywhere but under a canopy with C pressed -- drawing a head from the
  // inside is a mouthful of neck.
  const footBodyLoader = new GLTFLoader();
  footBodies.footBody = null;        // { scene, mixer, families, want, soldier, weapon }
  footBodies.footCanopy = null;      // { scene, mixer, actions, attach, want }
  footBodies.footBodyToken = 0;      // which load is still the current one
  // `window.__footBodyHide(true)`: keep the body and the canopy out of the frame
  // so a headless check can read the same pixels with and without them.
  footBodies.footBodyForceHidden = false;
  /** Keep the body and the canopy out of the frame (`__footBodyHide`). */
  footBodies.forceHide = on => {
    footBodies.footBodyForceHidden = !!on;
    if (footBodies.footBody) footBodies.footBody.scene.visible = footBodies.footBody.scene.visible && !on;
    if (footBodies.footCanopy) footBodies.footCanopy.scene.visible = footBodies.footCanopy.scene.visible && !on;
    return footBodies.footBodyForceHidden;
  };
  const footBodyCache = new Map();
  const footBundleCache = new Map();
  footBodies.footGaitsManifest = null;
  /** `gaits.json`'s `soldierBody` -- the hit capsules and the corpse time --
   *  once the manifest is in; null before, and on a tree that predates it. */
  footBodies.soldierBody = null;
  const footBodyQuat = new THREE.Quaternion();
  const footBodyEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  function footGaits() {
    if (!footBodies.footGaitsManifest) {
      footBodies.footGaitsManifest =
        fetch(`${page.MODELS_BASE}/poses/gaits/gaits.json${page.bust()}`)
          .then(r => (r.ok ? r.json() : null))
          .then(json => { footBodies.soldierBody = json?.soldierBody ?? null; return json; })
          .catch(() => null);
    }
    return footBodies.footGaitsManifest;
  }

  /** One shared clip sidecar's animations, by its path relative to `poses/`.
   *  A bundle's `extras.states` (`extract_pose.py` `state_meta`: the rate,
   *  loop, morph factor and follow-on state of each clip, as the engine plays
   *  it) rides on each clip as `clip.userData`, so whoever binds the clip has
   *  it; a bundle baked before that carries none and the clips an empty one. */
  function footBundle(relative) {
    if (!relative) return Promise.resolve([]);
    if (!footBundleCache.has(relative)) {
      footBundleCache.set(relative, footBodyLoader
        .loadAsync(`${page.MODELS_BASE}/poses/${relative}${page.bust()}`)
        .then(g => {
          const states = g.userData?.states ?? namedStates(g.userData);
          for (const clip of g.animations ?? []) clip.userData = { ...(states[clip.name] ?? {}) };
          return g.animations ?? [];
        }, () => []));
    }
    return footBundleCache.get(relative);
  }

  /** The named-state bundles (`die`, `swim`, `parachute`) describe their clips
   *  in the older shape, `{ speed, loop, morphFactor, returnTo }` under the
   *  bundle's own key; read as the same `{ speed, loop, morph, then }`. */
  function namedStates(extras) {
    const out = {};
    for (const key of ['die', 'swim', 'parachute']) {
      for (const [name, meta] of Object.entries(extras?.[key] ?? {})) {
        out[name] = { speed: meta.speed, loop: meta.loop, morph: meta.morphFactor,
                      then: meta.returnTo ?? undefined };
      }
    }
    return out;
  }

  /** `gaits.json` `stateMachine`: the torso transitions with no clip of their
   *  own, and the weapons whose rate differs from their grip's bake. Null on a
   *  tree that predates it. */
  async function footStateMachine() {
    return (await footGaits())?.stateMachine ?? null;
  }

  /** Every clip the body can play: the grip's upper half, the shared lower half,
   *  and the parachute bundle. A bundle that is not in the tree contributes
   *  nothing and `soldier-body.js`'s chains fall back past it. */
  async function footBodyClips(weapon) {
    const manifest = await footGaits();
    if (!manifest) return [];
    const grip = manifest.weaponGrip?.[weapon] ?? weapon;
    let upper = await footBundle(manifest.grips?.[grip]);
    if (!upper.length && manifest.grips?.Colt) {
      // The same fallback the remote renderer takes: a weapon whose grip has no
      // bundle borrows the pistol's rather than sliding along unanimated.
      upper = await footBundle(manifest.grips.Colt);
    }
    const lower = await footBundle(manifest.lower);
    const chute = await footBundle(manifest.parachute);
    // The swim bundle is weapon-independent like the parachute's -- every swim
    // state names a clip under `animations/3P_NoWeapon/`, because every one of them
    // declares `c_AsmHideWeapon`.
    const swim = await footBundle(manifest.swim);
    // The deaths, weapon-independent too: `DieHit/LowerBody/`,
    // `DieHit/3p/EmptyHands/` and `Vehicle/`.
    const die = await footBundle(manifest.die);
    return [...lower, ...upper, ...chute, ...swim, ...die];
  }

  /** The death bundle's clips (`gaits/die.gait.glb`), for a body that is not
   *  this one -- the human's seat, whose slump is `Ub_DieInVehicle`. */
  async function dieClips() {
    const manifest = await footGaits();
    return footBundle(manifest?.die);
  }

  function footPosePair(soldierName, weapon) {
    const key = `${soldierName}|${weapon}`;
    if (!footBodyCache.has(key)) {
      footBodyCache.set(key, footBodyLoader
        .loadAsync(`${page.MODELS_BASE}/poses/${soldierName}__${weapon}.pose.glb${page.bust()}`)
        .then(gltf => {
          gltf.scene.traverse(obj => {
            const data = obj.userData || {};
            if (data.effect || data.projectileMesh || data.projectileTrail
                || data.collision || /collision/i.test(obj.name || '')) {
              obj.visible = false;
            }
            if (obj.isSkinnedMesh) obj.frustumCulled = false;
          });
          // Document-level extras land on `gltf.userData`. `extras.weapon` is the
          // name of the welded weapon subtree, which the swim states have to stow.
          return { scene: gltf.scene, animations: gltf.animations ?? [],
                   weaponName: gltf.userData?.weapon ?? null };
        }, () => null));
    }
    return footBodyCache.get(key);
  }

  function footCanopyAsset() {
    if (!footBodyCache.has('__canopy')) {
      footBodyCache.set('__canopy', footGaits().then(manifest => {
        if (!manifest?.canopy) return null;
        return footBodyLoader
          .loadAsync(`${page.MODELS_BASE}/poses/${manifest.canopy}${page.bust()}`)
          .then(gltf => {
            gltf.scene.traverse(obj => {
              if (obj.isSkinnedMesh) obj.frustumCulled = false;
            });
            // Document-level extras land on `gltf.userData`, the same place the
            // arms rig reads its armoury block from.
            const doc = (Object.keys(gltf.userData ?? {}).length
              ? gltf.userData : null) ?? gltf.parser?.json?.extras ?? {};
            const attach = doc.attach ?? manifest.canopyAttach;
            return {
              scene: gltf.scene,
              animations: gltf.animations ?? [],
              // The `Parachute` child's own `setPosition`, read out of the
              // bundle. The literal is the last resort: every vanilla soldier
              // writes `0/0.3/0`, and a tree published before the bundle carried
              // the offset has nothing else to say.
              attach: (Array.isArray(attach) && attach.length === 3)
                ? attach : [0, 0.3, 0],
            };
          }, () => null);
      }, () => null));
    }
    return footBodyCache.get('__canopy');
  }

  /** One mixer over the pose rig, with an action per half per family. Actions are
   *  parked at weight 0 and switched by `syncFootBody`, the same discipline the
   *  remote renderer uses; a one-shot (`BODY_ONCE`: the four `c_AsmPlayOnce`
   *  parachute states) clamps at its last frame instead of looping, and the
   *  engine's own `addTransitionWhenDone` — which `parachute.js` already runs —
   *  is what moves it on. */
  function buildFootBodyRig(scene, clips) {
    const mixer = new THREE.AnimationMixer(scene);
    const action = (name, once) => {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      else a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
      a.paused = true;
      return a;
    };
    const families = {};
    for (const [family, spec] of Object.entries(BODY_CLIPS)) {
      const once = BODY_ONCE.has(family);
      const lower = action(spec.lower, once);
      const upper = action(spec.upper, once);
      // A family counts only when both halves resolved, which is the pose
      // pipeline's own rule: half a body is worse than the family before it.
      if (lower && upper) families[family] = [lower, upper];
    }
    return { mixer, families };
  }

  function disposeFootBodyScene(root) {
    // The kit's worn parts are clones of the dresser's cache, sharing its
    // geometry and textures with every other wearer: off first, then free
    // only what is the figure's own.
    undress(root);
    root.traverse(obj => {
      obj.geometry?.dispose();
      obj.skeleton?.dispose?.();
      for (const m of [obj.material].flat().filter(Boolean)) {
        m.map?.dispose();
        m.dispose();
      }
    });
  }

  function disposeFootBody() {
    for (const held of [footBodies.footBody, footBodies.footCanopy]) {
      if (!held) continue;
      if (held.mixer) {
        held.mixer.stopAllAction();
        held.mixer.uncacheRoot(held.mixer.getRoot());
      }
      page.scene.remove(held.scene);
      // The scenes are `skeletonClone`s of a cached original, so their GPU
      // resources are their own and the cache's stay for the next life.
      disposeFootBodyScene(held.scene);
    }
    footBodies.footBody = null;
    footBodies.footCanopy = null;
  }

  // What the soldiers the page draws wear (`soldier-dress.js`): one dresser,
  // one cache of kit parts, for this body and the bots' and the seats'.
  footBodies.soldierDress = createSoldierDress({
    loader: footBodyLoader,
    bases: () => [...new Set([page.MODELS_BASE, 'models'])],
    bust: () => page.bust(),
    shade: node => page.bindDynamicShading(node),
  });

  /** The deploy kit this body wears (`kit-loadout.js` `kitLoadout`), or null. */
  function footKit() {
    return page.kitLoadout?.(page.deployTeamId, page.deployKit)?.kit ?? null;
  }

  /** Hang the deploy kit's parts on the body, and change them when the kit
   *  changes under a body that stays (a new kit with the same weapon). The
   *  corpse under the death cam wears them too: it is the same scene. */
  function dressFootBody() {
    const held = footBodies.footBody;
    if (!held) return;
    const kit = footKit();
    if (held.kit === kit) return;
    undress(held.scene);
    held.kit = kit;
    if (!kit) return;
    footBodies.soldierDress.dress(held.scene, kit,
      () => footBodies.footBody === held && held.kit === kit)
      .catch(err => console.warn('3P body kit:', err));
  }

  /** (Re)build the third-person body for `soldierName` holding `weapon`.
   *
   * Called wherever the weapon in hand changes, because the pose glb carries the
   * welded weapon — swapping to the knife has to change the body, not just the
   * arms rig. A repeat call for the pair already loaded is a no-op, so a respawn
   * with the same kit costs nothing. */
  async function ensureFootBody(soldierName, weapon) {
    if (!soldierName || !weapon) return null;
    if (footBodies.footBody && footBodies.footBody.soldier === soldierName
        && footBodies.footBody.weapon === weapon) {
      dressFootBody();
      return footBodies.footBody;
    }
    const mine = ++footBodies.footBodyToken;
    const [pair, clips, canopy] = await Promise.all([
      footPosePair(soldierName, weapon),
      footBodyClips(weapon),
      footCanopyAsset(),
    ]);
    if (mine !== footBodies.footBodyToken) return null;
    if (!pair) return null;
    disposeFootBody();
    const body = skeletonClone(pair.scene);
    page.bindDynamicShading(body);
    const rig = buildFootBodyRig(body, [...pair.animations, ...clips]);
    body.visible = false;
    page.scene.add(body);
    // The welded weapon, so the swim states can stow it. The pose export names
    // that subtree after the weapon template and records the name in
    // `extras.weapon`, so this is read out of the file rather than guessed.
    const weaponNode = weaponNodeOf(body, pair.weaponName ?? weapon);
    footBodies.footBody = { scene: body, mixer: rig.mixer, families: rig.families,
                 want: null, soldier: soldierName, weapon, weaponNode, kit: null };
    dressFootBody();
    if (canopy) {
      const chute = skeletonClone(canopy.scene);
      page.bindDynamicShading(chute);
      const mixer = new THREE.AnimationMixer(chute);
      const actions = {};
      for (const clip of canopy.animations) {
        const a = mixer.clipAction(clip);
        const once = clip.name === 'open';
        if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        else a.setLoop(THREE.LoopRepeat, Infinity);
        a.play();
        a.setEffectiveWeight(0);
        a.paused = true;
        actions[clip.name] = a;
      }
      chute.visible = false;
      page.scene.add(chute);
      footBodies.footCanopy = { scene: chute, mixer, actions, attach: canopy.attach,
                     want: null };
    }
    return footBodies.footBody;
  }

  /** One display frame of the third-person body: place it, pick its clips, tick
   *  its mixers. Runs whether or not the body is on screen, so that stepping into
   *  a chase view does not catch a rig frozen where it was last visible. */
  function syncFootBody(dt) {
    if (!footBodies.footBody || !page.soldier) return;
    // Under the death cam too. The death cam parks over the corpse and pitches
    // down onto it (`DEATH_CAM.foot`), and the corpse plays the death the engine
    // chose on the blow (`soldier-death.js`, `localPlayer.deathFamily`): chest or
    // back by the round's direction, a head shot, the slow fall, the crouched
    // and prone ones, the swim and the chute's. The arms rig stays out of that
    // frame on its own (`hand-weapon.js` gates the near pass on `soldierDead`).
    // `footView3p.firstPerson` stays true while dead, and the death cam is an
    // external view whatever it says, so a corpse ignores it. A death whose
    // clips did not bind draws nobody, as before: a corpse standing to
    // attention is the thing this replaces.
    const dead = !!page.soldierDead;
    const want = bodyClipFamily({
      gait: page.soldier.gait,
      stance: page.soldier.stance,
      parachute: page.soldier.chute?.clips(dead) ?? null,
      swim: page.soldier.swimClips?.(dead) ?? null,
      death: dead ? page.deathFamily : null,
    }, family => !!footBodies.footBody.families[family]);
    const visible = page.optOnFoot.checked && !page.optPilot.checked
      && (dead ? BODY_DEATHS.has(want) : !page.footView3p.firstPerson)
      && !footBodies.footBodyForceHidden;
    // `soldier.y` is the feet and so is the pose rig's root; the body's yaw is
    // the soldier's plus the half turn the export bakes in. The position is this
    // frame's blend between the last two tick boundaries, the same `presentAlpha`
    // the drawn eye uses -- a raw tick position under an interpolated camera is a
    // man juddering inside his own chase view.
    const bx = page.footFeetPrev.x + (page.footFeetCur.x - page.footFeetPrev.x) * page.presentAlpha;
    const by = page.footFeetPrev.y + (page.footFeetCur.y - page.footFeetPrev.y) * page.presentAlpha;
    const bz = page.footFeetPrev.z + (page.footFeetCur.z - page.footFeetPrev.z) * page.presentAlpha;
    footBodies.footBody.scene.position.set(bx, by, bz);
    // The view angles are not blended anywhere on this path (see the
    // render-interpolation block beside `footLookPending`): the drawn view is
    // predicted forward from the pending mouse counts, and the body turns with
    // the drawn view, not with the tick's.
    // A corpse keeps the heading it fell on while the death cam's look turns.
    footBodyEuler.set(0, dead ? page.deathYaw : page.footView.yaw, 0);
    footBodyQuat.setFromEuler(footBodyEuler);
    footBodies.footBody.scene.quaternion.copy(footBodyQuat);
    footBodies.footBody.scene.visible = visible;
    // `c_AsmHideWeapon`: every lower swim state declares it and
    // `BFSoldier::enableItem` obeys it (`0x082784af`), so a swimming soldier's
    // weapon is put away. The clips are from `animations/3P_NoWeapon/` and leave
    // his hands empty; the pose glb welds the rifle to the bones regardless, so
    // the renderer has to hide that subtree itself.
    if (footBodies.footBody.weaponNode) {
      footBodies.footBody.weaponNode.visible = !BODY_HIDES_WEAPON.has(want);
    }

    // The family was resolved above the visibility gate, because a corpse is
    // drawn only when its death bound. The order inside `bodyFamily` is the
    // engine's: the death, the parachute's whole-body pair, the swim's, the gait.
    if (want !== footBodies.footBody.want) {
      footBodies.footBody.want = want;
      for (const [family, actions] of Object.entries(footBodies.footBody.families)) {
        for (const a of actions) {
          a.setEffectiveWeight(family === want ? 1 : 0);
          if (family === want) { a.paused = false; a.reset(); a.play(); }
        }
      }
    }
    footBodies.footBody.mixer.update(dt);

    if (footBodies.footCanopy) {
      const clip = canopyClip(want);
      const [ax, ay, az] = footBodies.footCanopy.attach;
      footBodies.footCanopy.scene.position.set(bx + ax, by + ay, bz + az);
      footBodies.footCanopy.scene.quaternion.copy(footBodyQuat);
      footBodies.footCanopy.scene.visible = visible && !!clip;
      if (clip !== footBodies.footCanopy.want) {
        footBodies.footCanopy.want = clip;
        for (const [name, a] of Object.entries(footBodies.footCanopy.actions)) {
          a.setEffectiveWeight(name === clip ? 1 : 0);
          if (name === clip) { a.paused = false; a.reset(); a.play(); }
        }
      }
      footBodies.footCanopy.mixer.update(dt);
    }
  }

  /** The human's own body's hit capsules on foot (`rig-capsules.js`), or null
   *  while it has none to offer. */
  function footCapsules() {
    const body = footBodies.footBody;
    if (!body || page.soldierDead) return null;
    return rigCapsules(body.scene, footBodies.soldierBody?.collisionBones);
  }

  Object.assign(footBodies, {
    dieClips,
    disposeFootBodyScene,
    footCapsules,
    ensureFootBody,
    footBodyClips,
    footBodyLoader,
    footStateMachine,
    syncFootBody,
  });
  return footBodies;
}
