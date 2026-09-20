/* Which interface pack a page draws with, and where each file of it lives.
 *
 * The game's chrome -- the spawn screen, the HUD bars, the control-point
 * flags, the bitmap fonts, the label strings -- is per-mod data, and a mod
 * ships only the parts it changes. `extract_hud_mods.py` writes that
 * difference and nothing else into the mod's own level tree:
 *
 *     maps/_shared/hud/                 vanilla, the complete pack
 *     maps/mods/eod/_shared/hud/        Eve of Destruction's 581 files
 *     maps/mods/xpack1/_shared/hud/     Road to Rome's 40
 *
 * beside a `pack.json` that names them. So the rule here is one line: a
 * pack-relative path the mod's `pack.json` lists resolves against the mod's
 * directory, and anything else resolves against vanilla's. Road to Rome
 * overrides no sprite at all -- it only adds France and Italy -- so its pack
 * costs eight flag PNGs, not a second copy of 260.
 *
 * Three things this has to survive, the same three `mods.js` does:
 *
 * 1. Vanilla. No mod directory is consulted and no extra request is made.
 * 2. A mod with no pack -- nothing of its own to say, or a tree uploaded
 *    before this existed. The `pack.json` fetch fails and every path falls
 *    back to vanilla's, which is exactly the behaviour this replaced.
 * 3. A mod pack that lists a file the page never asks for, or omits one it
 *    does. Neither is special: `url()` answers for any path either way.
 *
 * The console font is the one asymmetry. Vanilla's lives at `fonts/bf1942`,
 * outside the pack, because that half of the viewer tree is baked into the
 * image while `maps/` is a mounted volume; a mod's has to travel with the
 * mod, so it goes in the pack under `console/`. `consoleFont()` hides it.
 *
 * `root` is what a page one directory down prefixes -- `map.html` is at the
 * viewer root and passes nothing, `play/index.html` passes `'../'`.
 */

export const VANILLA_HUD_DIR = 'maps/_shared/hud';
export const VANILLA_CONSOLE_FONT = 'fonts/bf1942';

/** The pack directory for a mod id, or null for vanilla. */
export function modHudBase(modId, root = '') {
  return !modId || modId === 'bf1942'
    ? null : `${root}maps/mods/${modId}/_shared/hud`;
}

function clean(rel) {
  return String(rel || '').replace(/^\.?\//, '');
}

/** The resolver. `manifest` is a mod's `pack.json`, or null. */
export function hudPaths(modId, manifest = null, { root = '' } = {}) {
  const modBase = modHudBase(modId, root);
  const vanillaBase = `${root}${VANILLA_HUD_DIR}`;
  const vanillaConsole = `${root}${VANILLA_CONSOLE_FONT}`;
  const own = new Set(modBase && Array.isArray(manifest?.files)
    ? manifest.files.map(clean) : []);
  const resolve = rel => (own.has(clean(rel))
    ? `${modBase}/${clean(rel)}`
    : `${vanillaBase}/${clean(rel)}`);
  return {
    mod: modId || 'bf1942',
    vanillaBase,
    modBase,
    /** How many files this mod carries of its own. Nothing depends on it;
     *  it is what a console line or a test asserts against. */
    ownCount: own.size,
    /** Whether this path is one the mod overrides. */
    owns: rel => own.has(clean(rel)),
    /** Where to fetch a pack-relative path from. */
    url: resolve,
    /** The same, for a path inside the Instant Battle screen's own subtree
     *  (`menu-layout.json`, `textures/*`, `thumbnails/*`, `fonts/*`). */
    menuUrl: rel => resolve(`menu/${clean(rel)}`),
    /** The console face, without its extension -- `loadConsoleFont` appends
     *  `.json` and `.png` itself. */
    consoleFont: () => (own.has('console/bf1942.json')
      ? `${modBase}/console/bf1942`
      : vanillaConsole),
  };
}

/** Fetch a mod's `pack.json` and build the resolver.
 *
 * Never rejects: a mod with no pack, a 404, a tree that predates this, a
 * body that is not JSON -- all of them mean "this mod adds nothing", which
 * resolves every path to vanilla's pack.
 */
export async function loadHudPaths(modId, opts = {}) {
  const { bust = () => '', fetcher = null, root = '' } = opts;
  const base = modHudBase(modId, root);
  if (!base) return hudPaths(modId, null, { root });
  const get = fetcher || ((url) => fetch(url));
  try {
    const response = await get(`${base}/pack.json${bust()}`);
    if (!response.ok) throw new Error(String(response.status));
    return hudPaths(modId, await response.json(), { root });
  } catch {
    return hudPaths(modId, null, { root });
  }
}
