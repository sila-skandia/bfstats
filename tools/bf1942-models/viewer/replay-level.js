// The level a recording was made on, when it does not say (features/round-
// replay-ux, "A recording that names no level"). The recorder names the level
// only through the join's own SetLevel event, and a file begun after the join
// -- recording switched on mid-round, as replay_20260927-190946 was, 20 s into
// a Tobruk round -- has none (bf42plus writes it into such a file since
// ea600c1). What every recording has is the level's flags: the recorder
// writes each control point on first sight (`cp`), its template and where it
// stands, and those are the level's own ControlPoints entries, which every
// extracted level carries in its scene.json (`controlPoints`, and each game
// type's under `modes`). A level whose flags stand where the recording's do,
// under the same template names, is the level.

/** Metres a recorded flag may stand from the level's own and still be it:
 *  the recorder writes positions to the centimetre, and a level's flags stand
 *  tens of metres apart at the least. */
const SAME_SPOT = 1;

/** Scene files read in one search at most. Vanilla is 23 levels and the packs
 *  add 6 and 9 of their own (their copies of vanilla's are read once); a tree
 *  the size of Eve of Destruction's (239) is left to the level list. */
const MOST_SCENES = 72;

/** The vanilla game and its two packs, which share vanilla's levels: a pack's
 *  copy of Tobruk is Tobruk. */
const VANILLA_FAMILY = new Set(['bf1942', 'xpack1', 'xpack2']);

/** The recording's flags, `{ tmpl, x, z }` in BF1942's frame, where its `cp`
 *  records place them. */
export function flagPrints(rec) {
  const out = [];
  for (const point of rec.controlPoints?.values() ?? []) {
    const [x, , z] = point.pos ?? [];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    out.push({ tmpl: String(point.tmpl || '').toLowerCase(), x, z });
  }
  return out;
}

/** A level's flags from its scene.json, every game type's, in BF1942's frame
 *  (scene.json negates z, as the viewer draws). */
export function levelFlags(scene) {
  const out = [];
  const add = points => {
    for (const point of points ?? []) {
      const [x, , z] = point?.position ?? [];
      if (Number.isFinite(x) && Number.isFinite(z)) out.push({ tmpl: String(point.name || '').toLowerCase(), x, z: -z });
    }
  };
  add(scene?.controlPoints);
  for (const mode of Object.values(scene?.modes ?? {})) add(mode?.controlPoints);
  return out;
}

/** How many of `prints` stand on one of `flags`: the same template (where
 *  the recording names one) within SAME_SPOT metres. */
export function flagsMatched(prints, flags) {
  let matched = 0;
  for (const p of prints) {
    if (flags.some(f => (!p.tmpl || f.tmpl === p.tmpl)
        && Math.abs(f.x - p.x) <= SAME_SPOT && Math.abs(f.z - p.z) <= SAME_SPOT)) matched += 1;
  }
  return matched;
}

/** `fn` over `items`, `width` at a time, until `stop()` says enough. */
async function inTurn(items, width, fn, stop) {
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) {
      const item = items[next++];
      out.push(await fn(item));
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}

/**
 * The level among `trees` whose flags are the recording's: `{ mod, entry,
 * matched, of }`, or null. `trees` is `[{ mod, levels }]` in the order to
 * look (`levels` a maps.json), and `readScene(mod, entry)` resolves that
 * level's scene.json, or null. A level that has every recorded flag is the
 * one, and the trees after it are not read; failing that, the level with the
 * most, if it has three in four and no other has as many. A level too small
 * to hold the flags is not read, nor is a pack's copy of a level already read.
 */
export async function recogniseLevel(rec, trees, readScene, { most = MOST_SCENES } = {}) {
  const prints = flagPrints(rec);
  if (!prints.length) return null;
  const reach = Math.max(...prints.map(p => Math.max(p.x, p.z)));
  const read = new Set();
  let budget = most;
  const scored = [];
  for (const { mod, levels } of trees) {
    const family = VANILLA_FAMILY.has(String(mod?.id).toLowerCase()) ? 'bf1942' : String(mod?.id);
    const candidates = (levels ?? []).filter(entry => {
      const key = `${family}/${String(entry?.name ?? '').toLowerCase()}`;
      return entry?.name && !read.has(key) && !(entry.worldSize > 0 && reach > entry.worldSize + SAME_SPOT);
    });
    if (!candidates.length || candidates.length > budget) continue;
    budget -= candidates.length;
    for (const entry of candidates) read.add(`${family}/${entry.name.toLowerCase()}`);
    let whole = null;
    const results = await inTurn(candidates, 6, async entry => {
      const scene = await Promise.resolve().then(() => readScene(mod, entry)).catch(() => null);
      const result = { mod, entry, matched: scene ? flagsMatched(prints, levelFlags(scene)) : 0 };
      if (result.matched === prints.length) whole ??= result;
      return result;
    }, () => whole !== null);
    if (whole) return { ...whole, of: prints.length };
    scored.push(...results);
  }
  const ranked = scored.sort((a, b) => b.matched - a.matched);
  const [best, next] = ranked;
  if (!best || best.matched < Math.max(2, Math.ceil(prints.length * 0.75))) return null;
  if (next && next.matched === best.matched) return null;
  return { ...best, of: prints.length };
}
