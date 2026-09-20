// `?mode=` — which of a level's gameplay layers the page plays.
//
// A BF1942 level archive ships one directory per game mode it supports
// (`Conquest/`, `SinglePlayer/`, `Ctf/`, `Tdm/`, `ObjectiveMode/`) and the
// terrain, the statics and the lightmaps are the same in all of them. Only the
// gameplay layer differs: which flags exist, who starts holding them, where
// the soldier spawns are and which side each group lists under, which vehicles
// are parked where, and the tickets. `extract_map.py` writes one entry per
// layer under `scene.json.modes` and keeps the default layer duplicated at the
// top level, where it has always been.
//
// Two rules make the change invisible to everything that does not ask for it:
//
//   * A `scene.json` with no `modes` key is returned untouched. That is every
//     report written before this existed.
//   * With `modes` present and no `?mode=`, the default layer is selected —
//     and the default layer's arrays are byte-identical to the top-level ones,
//     so the page renders exactly what it rendered before.
//
// The scene glb holds the union of every layer's vehicles and flags, each node
// tagged `extras.modes`. `pruneToMode` detaches the ones the active mode does
// not use. A node with no `modes` tag belongs to every mode, which is how a
// glb built before this reads — again, nothing changes for old data.
//
// This module imports nothing, so `tests/game_modes_harness.mjs` runs the same
// bytes the page loads.

/** The gameplay keys a mode entry overrides. Deliberately an allowlist: a
 *  mode entry is authored data and must never be able to replace `terrain`,
 *  `objects`, `sounds` or anything else describing the scene itself. */
export const MODE_KEYS = [
  'controlPoints',
  'soldierSpawns',
  'vehicleSoldierSpawns',
  'objectSpawns',
  'tickets',
  'combatArea',
];

function modeMap(extras) {
  const modes = extras && extras.modes;
  if (!modes || typeof modes !== 'object' || Array.isArray(modes)) return null;
  const names = Object.keys(modes);
  return names.length ? modes : null;
}

/** The layers this report offers, default first. `[]` for an old report. */
export function modeNames(extras) {
  const modes = modeMap(extras);
  if (!modes) return [];
  const names = Object.keys(modes);
  const dflt = extras.gameplayMode;
  if (dflt && names.includes(dflt)) {
    return [dflt, ...names.filter(name => name !== dflt)];
  }
  return names;
}

/** The game types the menu offers, as `{name, mode}` rows. `[]` for a report
 *  written before game types were read. */
export function gameTypes(extras) {
  const types = extras && extras.gameTypes;
  if (!types || typeof types !== 'object' || Array.isArray(types)) return [];
  return Object.keys(types).map(name => ({
    name,
    mode: (types[name] && types[name].mode) || name,
  }));
}

/** The directory a game type conventionally loads when the level ships no
 *  script for it. Only `CoOp` needs an entry: every other game type's layer
 *  is the directory of its own name, and `CoOp`'s is `SinglePlayer/` on all
 *  871 levels that offer it. One level in the 18 installed mods ships
 *  `SinglePlayer/` without a `GameTypes/CoOp.con` (DC_Final's Medina Ridge),
 *  and this is what keeps `?mode=CoOp` meaning something there. */
const CONVENTIONAL_LAYER = { coop: 'singleplayer' };

/**
 * Which layer `?mode=<wanted>` names.
 *
 * Accepts a layer name (`SinglePlayer`) or a game type (`CoOp`, which loads
 * the SinglePlayer layer on every level that offers it — no vanilla level
 * ships a `CoOp/` directory at all). Case-insensitive, because a URL typed by
 * hand will not match the archive's capitalisation.
 *
 * A game type whose `run` lines straddle two directories has a layer of its
 * own, keyed by the game type's name, and the direct match below finds it —
 * that is how `?mode=CoOp` gets Road to Rome's CoOp layout, which is
 * SinglePlayer's spawns under Conquest's flags and is no directory's.
 *
 * Returns null when there is nothing to select (an old report), and the
 * default layer when `wanted` is empty or names nothing this level has — a
 * bad `?mode=` must not leave the page with no flags.
 */
export function resolveMode(extras, wanted) {
  const names = modeNames(extras);
  if (!names.length) return null;
  const want = String(wanted == null ? '' : wanted).trim().toLowerCase();
  if (!want) return names[0];
  const direct = names.find(name => name.toLowerCase() === want);
  if (direct) return direct;
  const type = gameTypes(extras).find(t => t.name.toLowerCase() === want);
  if (type) {
    const layer = names.find(name => name.toLowerCase() === String(type.mode).toLowerCase());
    if (layer) return layer;
  }
  const conventional = CONVENTIONAL_LAYER[want];
  if (conventional) {
    const layer = names.find(name => name.toLowerCase() === conventional);
    if (layer) return layer;
  }
  return names[0];
}

/** True when `?mode=` named something this level does not have. Callers use it
 *  to say so rather than silently showing a different mode. */
export function isUnknownMode(extras, wanted) {
  const want = String(wanted == null ? '' : wanted).trim();
  if (!want || !modeNames(extras).length) return false;
  const lowered = want.toLowerCase();
  return !modeNames(extras).some(name => name.toLowerCase() === lowered)
    && !gameTypes(extras).some(t => t.name.toLowerCase() === lowered);
}

/**
 * Why `?mode=` did not get what it asked for, or `''` when it did.
 *
 *   'unknown' — neither a layer nor a game type of this level.
 *   'missing' — a game type the level's menu offers whose layer directory it
 *               does not ship. 21 levels across the installed mods advertise
 *               a game type with no directory behind it (13 Ctf, 4 Tdm, 3
 *               CoOp, 1 ObjectiveMode) and `resolveMode` quietly hands back
 *               the default; a caller that only asked `isUnknownMode` would
 *               say nothing at all, which is the one outcome the URL rule
 *               forbids.
 *
 * `''` also for a report with no `modes` (nothing was ever selectable) and
 * for an empty `?mode=`.
 */
export function modeProblem(extras, wanted) {
  const want = String(wanted == null ? '' : wanted).trim();
  const names = modeNames(extras);
  if (!want || !names.length) return '';
  const lowered = want.toLowerCase();
  if (names.some(name => name.toLowerCase() === lowered)) return '';
  const conventional = CONVENTIONAL_LAYER[lowered];
  if (conventional && names.some(name => name.toLowerCase() === conventional)) {
    return '';
  }
  const type = gameTypes(extras).find(t => t.name.toLowerCase() === lowered);
  if (!type) return 'unknown';
  return names.some(name => name.toLowerCase() === String(type.mode).toLowerCase())
    ? '' : 'missing';
}

/**
 * The report as the page should read it for one mode.
 *
 * The result is a new object; `extras` is not mutated, and `modes` and
 * `gameTypes` are carried through so the page can still list what else the
 * level has. A key the mode entry does not carry keeps the top-level value.
 */
export function selectGameMode(extras, wanted) {
  const modes = modeMap(extras);
  if (!extras || !modes) return extras;
  const name = resolveMode(extras, wanted);
  const entry = name && modes[name];
  if (!entry || typeof entry !== 'object') return extras;
  const out = { ...extras, gameplayMode: name };
  for (const key of MODE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) out[key] = entry[key];
  }
  return out;
}

/** Does a scene node belong in `mode`? An untagged node is in every mode. */
export function nodeInMode(node, mode) {
  const tag = node && node.userData && node.userData.modes;
  if (!Array.isArray(tag)) return true;
  if (!mode) return true;
  const lowered = String(mode).toLowerCase();
  return tag.some(name => String(name).toLowerCase() === lowered);
}

/**
 * Detach every node the active mode does not use, and return how many went.
 *
 * Detaching rather than hiding, because everything downstream of the load —
 * the vehicle index, the occupancy roots, the respawn timers, the culling
 * list, the minimap markers — enumerates the scene graph and would otherwise
 * be counting vehicles that are not in this mode. The level is reloaded to
 * change mode, so nothing has to come back.
 *
 * Nothing is disposed: glTF geometries and materials are shared between
 * placements, so a pruned Sherman's buffers usually belong to a kept one too.
 */
export function pruneToMode(root, mode) {
  if (!root || !mode) return 0;
  const doomed = [];
  root.traverse(node => {
    if (node === root) return;
    if (!nodeInMode(node, mode)) doomed.push(node);
  });
  let removed = 0;
  for (const node of doomed) {
    // A node whose ancestor already went is gone with it.
    if (!node.parent) continue;
    node.parent.remove(node);
    removed += 1;
  }
  return removed;
}

/**
 * The respawn window stamped on a spawner node, for this mode.
 *
 * `extras.spawner.byMode` is only written when two modes disagree about the
 * window for one pad — 2,123 pads do across the 18 installed mods, 32 of them
 * in vanilla — so the plain `min`/`max` is the answer nearly always.
 */
export function spawnerWindow(stamped, mode) {
  if (!stamped) return null;
  const table = stamped.byMode;
  if (table && mode) {
    const lowered = String(mode).toLowerCase();
    for (const key of Object.keys(table)) {
      if (key.toLowerCase() !== lowered) continue;
      const hit = table[key];
      if (!hit) return null;
      return {
        minSpawnDelay: hit.minSpawnDelay,
        maxSpawnDelay: hit.maxSpawnDelay,
      };
    }
  }
  return {
    minSpawnDelay: stamped.minSpawnDelay,
    maxSpawnDelay: stamped.maxSpawnDelay,
  };
}
