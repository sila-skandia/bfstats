// The human's own body on foot, for the third-person views and the canopy:
// the kit's soldier with the gait families and the stance clips, the
// parachute canopy, drawn at the interpolated feet. Lifted out of map.html
// (features/vehicle-instance-refactor Part 2); `soldier-body.js` stays the
// clip rules.

import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { BODY_CLIPS, BODY_ONCE, BODY_HIDES_WEAPON, bodyClipFamily, canopyClip } from './soldier-body.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bindDynamicShading`, `bust`, `footFeetCur`, `footFeetPrev`, `footView`,
 * `footView3p`, `MODELS_BASE`, `optOnFoot`, `optPilot`, `presentAlpha`,
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
  const footBodyCache = new Map();
  const footBundleCache = new Map();
  footBodies.footGaitsManifest = null;
  const footBodyQuat = new THREE.Quaternion();
  const footBodyEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  function footGaits() {
    if (!footBodies.footGaitsManifest) {
      footBodies.footGaitsManifest =
        fetch(`${page.MODELS_BASE}/poses/gaits/gaits.json${page.bust()}`)
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null);
    }
    return footBodies.footGaitsManifest;
  }

  /** One shared clip sidecar's animations, by its path relative to `poses/`. */
  function footBundle(relative) {
    if (!relative) return Promise.resolve([]);
    if (!footBundleCache.has(relative)) {
      footBundleCache.set(relative, footBodyLoader
        .loadAsync(`${page.MODELS_BASE}/poses/${relative}${page.bust()}`)
        .then(g => g.animations ?? [], () => []));
    }
    return footBundleCache.get(relative);
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
    return [...lower, ...upper, ...chute, ...swim];
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

  /** (Re)build the third-person body for `soldierName` holding `weapon`.
   *
   * Called wherever the weapon in hand changes, because the pose glb carries the
   * welded weapon — swapping to the knife has to change the body, not just the
   * arms rig. A repeat call for the pair already loaded is a no-op, so a respawn
   * with the same kit costs nothing. */
  async function ensureFootBody(soldierName, weapon) {
    if (!soldierName || !weapon) return null;
    if (footBodies.footBody && footBodies.footBody.soldier === soldierName
        && footBodies.footBody.weapon === weapon) return footBodies.footBody;
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
    const weaponNode = body.getObjectByName(pair.weaponName ?? weapon) ?? null;
    footBodies.footBody = { scene: body, mixer: rig.mixer, families: rig.families,
                 want: null, soldier: soldierName, weapon, weaponNode };
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
    // NOT under the death cam, deliberately. The death cam is an external view --
    // it parks a couple of metres behind and above the corpse and pitches down
    // onto it (`DEATH_CAM.foot`) -- so the body would fit there, and it was
    // wired up and then taken out again on the frame it produced
    // (`08-death-cam.png`): there is no death family in `soldier-body.js`, so the
    // man lies dead and the rig plays `stand`, and the near pass still draws the
    // first-person arms over the top because it gates on `firstPerson`, which
    // stays true while dead. A standing man under a death cam is the same kind
    // of wrong that gated `?soldier3p=1` in the first place. It wants the
    // `Lb_Die*` families, which this stream did not survey.
    //
    // ONE EXCEPTION, added by the swim stream: a man who dies in the water has a
    // real death family. `BFSoldier::handleDamage` tests `c_AsmIsSwimming` before
    // the pose (`0x08270c51`-`0x08270c8a`) and plays `Lb_DieSwim` / `Ub_DieSwim`,
    // and those two clips are baked, so the corpse can be drawn instead of a man
    // standing to attention. The family is resolved first and the gate consults
    // it, which is the whole of the change; a land death still draws nobody.
    const want = bodyClipFamily({
      gait: page.soldier.gait,
      stance: page.soldier.stance,
      parachute: page.soldier.chute?.clips(!!page.soldierDead) ?? null,
      swim: page.soldier.swimClips?.(!!page.soldierDead) ?? null,
    }, family => !!footBodies.footBody.families[family]);
    const deathFamily = want === 'swimDie' || want === 'parachuteDie'
      || want === 'parachuteDeadLanded';
    const visible = page.optOnFoot.checked && !page.optPilot.checked
      && (!page.soldierDead || deathFamily)
      && !page.footView3p.firstPerson && !footBodies.footBodyForceHidden;
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
    footBodyEuler.set(0, page.footView.yaw, 0);
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

    // The family was resolved above the visibility gate, because the swim death is
    // the one death this rig can draw. The order inside `bodyFamily` is the
    // engine's: the parachute's whole-body pair, then the swim's, then the gait.
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

  Object.assign(footBodies, {
    disposeFootBodyScene,
    ensureFootBody,
    footBodyClips,
    footBodyLoader,
    syncFootBody,
  });
  return footBodies;
}
