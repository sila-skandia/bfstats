// What a replay draws with, fetched once per page: vehicle and body models,
// the soldiers' (soldier, weapon) pose pairs, and the gait clips retargeted
// onto them. One ReplayAssets lives on the replay controller, so the caches
// outlast any one recording and are never shared through module state.

import { isPropellerBlurPair } from './vehicle-base.js';
import { createPoseComposer } from './pose-compose.js';
import { bundleClips } from './soldier-actions.js';
import { byName, modelFileStem } from './model-file.js';
import { loadFirst, poseBases } from './pose-bases.js';

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

/** The material slots repainted: the colour map, which is what a level's
 *  alternative path paints (a bake's lightmaps are the level's own and
 *  never a model's). */
const TEXTURE_SLOTS = ['map'];

/** A texture's file as a level and a model both name it: the leaf, lower
 *  case, without its extension (`texture/Africa/sherma_i.dds` is `sherma_i`). */
const textureLeaf = path => String(path ?? '').replace(/\\/g, '/').split('/').pop().replace(/\.[^.]*$/, '').toLowerCase();

/**
 * The level's own paint, `leaf -> THREE.Texture`: every texture the level's
 * bake read from somewhere other than `texture/<file>`. BF1942 looks a
 * texture up in the level's `textureManager.alternativePath` before the game's
 * own: Tobruk's is `Texture/Africa`, which paints every vehicle on it desert
 * (its bake's Sherman wears `texture/Africa/sherma_i`, the template's model
 * `texture/Sherma_I`). A level archive's own textures come the same way.
 */
export function levelSkins(root) {
  const skins = new Map();
  root?.traverse(obj => {
    for (const material of [obj.material].flat()) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = material?.[slot];
        const path = String(texture?.name ?? '').replace(/\\/g, '/').toLowerCase();
        const leaf = textureLeaf(path);
        if (!leaf || /^texture\/[^/]+$/.test(path) || skins.has(leaf)) continue;
        skins.set(leaf, texture);
      }
    }
  });
  return skins;
}

/** Paint `scene` (a template's model) with the level's own textures where
 *  the level has its own (`levelSkins`), over the ones it took from the
 *  game's `texture/` (a level's variant already wears its level's). Returns
 *  how many it changed. */
export function wearLevelSkin(scene, skins) {
  let changed = 0;
  if (!skins?.size) return changed;
  scene.traverse(obj => {
    for (const material of [obj.material].flat()) {
      if (!material) continue;
      for (const slot of TEXTURE_SLOTS) {
        const own = material[slot];
        const path = String(own?.name ?? '').replace(/\\/g, '/').toLowerCase();
        const level = /^texture\/[^/]+$/.test(path) ? skins.get(textureLeaf(path)) : null;
        if (!level || level === own) continue;
        material[slot] = level;
        material.needsUpdate = true;
        changed += 1;
      }
    }
  });
  return changed;
}

export class ReplayAssets {
  constructor(ctx) {
    this.ctx = ctx;
    this.modelCache = new Map();
    this.catalogues = new Map();        // models root -> Promise<models.json | null>, fetched once
    this.skins = null;                  // { root, skins } for the level on screen
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

  /** A template's model (`Sherman`, `Sherman.wreck`), dressed the way the
   *  level on screen dresses its own: the level's variant where the catalogue
   *  has one, and the level's own textures (`levelSkins`) over the rest.
   *
   *  The mod's model tree first, then vanilla's (`pose-bases.js`
   *  `poseBases`): a mod's tree holds what the mod adds or changes, and the
   *  rest of its level's templates are vanilla's files, as the game's own
   *  archive chain finds them. Asked of the mod's tree alone, a Secret Weapons
   *  round had no Stationary MG42, flak gun, Willy or Spitfire to build a hull
   *  from: a gun emplacement and its gunner drew nothing, and its first person
   *  and HUD fell back to the orbit. */
  model(name) {
    const level = String(this.ctx.levelName?.() ?? '').toLowerCase();
    const key = `${level}/${name}`;
    if (!this.modelCache.has(key)) {
      this.modelCache.set(key, this.modelUrlList(name, level)
        .then(urls => loadFirst(this.ctx.loader, urls.map(url => `${url}${this.ctx.bust()}`)))
        .then(gltf => {
          gltf.scene.traverse(obj => {
            const data = obj.userData || {};
            // What show() hides on the level: baked weapon-effect payloads. And
            // collision hulls, which are geometry but not for drawing.
            if (data.effect || data.projectileMesh || data.projectileTrail
                || data.collision || /collision/i.test(obj.name || '')) obj.visible = false;
          });
          setReplayPropellerIdle(gltf.scene);
          // A nicety: a model the level cannot repaint is drawn as it is.
          try {
            wearLevelSkin(gltf.scene, this.levelSkins());
          } catch (error) {
            console.warn(`replay: ${name} left in its own paint`, error);
          }
          // The page's own vehicle shading, so a replayed tank is lit like a
          // parked one rather than by raw glTF materials.
          this.ctx.shadeModel?.(gltf.scene);
          return gltf.scene;
        }).catch(() => null));
    }
    return this.modelCache.get(key);
  }

  /** models.json, or null: read once. The active tree's own. */
  catalogue() {
    this.cataloguePromise ??= this.catalogueOf(this.ctx.modelsBase);
    return this.cataloguePromise;
  }

  /** `base`'s models.json, or null, read once per tree. */
  catalogueOf(base) {
    this.catalogues ??= new Map();
    if (!this.catalogues.has(base)) {
      this.catalogues.set(base, fetch(`${base}/models.json${this.ctx.bust()}`)
        .then(response => (response.ok ? response.json() : null))
        .then(list => (Array.isArray(list) ? list : null))
        .catch(() => null));
    }
    return this.catalogues.get(base);
  }

  /** The file `name` is read from on `level`: the level's own variant where
   *  the catalogue lists one (a level archive's reskin: Kasserine Pass's
   *  Sherman is `Sherman.Kasserine_Pass.glb`), else `<name>.glb`. */
  async modelFile(name, level) {
    const own = `${modelFileStem(name)}.glb`;
    if (!level) return own;
    const entry = this.entryNamed(await this.catalogue(), name);
    return this.variantOf(entry, name, level)?.glb ?? own;
  }

  /** A catalogue's entry for the template `name` (a `.wreck` is its
   *  template's), or undefined. */
  entryNamed(list, name) {
    const template = String(name).replace(/\.wreck$/i, '').toLowerCase();
    return list?.find(e => String(e?.name).toLowerCase() === template);
  }

  /** `entry`'s variant for `level`: the wreck's for a `.wreck` name, the
   *  entry's own configuration otherwise. */
  variantOf(entry, name, level) {
    const wreck = /\.wreck$/i.test(name);
    return entry?.variants?.find(v => String(v?.level ?? '').toLowerCase() === level && !v.firstPerson
      && (wreck ? v.configuration === 'wreck' : v.configuration === entry.configuration));
  }

  /**
   * Every url `name` can be loaded from on `level`, best first. A mod's
   * extraction holds only what the mod adds (Secret Weapons' tree has no
   * `Willy`, `BF109` or `Stationary_mg42`: they are vanilla's files, as the
   * game's archive chain falls back to `bf1942`), so the active tree is asked
   * and then vanilla's (`poseBases`): the level's own variant from whichever
   * tree's catalogue lists it, then the plain file from the trees that list
   * the template, then the rest. A model looked up in the mod tree alone was
   * never drawn: ten of the fifteen templates of a Raid on Agheila round, the
   * machine gun its recorder sat in among them.
   */
  async modelUrlList(name, level) {
    const bases = poseBases(this.ctx.modelsBase);
    const lists = await Promise.all(bases.map(base => this.catalogueOf(base)));
    const urls = [];
    const own = `${modelFileStem(name)}.glb`;
    if (level) {
      bases.forEach((base, i) => {
        const variant = this.variantOf(this.entryNamed(lists[i], name), name, level);
        if (variant?.glb) urls.push(`${base}/${variant.glb}`);
      });
    }
    const listed = bases.filter((base, i) => this.entryNamed(lists[i], name));
    for (const base of [...listed, ...bases.filter(base => !listed.includes(base))]) urls.push(`${base}/${own}`);
    return [...new Set(urls)];
  }

  /** The level on screen's own textures (`levelSkins`), gathered once a level. */
  levelSkins() {
    const root = this.ctx.levelRoot?.() ?? null;
    if (!root) return null;
    if (this.skins?.root !== root) this.skins = { root, skins: levelSkins(root) };
    return this.skins.skins;
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

  // Each clip carries its state as `clip.userData` (soldier-actions.js
  // `bundleClips`, the loader the page's own bodies use): the morph a
  // replayed soldier enters its gait with rides on it (replay-gait.js).
  gaitBundle(relative) {
    if (!this.gaitBundleCache.has(relative)) {
      const url = `${this.posesBase()}/${relative}${this.ctx.bust()}`;
      this.gaitBundleCache.set(relative, this.ctx.loader.loadAsync(url)
        .then(bundleClips)
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
    const grip = byName(manifest.weaponGrip, weapon) ?? weapon;
    const gripPath = byName(manifest.grips, grip);
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
