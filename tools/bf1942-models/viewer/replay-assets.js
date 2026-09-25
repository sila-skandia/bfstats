// What a replay draws with, fetched once per page: vehicle and body models,
// the soldiers' (soldier, weapon) pose pairs, and the gait clips retargeted
// onto them. One ReplayAssets lives on the replay controller, so the caches
// outlast any one recording and are never shared through module state.

import { isPropellerBlurPair } from './vehicle-base.js';
import { createPoseComposer } from './pose-compose.js';

/**
 * The idle propeller state every replayed aircraft carries, and why.
 *
 * A `models/<Template>.glb` keeps both of a vanilla prop plane's meshes as
 * real siblings under the LodObject wrapper, stamped `extras.propellerBlur`
 * (assemble.py's `_propeller_blur`): the static blade and the blurred disc
 * the engine swaps in at `addLodComparison 0.07` once the throttle passes it.
 * The playable map hides the disc when the level loads and `flight.js`
 * (`applyRig`'s pair loop) toggles the pair from the flown vehicle's live
 * throttle — a parked plane blades-out, a flown one blurs past the threshold.
 *
 * A replay has neither: the recording carries position and hit points per
 * object, never an engine scalar, so there is no throttle to read and no
 * Vehicle to run `applyRig` on. Every replayed aircraft therefore gets the
 * one state the level's own parked spawners show — blade visible, disc
 * hidden. Without this the clone draws both meshes at once from its first
 * frame, the blade straight through the blur, because the glb exports both
 * visible and the pair toggle is the only thing that ever picks one.
 *
 * The kind gate is `flight.js`'s own (`isPropellerBlurPair`): the bf109's
 * *cockpit* LodObject wears the same Static/Blurred naming under a
 * `DistCompareSelector`, and its "blurred" half is the pilot's 1P interior.
 * Fresh trees exclude the interior from the export (the wrapper's children
 * find no `blurred` name and the walk is a no-op), but an already-published
 * tree carries both halves, and hiding one of them would strip the bf109's
 * cockpit out of every replay flown past it.
 *
 * Exported for the headless check (`tests/test_replay_models.py`), which
 * pins the law against a synthetic glb tree rather than a browser page.
 */
export function setReplayPropellerIdle(scene) {
  scene.traverse(obj => {
    const blur = obj.userData?.propellerBlur;
    if (!blur || !isPropellerBlurPair(blur)) return;
    const blurred = obj.children.find(child => child.name === blur.blurred);
    if (blurred) blurred.visible = false;
  });
}

export class ReplayAssets {
  constructor(ctx) {
    this.ctx = ctx;
    this.modelCache = new Map();
    this.gaitBundleCache = new Map();   // relative sidecar path -> Promise<AnimationClip[]>
    this.gaitsManifestPromise = null;   // Promise<gaits.json>, fetched once and shared
    /** Where a soldier's mesh comes from: the split tree's recipe + rig +
     *  weapon where the tree has them, the monolithic `.pose.glb` where it
     *  does not (`pose-compose.js`). The rigs and the weapons behind it are
     *  cached per URL for the whole page, which is the point of the split
     *  tree -- a replay and the level under it draw one rig, not two. */
    this.poses = createPoseComposer({
      loader: () => this.ctx.loader,
      modelsBase: () => this.ctx.modelsBase,
      bust: () => this.ctx.bust(),
      shade: scene => this.ctx.shadeModel?.(scene),
    });
  }

  model(name) {
    if (!this.modelCache.has(name)) {
      const url = `${this.ctx.modelsBase}/${name}.glb${this.ctx.bust()}`;
      this.modelCache.set(name, this.ctx.loader.loadAsync(url).then(gltf => {
        gltf.scene.traverse(obj => {
          const data = obj.userData || {};
          // What show() hides on the level: baked weapon-effect payloads. And
          // collision hulls, which are geometry but not for drawing.
          if (data.effect || data.projectileMesh || data.projectileTrail
              || data.collision || /collision/i.test(obj.name || '')) obj.visible = false;
        });
        setReplayPropellerIdle(gltf.scene);
        // The page's own vehicle shading, so a replayed tank is lit like a
        // parked one rather than by raw glTF materials.
        this.ctx.shadeModel?.(gltf.scene);
        return gltf.scene;
      }).catch(() => null));
    }
    return this.modelCache.get(name);
  }

  // --- soldier gait animation: loading and retargeting ---------------------
  //
  // models/<Template>.glb (model() above) is rigid, unskinned geometry for a
  // soldier -- extract_models.py bakes a fixed part arrangement with no
  // skeleton at all (verified against the live asset: 5 nodes, 0 skins,
  // "USMarine3PBody" etc. as static children). There is nothing a clip could
  // bind onto. The only soldier asset with a skeleton is the weapon-pose
  // matrix poses.html already animates --
  // models/poses/<Soldier>__<Weapon>.pose.glb, mesh + skin + stance clips
  // (verified: its skeleton's node names are a strict superset of
  // gaits/lower.gait.glb's 67 joint names). A soldier life's drawable mesh
  // comes from there instead of the plain body model now, falling back to
  // the plain model if the pose pair fails to load -- never a broken page.
  //
  // Retargeting the shared lower.gait.glb / <grip>.gait.glb clips onto that
  // skeleton is the identical name-based binding poses.html already proved:
  // three.js resolves a clip's tracks by node NAME against whatever root the
  // AnimationMixer holds, so a sidecar carrying only a joint hierarchy binds
  // straight onto a different file's skinned scene, no track rewriting.

  posesBase() {
    return `${this.ctx.modelsBase}/poses`;
  }

  gaitsManifest() {
    if (!this.gaitsManifestPromise) {
      this.gaitsManifestPromise = fetch(`${this.posesBase()}/gaits/gaits.json${this.ctx.bust()}`)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .catch(() => ({ lower: null, grips: {}, weaponGrip: {} }));
    }
    return this.gaitsManifestPromise;
  }

  gaitBundle(relative) {
    if (!this.gaitBundleCache.has(relative)) {
      const url = `${this.posesBase()}/${relative}${this.ctx.bust()}`;
      this.gaitBundleCache.set(relative, this.ctx.loader.loadAsync(url)
        .then(gltf => gltf.animations ?? [])
        .catch(() => []));
    }
    return this.gaitBundleCache.get(relative);
  }

  // The shared lower-body clips plus the two upper-body clips for whatever
  // grip `weapon` resolves to (gaits.json mirrors copyState's donor sharing:
  // 23 grips, not one per weapon), cached per grip so soldiers sharing a
  // weapon -- or sharing a donor grip -- fetch its bundle once.
  async gaitClipsFor(weapon) {
    const manifest = await this.gaitsManifest();
    const grip = manifest.weaponGrip?.[weapon] ?? weapon;
    const gripPath = manifest.grips?.[grip];
    if (!manifest.lower) return [];
    let upper = gripPath ? await this.gaitBundle(gripPath) : [];
    if ((!upper || !upper.length) && gripPath !== 'gaits/Colt.gait.glb') {
      upper = await this.gaitBundle('gaits/Colt.gait.glb');
    }
    const lower = await this.gaitBundle(manifest.lower);
    return [...lower, ...upper];
  }

  // Mesh + skeleton + stance clips for one (soldier, weapon) pair. Never
  // thrown: a missing pair resolves to null so load() can fall back to the
  // plain body model. The composer caches the pair, and the rigs and the
  // weapons behind it for the whole page.
  posePair(soldier, weapon) {
    return this.poses.pose(soldier, weapon);
  }
}
