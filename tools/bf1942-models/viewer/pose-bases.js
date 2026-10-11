// Where a soldier's pose assets are: the active mod's own model tree first,
// then vanilla's.
//
// A mod's extraction writes only what the mod adds -- Road to Rome's
// `ItalianSoldier__Breda.pose.glb`, Secret Weapons' `Gewehr43_zf4` grip --
// while the soldiers and weapons it inherits are vanilla's files, exactly as
// the game's own archive chain falls back to `bf1942`. A figure looked up in
// the mod tree alone was never drawn: on Anzio every American bot, on
// Telemark every bot, had no body at all. The kit parts already fall back the
// same way (`soldier-dress.js`, `bases`).
//
// **The fallthrough is per half, not per pose.** A split pose is three
// documents -- a recipe, a rig and a weapon -- and a mod can supply any one of
// them: a mod pose that pairs a vanilla soldier with a mod weapon resolves its
// recipe from the mod tree, its rig from vanilla's and its weapon from the
// mod's. So each of `poseUrls`, `rigUrls` and `weaponUrls` is asked
// separately, and a caller that gets its recipe from the mod tree still asks
// both trees for the halves that recipe names.

import { modelFileStem } from './model-file.js';

/** The model roots to try, in order: `modelsBase` (the active mod's,
 *  `models/mods/xpack1`, or vanilla's own `models`), then vanilla's. */
export function poseBases(modelsBase) {
  return [...new Set([modelsBase || 'models', 'models'])];
}

/** `rel` (a path under `poses/`) in each base, in order. */
export function poseUrls(modelsBase, rel, bust = '') {
  return poseBases(modelsBase).map(base => `${base}/poses/${rel}${bust}`);
}

/** A soldier's rig, in each base, in order. */
export function rigUrls(modelsBase, soldier, bust = '') {
  return poseUrls(modelsBase, `rigs/${soldier}.rig.glb`, bust);
}

/** A template's own model (`<file>`, as the catalogue spells it), in each
 *  base, in order. A mod's model tree holds what the mod adds or changes and
 *  nothing else is promised: a Secret Weapons round's Stationary MG42, flak
 *  gun, Willy and hand weapons are vanilla's files, and the game finds them
 *  down its archive chain as the poses do. A caller that asked the mod's tree
 *  alone drew no hull at all for every one of them (a 404 under
 *  `models/mods/xpack2/`: the gunner of an emplacement vanished with it). */
export function modelUrls(modelsBase, file, bust = '') {
  return poseBases(modelsBase).map(base => `${base}/${file}${bust}`);
}

/** A weapon's own model, in each base, in order. Not under `poses/`: it is the
 *  standalone asset the model extractor already publishes, which is the whole
 *  point of the weapon half of a split pose. */
export function weaponUrls(modelsBase, weapon, bust = '') {
  return modelUrls(modelsBase, `${modelFileStem(weapon)}.glb`, bust);
}

// --- which tree holds a pose, and under what spelling ----------------------
//
// Each tree's `poses/index.json` (extract_pose.py `write_pose_index`) lists the
// stem of every pose it holds, split into recipes (`.pose.json`, the split
// tree) and monolithic `.pose.glb`s. Resolving a pair through it settles two
// things no URL guess can:
//
// * **Which tree.** A pair the mod tree holds as a single-file pose wins over
//   vanilla's recipe for the same pair. Asked by format first (every tree's
//   recipe, then every tree's glb), FHSW's own `GermanSoldier__K98.pose.glb`
//   lost to vanilla's `GermanSoldier__K98.pose.json`, and its German riflemen
//   were drawn in vanilla's uniform beside FHSW's own MP40 gunners.
// * **Which spelling.** The engine finds a template whatever its case
//   (ledger LOAD-7); a tree's files carry whichever spelling the extractor
//   was handed (`GermanSoldier__MP40` for a kit holding `Mp40`,
//   `FrenchSoldier__Mas36` for a level dressing `frenchsoldier`). The index
//   is keyed lowercased and hands back the file's own stem.
//
// A tree published without an index keeps the old guess for that tree: the
// recipe, then the glb, under the spelling asked for.

/** What an index document's `format` starts with. */
export const POSE_INDEX_PREFIX = 'bf1942-pose-index/';

const poseIndexes = new Map();   // base -> Promise<{ recipe, glb } | null>

const stemMap = stems => new Map((Array.isArray(stems) ? stems : [])
  .map(stem => [String(stem).toLowerCase(), String(stem)]));

/**
 * `base`'s pose index, fetched once per page: `{ recipe, glb }`, each a Map
 * from the lowercased stem to the file's own, or null for a tree without one.
 * A tree that answers 404 has none and is remembered so; a fetch that failed
 * any other way is forgotten, so the next pose asks again rather than the
 * page guessing for the rest of the session.
 */
export function poseIndex(base, bust = '') {
  if (!poseIndexes.has(base)) {
    const load = Promise.resolve()
      .then(() => fetch(`${base}/poses/index.json${bust}`))
      .then(async response => {
        if (!response.ok) {
          if (response.status !== 404) poseIndexes.delete(base);
          return null;
        }
        const doc = await response.json();
        if (!String(doc?.format || '').startsWith(POSE_INDEX_PREFIX)) return null;
        return { recipe: stemMap(doc.recipe), glb: stemMap(doc.glb) };
      })
      .catch(() => { poseIndexes.delete(base); return null; });
    poseIndexes.set(base, load);
  }
  return poseIndexes.get(base);
}

/** Drop every cached index (a test, or a page that switched trees). */
export function forgetPoseIndexes() {
  poseIndexes.clear();
}

/**
 * Where `<soldier>__<pose>` can be loaded from, best first: per tree in
 * `poseBases` order, that tree's recipe and then its glb. `{ base, stem,
 * kind }`, `kind` being `'recipe'` or `'glb'`; `stem` is the file's own
 * spelling where the tree has an index, the asked spelling where it has none.
 * A tree whose index does not hold the pair is not asked at all.
 */
export async function poseSources(modelsBase, soldier, pose, bust = '') {
  const asked = `${soldier}__${pose}`;
  const key = asked.toLowerCase();
  const sources = [];
  for (const base of poseBases(modelsBase)) {
    const index = await poseIndex(base, bust);
    if (!index) {
      sources.push({ base, stem: asked, kind: 'recipe' }, { base, stem: asked, kind: 'glb' });
      continue;
    }
    const recipe = index.recipe.get(key);
    if (recipe) sources.push({ base, stem: recipe, kind: 'recipe' });
    const glb = index.glb.get(key);
    if (glb) sources.push({ base, stem: glb, kind: 'glb' });
  }
  return sources;
}

/** The first of `urls` that `loader` loads; rejects with the last error when
 *  none does. */
export async function loadFirst(loader, urls) {
  let last = null;
  for (const url of urls) {
    try {
      return await loader.loadAsync(url);
    } catch (error) {
      last = error;
    }
  }
  throw last ?? new Error('no pose url to load');
}

/** The first of `urls` that answers with a 2xx, or null. A mod's tree holds
 *  only what the mod adds, so the second url is vanilla's copy of the same
 *  file. */
export async function fetchFirst(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Next tree.
    }
  }
  return null;
}
