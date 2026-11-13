// A level's `templateWords` (`scene_layers.py` `template_words`) laid under
// the nodes of a tree baked before the exporter read those words.
//
// The table is keyed by lower-case template name and holds, in the glb's own
// spelling, the Secret Weapons rocket and submarine words of the templates
// that write one: an Engine's heat (`physics.heatIncrement` ..., ledger
// PHY-45), a PlayerControlObject's `vehicleCameraShake` (CS-16),
// `disableSpawnPointsOnEnter` (SPAWN-39) and `subPos` (SUB-6), a FireArms'
// `destroyVehicleWhenNoAmmo` and `disableWhenFired` (FA-28, FA-30) and
// `projectile.vehicle` (FA-29). A glb baked since 2026-11-13 says each on its
// own node, and what a node says itself always wins: the table only fills
// what is missing.
//
// It is applied twice at a level's load (`level-load.js`): to the scene
// before the round pool is sized (the pool parks a vehicle for every
// launcher whose round is one, `level-statics.js` `roundSpawnEntries`), and
// to the nodes the pool added, which come from the models tree and may be as
// old as the scene.
//
// No imports.

/** The table's row for `node`, or null. GLTFLoader suffixes a repeated name
 *  (`Wasserfall_1`) and some templates end in `_<digits>` of their own, so
 *  both spellings are asked (`gun-groups.js` `namedFireOnce`'s rule). */
export function templateWordsOf(node, table) {
  if (!table || !node) return null;
  const name = String(node.userData?.name ?? node.name ?? '').toLowerCase();
  const row = name ? table[name] ?? table[name.replace(/_\d+$/, '')] ?? null : null;
  if (row) return row;
  // A PlayerControlObject says its own template in `control`, whatever the
  // node is called: the room server names a model's root by its file
  // (`server/glb-tree.mjs`), and a level names a placed hull by its spawner.
  const data = node.userData;
  if (data?.templateKind === 'PlayerControlObject' && data.control) {
    return table[String(data.control).toLowerCase()] ?? null;
  }
  return null;
}

/** `under` filled into `over` (a node's own block): keys the node lacks, one
 *  level into `projectile`. Returns `over`, or a new block when it had none. */
function fill(over, under) {
  const out = over && typeof over === 'object' ? over : {};
  for (const [key, value] of Object.entries(under)) {
    if (key === 'projectile' && value && typeof value === 'object') {
      // A projectile the node names by a bare string (a stale glb) is left.
      if (out.projectile && typeof out.projectile === 'object') {
        for (const [k, v] of Object.entries(value)) out.projectile[k] ??= v;
      }
    } else {
      out[key] ??= value;
    }
  }
  return out;
}

/**
 * Lay `table` under every node of `root` (or of each root in a list).
 * Returns how many nodes took a word. A missing table is no work at all.
 */
export function applyTemplateWords(root, table) {
  if (!table || !root || !Object.keys(table).length) return 0;
  let touched = 0;
  const visit = node => {
    const row = templateWordsOf(node, table);
    if (!row) return;
    const data = node.userData ??= {};
    if (row.physics) data.physics = fill(data.physics, row.physics);
    // Only a FireArms node carries a `fireArms` block; one that has none is
    // not a gun this page collects.
    if (row.fireArms && data.fireArms) fill(data.fireArms, row.fireArms);
    touched++;
  };
  for (const r of Array.isArray(root) ? root : [root]) r?.traverse?.(visit);
  return touched;
}
