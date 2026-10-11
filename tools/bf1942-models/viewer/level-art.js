// The picture a level shows while it loads (and on a replay's feed card), and
// what to show when that picture is not there.
//
// A mod's `maps.json` row names its loading picture in `loading.background`,
// a path inside the mod's tree. The engine opens a level's own
// `Menu/Init.con` and the picture it names along the mod search path, so a
// level a mod inherits from vanilla shows vanilla's picture. The extractor
// (`extract_loading_assets.py`) records exactly that, but a tree can still be
// short of it: a re-bake replaces a level's directory and its `load.webp`
// goes with it, or a tree was extracted before the row was written. A cover
// that points at a missing file is a black square, so every consumer asks
// for a chain and takes the first picture that loads:
//
//   1. the level's own row in the mod's tree,
//   2. vanilla's row for the same level, in vanilla's tree (the inherited
//      level's own picture, which is the engine's rule),
//   3. the mod's `western` theatre picture, then vanilla's.
//
// The chain is pure; `firstLoadable` does the one thing a page cannot know
// from a manifest, whether the file is there.

/** A theatre picture every tree carries (the extractor's own default row). */
export const DEFAULT_ART = '_shared/load/western.webp';

const lower = value => String(value ?? '').toLowerCase();

/** `base` + `rel`, unless `rel` already names a place (`https:`, `data:`, `blob:`). */
export function joinArt(base, rel) {
  if (!rel) return '';
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rel)) return rel;
  const root = String(base ?? '').replace(/\/+$/, '');
  const path = String(rel).replace(/^\/+/, '');
  return root ? `${root}/${path}` : path;
}

/** The `maps.json` row for `level`, matched without regard to case. */
export function rowFor(rows, level) {
  const key = lower(level);
  if (!key || !Array.isArray(rows)) return null;
  return rows.find(row => lower(row?.name) === key) ?? null;
}

/**
 * Where a level's loading picture may be, best first, as full URLs.
 *
 * @param {string} level  the level's name (`Raid_on_Agheila`, any case)
 * @param {{base: string, rows: object[]|null}[]} trees  the mod's tree then
 *        vanilla's: `base` is the tree's maps path (or URL), `rows` its parsed
 *        `maps.json` (null when it could not be read)
 * @param {(base: string, rel: string) => string} [join]  how a path joins a
 *        base; the page's feed resolves against its own root URL
 */
export function artCandidates(level, trees, join = joinArt) {
  const out = [];
  const add = url => { if (url && !out.includes(url)) out.push(url); };
  for (const tree of trees) {
    const declared = rowFor(tree?.rows, level)?.loading?.background;
    if (declared) add(join(tree.base, declared));
  }
  for (const tree of trees) add(join(tree?.base, DEFAULT_ART));
  return out;
}

const verdicts = new Map();

/** Whether `url` loads as an image. Settled once per URL for the page's life. */
export function imageLoads(url, ImageCtor = globalThis.Image) {
  if (!url) return Promise.resolve(false);
  if (!verdicts.has(url)) {
    verdicts.set(url, new Promise(resolve => {
      if (typeof ImageCtor !== 'function') { resolve(true); return; }
      const img = new ImageCtor();
      // load/error fire in a hidden tab; decode() would not.
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    }));
  }
  return verdicts.get(url);
}

/** The first of `urls` that loads, or null when none does. */
export async function firstLoadable(urls, loads = imageLoads) {
  for (const url of urls) {
    if (await loads(url)) return url;
  }
  return null;
}

/**
 * Whether RGBA pixels (a `getImageData().data`) are a black frame: nothing
 * brighter than a few levels anywhere. A cover set from a frame the page had
 * not drawn yet (the uploader pressed F on a cleared canvas) is a black
 * square as surely as a 404 is, and a card shows the level's picture instead.
 */
export function isBlankFrame(data, { ceiling = 12 } = {}) {
  if (!data || data.length < 4) return false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 8 && (data[i] > ceiling || data[i + 1] > ceiling || data[i + 2] > ceiling)) return false;
  }
  return true;
}

/** Forget what was learned about files (a test; a tree republished mid-page). */
export function forgetVerdicts() {
  verdicts.clear();
}
