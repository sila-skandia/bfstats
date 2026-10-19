// The soldier's own paint over a shared weapon rig.
//
// First-person rigs used to be exported per (soldier, weapon) pair, and the
// nation twins were byte-identical bodies differing only in which sleeve and
// hand textures the materials held (features/mesh-asset-size, phase 5 step
// 4). Now a weapon's body is exported once, for one canonical soldier, and
// `viewmodels/index.json` (format bf1942-rig-index/2) carries a `pairs` row
// for every other soldier: the canonical rig file to load, the soldier's own
// texture for each canonical image, and the skin glb that holds those
// textures (`viewmodels/soldiers/<Soldier>.skin.glb`, one material a texture,
// written by `extract_viewmodel.py`). This module loads that skin once per
// soldier and swaps the rig's colour maps — the exact mechanism a level's
// paint uses (`level-skin.js`), run just before it.
//
// The swapped texture keeps its own name (the archive entry it was read
// from), so the level's repaint that follows keys off the soldier's image —
// `skins.json` rows cover the painted soldiers' images too (`rig_images`) —
// and a level switch hands the material the soldier's texture back, exactly
// as it hands a canonical rig its own.
//
// A nicety: a missing skin glb, a row naming a texture the skin lacks, and a
// load error all leave the rig in the canonical soldier's paint, with a
// warning and never an error.

/** A texture's or an image's name as the files spell it: lower case, forward
 *  slashes (level-skin.js's `imageKey`). */
const imageKey = name => String(name ?? '').replace(/\\/g, '/').toLowerCase();

// One skin per (tree, file) for the page, shared by every rig that needs it.
const skins = new Map();   // `${base}|${file}` -> Promise<Map<fileKey, texture>|null>

/** The textures of a loaded soldier skin, keyed by each one's own file name
 *  (the material is named for it too, and GLTFLoader names a texture after
 *  its image, so either answers). */
export function soldierSkinTextures(scene) {
  const byFile = new Map();
  scene?.traverse(obj => {
    for (const material of [obj.material].flat()) {
      const texture = material?.map;
      if (!texture) continue;
      for (const key of [imageKey(material.name), imageKey(texture.name)]) {
        if (key && !byFile.has(key)) byFile.set(key, texture);
      }
    }
  });
  return byFile;
}

function skinFor(base, file, { loader, bust = '' }) {
  const key = `${base}|${file}`;
  if (!skins.has(key)) {
    skins.set(key, Promise.resolve()
      .then(() => loader.loadAsync(`${base}/viewmodels/${file}${bust}`))
      .then(gltf => soldierSkinTextures(gltf.scene))
      .catch(err => {
        console.warn(`soldier skin ${file}:`, err);
        return null;
      }));
  }
  return skins.get(key);
}

/**
 * Paint `scene` (a mounted rig's) as `entry`'s soldier: every colour map
 * whose image the row maps takes the soldier's own texture. `entry` is the
 * rig index entry (`pose-bases.js` `rigIndexOf`): `base` the tree, `skin`
 * the skin glb's path under `viewmodels/`, `textures` canonical image ->
 * soldier image. Resolves to how many materials changed; never rejects.
 */
export async function paintSoldierRig(scene, entry, { loader, bust = '' }) {
  if (!scene || !entry?.textures || !entry.skin || !loader) return 0;
  const base = entry.base ?? 'models';
  const skin = await skinFor(base, entry.skin, { loader, bust });
  if (!skin) return 0;
  const wanted = new Map(Object.entries(entry.textures)
    .map(([image, own]) => [imageKey(image), imageKey(own)]));
  let changed = 0;
  scene.traverse(obj => {
    for (const material of [obj.material].flat()) {
      const held = material?.map;
      if (!held) continue;
      const own = wanted.get(imageKey(held.name));
      if (!own) continue;
      const texture = skin.get(own);
      if (!texture) {
        console.warn(`soldier skin ${entry.skin}: no texture for ${own}`);
        continue;
      }
      if (texture === held) continue;
      material.map = texture;
      material.needsUpdate = true;
      changed += 1;
    }
  });
  return changed;
}

/** Drop every cached skin (a test, or a page that switched trees). */
export function forgetSoldierSkins() {
  skins.clear();
}
