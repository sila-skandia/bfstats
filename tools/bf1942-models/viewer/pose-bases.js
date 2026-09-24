// Where a soldier's pose glbs and gait bundles are: the active mod's own
// model tree first, then vanilla's.
//
// A mod's extraction writes only what the mod adds -- Road to Rome's
// `ItalianSoldier__Breda.pose.glb`, Secret Weapons' `Gewehr43_zf4` grip --
// while the soldiers and weapons it inherits are vanilla's files, exactly as
// the game's own archive chain falls back to `bf1942`. A figure looked up in
// the mod tree alone was never drawn: on Anzio every American bot, on
// Telemark every bot, had no body at all. The kit parts already fall back the
// same way (`soldier-dress.js`, `bases`).

/** The model roots to try, in order: `modelsBase` (the active mod's,
 *  `models/mods/xpack1`, or vanilla's own `models`), then vanilla's. */
export function poseBases(modelsBase) {
  return [...new Set([modelsBase || 'models', 'models'])];
}

/** `rel` (a path under `poses/`) in each base, in order. */
export function poseUrls(modelsBase, rel, bust = '') {
  return poseBases(modelsBase).map(base => `${base}/poses/${rel}${bust}`);
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
