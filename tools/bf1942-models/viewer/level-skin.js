// The level's own paint over a model that was extracted without a level.
//
// An arms rig (`<Soldier>__<Weapon>.fp.glb`) is extracted once a mod, so its
// textures are the ones the mod's archives answer with no level loaded. The
// game never draws it that way: BF1942 looks a texture's file name up under
// each of the level's `textureManager.alternativePath` folders before the
// path the shader wrote (ledger LOAD-3), and a level's Init.con adds them
// before anyone spawns. Forgotten Hope's Battle of Foy adds
// `Texture/ENVIROMENT_WINTER`, whose `Ste_hand2` is a grey wool glove over the
// same hand mesh every other level draws bare, and `Texture/GENERAL_US_WINTER`,
// whose `Ame1_sleeve_T` is the winter sleeve.
//
// `extract_viewmodel.py` (`write_level_skins`) resolves every image the
// tree's rigs carry as each baked level would and writes what differs:
// `viewmodels/skins.json`, per level folder the rig image and the file the
// level reads in its place, and `viewmodels/skins/<level>.skin.glb` holding
// those textures. This module fetches them and swaps the colour maps.
//
// A nicety: a tree with no skins.json, a level with no row and a skin that
// fails to load all leave the rig in the mod's own paint, with a warning for
// the last and never an error.

/** A texture's or an image's name as both files spell it: lower case, forward
 *  slashes. */
const imageKey = name => String(name ?? '').replace(/\\/g, '/').toLowerCase();

/**
 * The textures of a loaded skin, keyed by the rig image each replaces.
 * `row` is the level's row of skins.json (`textures`: rig image -> the
 * level's file); `scene` the skin glb's scene, whose textures are named for
 * the level's files (GLTFLoader names a texture after its image).
 */
export function skinTextures(row, scene) {
  const byFile = new Map();
  scene?.traverse(obj => {
    for (const material of [obj.material].flat()) {
      const texture = material?.map;
      const key = imageKey(texture?.name);
      if (key && !byFile.has(key)) byFile.set(key, texture);
    }
  });
  const skin = new Map();
  for (const [rigImage, levelFile] of Object.entries(row?.textures ?? {})) {
    const texture = byFile.get(imageKey(levelFile));
    if (texture) skin.set(imageKey(rigImage), texture);
  }
  return skin;
}

/** Repaint `scene` with `skin` (`skinTextures`): every colour map whose image
 *  the level reads from another file takes the level's. Returns how many
 *  materials changed. */
export function wearSkin(scene, skin) {
  let changed = 0;
  if (!skin?.size) return changed;
  scene?.traverse(obj => {
    for (const material of [obj.material].flat()) {
      const own = material?.map;
      const level = own ? skin.get(imageKey(own.name)) : null;
      if (!level || level === own) continue;
      material.map = level;
      material.needsUpdate = true;
      changed += 1;
    }
  });
  return changed;
}

/**
 * The skins of one models tree. `loader()` is the page's GLTFLoader,
 * `modelsBase()` the tree (`models/mods/fhsw`), `bust()` the cache-bust query.
 */
export function createLevelSkin({ loader, modelsBase, bust = () => '' }) {
  let index = null;             // Promise of skins.json's `levels`, or {}
  const skins = new Map();      // level folder -> Promise<Map>

  function loadIndex() {
    index ??= fetch(`${modelsBase()}/viewmodels/skins.json${bust()}`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => json?.levels ?? {})
      .catch(() => ({}));
    return index;
  }

  /** The level's skin (rig image -> texture), empty when it repaints nothing. */
  function skinFor(levelDir) {
    const key = String(levelDir ?? '').toLowerCase();
    if (!key) return Promise.resolve(new Map());
    if (!skins.has(key)) {
      skins.set(key, loadIndex().then(async levels => {
        const row = levels[key];
        if (!row?.file) return new Map();
        const gltf = await loader().loadAsync(`${modelsBase()}/viewmodels/${row.file}${bust()}`);
        return skinTextures(row, gltf.scene);
      }).catch(err => {
        console.warn(`level skin ${key}:`, err);
        return new Map();
      }));
    }
    return skins.get(key);
  }

  /** Paint `scene` as the level in `levelDir` does. Never rejects. */
  async function wear(scene, levelDir) {
    try {
      return wearSkin(scene, await skinFor(levelDir));
    } catch (err) {
      console.warn('level skin:', err);
      return 0;
    }
  }

  return { skinFor, wear };
}
