// The level's own paint over a model that was extracted without a level.
//
// An arms rig (`<Soldier>__<Weapon>.fp.glb`), a soldier's body
// (`poses/rigs/<Soldier>.rig.glb`, `poses/*.pose.glb`), the weapon in his
// hand, the helmet and packs of his kit and the kit he drops are extracted
// once a mod, so their textures are the ones the mod's archives answer with no
// level loaded. The game never draws them that way: BF1942 looks a texture's
// file name up under each of the level's `textureManager.alternativePath`
// folders before the path the shader wrote (ledger LOAD-3), and a level's
// Init.con adds them before anyone spawns. Forgotten Hope's Battle of Foy
// adds `Texture/ENVIROMENT_WINTER`, whose `Ste_hand2` is a grey wool glove
// over the same hand mesh every other level draws bare, and
// `Texture/GENERAL_US_WINTER`, whose `Ame1_sleeve_T` is the winter sleeve and
// whose `Amerov_Z` is the winter uniform.
//
// `extract_viewmodel.py` (`write_level_skins`) resolves every image those
// glbs carry as each baked level would and writes what differs:
// `viewmodels/skins.json`, per level folder the image and the file the level
// reads in its place, and `viewmodels/skins/<level>.skin.glb` holding those
// textures. This module fetches them and swaps the colour maps.
//
// One texture a level file for the whole page: every soldier's material that
// names an image is handed the same object, and nothing is cloned a soldier.
//
// A nicety: a tree with no skins.json, a level with no row and a skin that
// fails to load all leave the model in the mod's own paint, with a warning
// for the last and never an error.

/** A texture's or an image's name as both files spell it: lower case, forward
 *  slashes. */
const imageKey = name => String(name ?? '').replace(/\\/g, '/').toLowerCase();

// A model outlives a level: the rigs, the weapons and the composed poses are
// cached for the page, and the page changes level in place. Retail never
// does: a level change relaunches the client (RECON-7; a host's last round
// 0x004b2ef0 and a menu join with a game up 0x0069f8d0 both end in the
// CreateProcessA of 0x00454dd0), so nothing of the level before reaches the
// next, though within one process the TextureManager's alternative paths
// and the FileManager's search paths only grow (`addAlternativePath`
// 0x006435d0, `addPath` 0x00410ccf, no caller clears either). So a repaint is
// undone by name too, and the page draws each level as a fresh client would. `paintedFrom` says which image a level's texture stands
// in for, `owns` keeps the mod's own texture of each image a level has
// replaced (a handful a tree), and a material holding a level's texture is
// handed the next level's, or its own back.
const paintedFrom = new WeakMap();   // a level's texture -> the image key it replaces
const owns = new Map();              // image key -> the mod's own texture

/**
 * The textures of a loaded skin, keyed by the image each replaces. `row` is
 * the level's row of skins.json (`textures`: image -> the level's file);
 * `scene` the skin glb's scene, one material a texture, each named for the
 * image it replaces (`extract_viewmodel.py` `build_level_skin`).
 *
 * The material's name is the key, and the texture's own name only the
 * fallback: GLTFLoader names a texture after its image, but hands out one
 * texture for every image at one address, and the texture store keeps a
 * picture once (Battle of Foy's four gloved `Hand0N_r` are one file).
 */
export function skinTextures(row, scene) {
  const byImage = new Map();
  const byFile = new Map();
  scene?.traverse(obj => {
    for (const material of [obj.material].flat()) {
      const texture = material?.map;
      if (!texture) continue;
      const image = imageKey(material.name);
      if (image && !byImage.has(image)) byImage.set(image, texture);
      const file = imageKey(texture.name);
      if (file && !byFile.has(file)) byFile.set(file, texture);
    }
  });
  const skin = new Map();
  for (const [image, levelFile] of Object.entries(row?.textures ?? {})) {
    const key = imageKey(image);
    let texture = byImage.get(key) ?? byFile.get(imageKey(levelFile));
    if (!texture) continue;
    // One file standing in for two images: a copy each (it shares the
    // picture), so each can be traced back to the image it replaced.
    const taken = paintedFrom.get(texture);
    if (taken && taken !== key && typeof texture.clone === 'function') texture = texture.clone();
    if (!paintedFrom.has(texture)) paintedFrom.set(texture, key);
    skin.set(key, texture);
  }
  return skin;
}

/** Paint `scene` with `skin` (`skinTextures`): every colour map whose image
 *  the level reads from another file takes the level's, and one still wearing
 *  another level's takes this level's or its own back (an empty or missing
 *  `skin` is a level that repaints nothing). Returns how many materials
 *  changed. */
export function wearSkin(scene, skin) {
  let changed = 0;
  scene?.traverse(obj => {
    for (const material of [obj.material].flat()) {
      const held = material?.map;
      if (!held) continue;
      const painted = paintedFrom.get(held);
      const key = painted ?? imageKey(held.name);
      const want = skin?.get(key) ?? (painted ? owns.get(key) : null);
      if (!want || want === held) continue;
      if (!painted && !owns.has(key)) owns.set(key, held);
      material.map = want;
      material.needsUpdate = true;
      changed += 1;
    }
  });
  return changed;
}

// The page's level, for the loaders that know no level: a soldier's body is
// composed by `pose-compose.js` for the bots, the seats, a replay and the
// multiplayer room alike, and none of them is told which level is on screen.
// Whoever does know shares it once (`arms-rig.js`, beside the arms' own).
let pagePaint = null;

/** Make `wear(scene)` the page's paint: what `wearPagePaint` hands a scene
 *  to. */
export function sharePagePaint(wear) {
  pagePaint = typeof wear === 'function' ? wear : null;
}

/** Paint `scene` as the level on screen does, where the page has shared one
 *  (a model browser has no level and shares none). Resolves to how many
 *  materials changed; never rejects. */
export async function wearPagePaint(scene) {
  if (!pagePaint || !scene) return 0;
  try {
    return (await pagePaint(scene)) || 0;
  } catch (err) {
    console.warn('level skin:', err);
    return 0;
  }
}

/** The page has changed level in place: paint each of `roots` again as the
 *  level now on screen does. What it still draws from the level before (the
 *  soldier's body and his canopy, the arms, a held round, anything kept for
 *  the page) holds that level's textures, and takes this one's or its own
 *  back. Resolves to how many materials changed; never rejects. */
export async function repaintPage(roots) {
  const counts = await Promise.all([...(roots ?? [])].filter(Boolean)
    .map(root => wearPagePaint(root)));
  return counts.reduce((sum, n) => sum + n, 0);
}

// One index a tree and one skin a level for the whole page, whoever asks: the
// page's arms, a replay's and every body are painted from the same textures.
const trees = new Map();   // models base -> { index, skins }
const asked = new WeakMap();   // a scene -> how many paints it has been asked for

/**
 * The skins of one models tree. `loader()` is the page's GLTFLoader,
 * `modelsBase()` the tree (`models/mods/fhsw`), `bust()` the cache-bust query.
 */
export function createLevelSkin({ loader, modelsBase, bust = () => '' }) {
  /** The tree's index (a Promise of skins.json's `levels`, or {}) and its
   *  skins (level folder -> Promise<Map>). */
  function tree() {
    const base = modelsBase();
    if (!trees.has(base)) {
      trees.set(base, {
        base,
        index: fetch(`${base}/viewmodels/skins.json${bust()}`)
          .then(res => (res.ok ? res.json() : null))
          .then(json => json?.levels ?? {})
          .catch(() => ({})),
        skins: new Map(),
      });
    }
    return trees.get(base);
  }

  /** The level's skin (image -> texture), empty when it repaints nothing. */
  function skinFor(levelDir) {
    const key = String(levelDir ?? '').toLowerCase();
    if (!key) return Promise.resolve(new Map());
    const { base, index, skins } = tree();
    if (!skins.has(key)) {
      skins.set(key, index.then(async levels => {
        const row = levels[key];
        if (!row?.file) return new Map();
        const gltf = await loader().loadAsync(`${base}/viewmodels/${row.file}${bust()}`);
        return skinTextures(row, gltf.scene);
      }).catch(err => {
        console.warn(`level skin ${key}:`, err);
        return new Map();
      }));
    }
    return skins.get(key);
  }

  /** Paint `scene` as the level in `levelDir` does. Never rejects. The last
   *  request for a scene wins: a level switch asks again while the old
   *  level's skin may still be in flight, and that one must not land last. */
  async function wear(scene, levelDir) {
    const mine = (asked.get(scene) ?? 0) + 1;
    if (scene) asked.set(scene, mine);
    try {
      const skin = await skinFor(levelDir);
      if (scene && asked.get(scene) !== mine) return 0;
      return wearSkin(scene, skin);
    } catch (err) {
      console.warn('level skin:', err);
      return 0;
    }
  }

  return { skinFor, wear };
}

/** Forget every tree's index and skins (a test). */
export function forgetLevelSkins() {
  trees.clear();
  owns.clear();
}
