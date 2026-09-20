// A team's nation is a property of the LEVEL, not of the soldier skin
// painted on the men who hold it: the flag its own control points fly.
// `extract_menu_layout.py`'s `flag_mesh_nation` / `team_nation_from_level`
// run the identical rule in Python, reading the identical `hud.json` this
// page fetches into `nations` (`extract_hud_pack.py`'s `flag_mesh_nations`),
// so the Instant Battle screen and this page can never draw two different
// flags for the same level. See `features/authentic-spawn-map/README.md`
// section 11.
//
// Free of `three` and of every other module-level state in `map.html` on
// purpose, so `tests/nation_harness.mjs` can drive it under node the same
// way `hud-pack.js` is driven.

const FLAG_MESH_RE = /^flag([a-z]+)_/i;

/** `flagus_m1` -> `us` through `nations` (`hud.json`'s own `flagMeshNation`).
 *  `null` for a mesh the table has never heard of -- Pathet Lao's
 *  `flagpl_m1`, which no installed `menu.rfa` ships a `conp_pl` for. */
export function flagMeshNation(flagMesh, nations) {
  const m = FLAG_MESH_RE.exec(flagMesh || '');
  return (m && nations[m[1].toLowerCase()]) || null;
}

/** A control point's own nation.
 *
 * A flagless capture zone (Kasserine's five: no `AnimatedFlag` child at
 * all, so no mesh name to read) keeps the level's founding pair -- team 1
 * German, team 2 American, true of every vanilla level with one. A flag
 * mesh that IS there but names a nation this pack has no art for -- Pathet
 * Lao's `flagpl_m1`, absent from every installed `menu.rfa` -- must NOT
 * fall through to that same guess (EoD's own `ger` slot is the North
 * Vietnamese flag, so the guess drew an NVA flag over a Pathet Lao base).
 * It answers `'unknown'` instead: distinct from the founding guess and
 * from a resolved code, so a caller can tell "nothing to read" apart from
 * "read something this pack cannot draw" and paint neither a wrong flag
 * nor throw. */
export function cpNation(cp, nations) {
  if (!cp.flagMesh) return cp.team === 1 ? 'ger' : cp.team === 2 ? 'us' : null;
  return flagMeshNation(cp.flagMesh, nations) || 'unknown';
}

/** The nation a whole side flies on this level: the flag most of its
 *  control points hoist. Wake's Axis are Japanese, Kharkov's Allies Soviet.
 *
 *  `vehicleNation` is the caller's own vehicle-based guess for the levels
 *  where a side holds no control point at the start and arrives by sea or
 *  air (Wake's Japanese) -- kept as a plain argument rather than computed
 *  in here so this module never has to read a `three` scene graph.
 *
 *  `'unknown'` is an ANSWER, not a fallback: it wins only when the side's
 *  own flags say it (Pathet Lao's `flagpl_m1`, a mesh this pack has no art
 *  for) -- that is what stops an NVA flag being drawn over a Pathet Lao
 *  base. A side with no flag evidence at all is a different case and keeps
 *  the founding pair, as `cpNation`'s flagless branch does: the Americans
 *  hold no flag at the start of Omaha Beach, Iwo Jima, Coral Sea, Midway or
 *  Truk, the Germans none on Kasserine Pass (its zones are flagless), and
 *  `vehicleNation` only ever names jp, rus or brit -- so without this the
 *  US and German ticket flags vanish from six vanilla levels. */
export function teamNation(controlPoints, team, nations, vehicleNation) {
  const tally = new Map();
  for (const cp of controlPoints || []) {
    if (cp.team !== team || !cp.flagMesh) continue;
    const n = cpNation(cp, nations);
    if (n) tally.set(n, (tally.get(n) || 0) + 1);
  }
  let best = null;
  for (const [n, count] of tally) if (!best || count > tally.get(best)) best = n;
  return best || vehicleNation || (team === 1 ? 'ger' : team === 2 ? 'us' : 'unknown');
}
