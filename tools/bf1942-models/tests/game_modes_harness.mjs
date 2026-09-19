// Drives `viewer/game-modes.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_game_modes_js.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. The module imports nothing.

import { MODE_KEYS, gameTypes, isUnknownMode, modeNames, nodeInMode,
         pruneToMode, resolveMode, selectGameMode,
         spawnerWindow } from './game-modes.js';

const results = {};
results.modeKeys = MODE_KEYS;

// Wake, as `extract_map.py` writes it: four layers, three game types, and a
// `Tdm/` directory no GameTypes script runs.
const wake = {
  level: 'Wake',
  worldSize: 2048,
  gameplayMode: 'Conquest',
  terrain: { tiles: 16 },
  controlPoints: [{ name: 'The_beach', team: 2 }],
  soldierSpawns: [{ group: 1 }, { group: 2 }],
  objectSpawns: [{ vehicle: 'Willy' }],
  vehicleSoldierSpawns: [{ vehicle: 'shokaku' }],
  tickets: { mode: 'Conquest', team1: 100, team2: 100 },
  combatArea: null,
  gameTypes: {
    Conquest: { mode: 'Conquest' },
    CoOp: { mode: 'SinglePlayer' },
    Ctf: { mode: 'Ctf' },
  },
  modes: {
    Conquest: {
      gameTypes: ['Conquest'],
      controlPoints: [{ name: 'The_beach', team: 2 }],
      soldierSpawns: [{ group: 1 }, { group: 2 }],
      objectSpawns: [{ vehicle: 'Willy' }],
      vehicleSoldierSpawns: [{ vehicle: 'shokaku' }],
      tickets: { mode: 'Conquest', team1: 100, team2: 100 },
      combatArea: null,
    },
    Ctf: {
      gameTypes: ['Ctf'],
      controlPoints: [{ name: 'ALLIES_BASE', team: 0 }],
      soldierSpawns: [{ group: 3 }],
      objectSpawns: [],
      vehicleSoldierSpawns: [],
      tickets: null,
      combatArea: null,
    },
    Tdm: {
      gameTypes: [],
      controlPoints: [{ name: 'The_beach', team: 1 }],
      soldierSpawns: [{ group: 1 }, { group: 2 }],
      objectSpawns: [{ vehicle: 'Willy' }],
      vehicleSoldierSpawns: [{ vehicle: 'shokaku' }],
      tickets: null,
      combatArea: null,
    },
    SinglePlayer: {
      gameTypes: ['CoOp'],
      controlPoints: [{ name: 'The_Beach', team: 2 }],
      soldierSpawns: [{ group: 1 }, { group: 2 }, { group: 3 }],
      objectSpawns: [{ vehicle: 'chi-ha' }],
      vehicleSoldierSpawns: [{ vehicle: 'shokaku' }],
      tickets: { mode: 'CoOp', team1: 140, team2: 100 },
      combatArea: null,
    },
  },
};

// A report from before modes existed. Every key the page reads, no `modes`.
const legacy = {
  level: 'Aberdeen',
  gameplayMode: 'Conquest',
  controlPoints: [{ name: 'a' }, { name: 'b' }],
  soldierSpawns: [{ group: 1 }],
  objectSpawns: [{ vehicle: 'Willy' }],
  vehicleSoldierSpawns: [],
  tickets: { mode: 'Conquest', team1: 100 },
};

results.names = {
  wake: modeNames(wake),
  legacy: modeNames(legacy),
  empty: modeNames({}),
  nullExtras: modeNames(null),
  // `modes` written as something other than a map of layers.
  arrayModes: modeNames({ modes: ['Conquest'] }),
  emptyModes: modeNames({ modes: {} }),
  // A default the map does not carry: the keys stand on their own.
  strayDefault: modeNames({ gameplayMode: 'Nope', modes: { Ctf: {}, Tdm: {} } }),
};

results.gameTypes = {
  wake: gameTypes(wake),
  legacy: gameTypes(legacy),
  // A game type with no `mode` falls back to its own name.
  bare: gameTypes({ gameTypes: { Conquest: {} } }),
};

results.resolve = {
  none: resolveMode(wake, ''),
  nullWanted: resolveMode(wake, null),
  exact: resolveMode(wake, 'SinglePlayer'),
  lowered: resolveMode(wake, 'singleplayer'),
  padded: resolveMode(wake, '  Tdm '),
  // `CoOp` is a game type, not a directory: it loads the SinglePlayer layer.
  byGameType: resolveMode(wake, 'coop'),
  unknown: resolveMode(wake, 'ObjectiveMode'),
  legacy: resolveMode(legacy, 'Ctf'),
};

results.unknown = {
  known: isUnknownMode(wake, 'Tdm'),
  gameType: isUnknownMode(wake, 'CoOp'),
  unknown: isUnknownMode(wake, 'ObjectiveMode'),
  empty: isUnknownMode(wake, ''),
  legacy: isUnknownMode(legacy, 'Ctf'),
};

const defaulted = selectGameMode(wake, '');
const single = selectGameMode(wake, 'SinglePlayer');
const ctf = selectGameMode(wake, 'Ctf');
results.select = {
  // With no ?mode= the page sees exactly the top-level arrays it always saw.
  defaultMatchesTopLevel: MODE_KEYS.every(
    key => JSON.stringify(defaulted[key]) === JSON.stringify(wake[key])),
  defaultMode: defaulted.gameplayMode,
  singleMode: single.gameplayMode,
  singleControlPoints: single.controlPoints,
  singleSpawnCount: single.soldierSpawns.length,
  singleVehicles: single.objectSpawns.map(s => s.vehicle),
  singleTickets: single.tickets,
  ctfTickets: ctf.tickets,
  ctfVehicles: ctf.objectSpawns,
  // Everything outside the allowlist survives untouched.
  keepsLevel: single.level,
  keepsWorldSize: single.worldSize,
  keepsTerrain: single.terrain,
  keepsModes: Object.keys(single.modes),
  keepsGameTypes: Object.keys(single.gameTypes),
  // The source report is not mutated.
  sourceUntouched: JSON.stringify(wake.controlPoints) ===
    JSON.stringify([{ name: 'The_beach', team: 2 }]),
  // An old report comes back as itself.
  legacyIdentity: selectGameMode(legacy, 'Ctf') === legacy,
  nullIdentity: selectGameMode(null, 'Ctf'),
};

// A mode entry that omits a key leaves the top-level value alone: a level
// whose CTF layer declares no combat area must keep the level's own.
const partial = {
  gameplayMode: 'Conquest',
  combatArea: { min: [0, 0, 0], max: [512, 0, -512] },
  controlPoints: [{ name: 'a' }],
  modes: { Conquest: { controlPoints: [{ name: 'a' }] },
           Ctf: { controlPoints: [] } },
};
results.partial = {
  combatAreaKept: selectGameMode(partial, 'Ctf').combatArea,
  controlPointsReplaced: selectGameMode(partial, 'Ctf').controlPoints,
};

// --- the scene-graph prune ---------------------------------------------------
//
// A stand-in for three's Object3D: `traverse`, `remove`, `parent`, `userData`.
// The module touches nothing else, which is why it needs no `three` import.
function node(name, userData = {}, children = []) {
  const self = {
    name,
    userData,
    children,
    parent: null,
    remove(child) {
      const at = self.children.indexOf(child);
      if (at >= 0) {
        self.children.splice(at, 1);
        child.parent = null;
      }
    },
    traverse(fn) {
      fn(self);
      for (const child of [...self.children]) child.traverse(fn);
    },
  };
  for (const child of children) child.parent = self;
  return self;
}

function names(root) {
  const out = [];
  root.traverse(n => { if (n !== root) out.push(n.name); });
  return out.sort();
}

function scene() {
  return node('root', {}, [
    node('terrain', { kind: 'terrain' }),
    node('spawners', { kind: 'spawners' }, [
      node('willy', { modes: ['Conquest', 'Tdm'] }),
      node('chi-ha', { modes: ['SinglePlayer'] }),
      node('sherman', { modes: ['Conquest', 'Ctf', 'Tdm', 'SinglePlayer'] }),
    ]),
    node('controlPoints', { kind: 'controlPoints' }, [
      node('The_beach.t2', { modes: ['Conquest', 'SinglePlayer'] }, [
        node('flagAnchor', { modes: ['Conquest', 'SinglePlayer'] }),
      ]),
      node('The_beach.t1', { modes: ['Tdm'] }),
    ]),
    // The cloth is a sibling of the pole at the scene root, so it carries the
    // tag itself or it would fly over nothing.
    node('flagCloth.t2', { modes: ['Conquest', 'SinglePlayer'] }),
    node('flagCloth.t1', { modes: ['Tdm'] }),
  ]);
}

const conquest = scene();
const removedConquest = pruneToMode(conquest, 'Conquest');
const tdm = scene();
const removedTdm = pruneToMode(tdm, 'Tdm');
const untagged = scene();
const removedNoMode = pruneToMode(untagged, '');
// Every node untagged: a glb built before modes existed.
const oldGlb = node('root', {}, [node('a', {}), node('b', {})]);
results.prune = {
  conquest: { removed: removedConquest, kept: names(conquest) },
  tdm: { removed: removedTdm, kept: names(tdm) },
  noMode: { removed: removedNoMode, kept: names(untagged).length },
  oldGlb: { removed: pruneToMode(oldGlb, 'Conquest'), kept: names(oldGlb) },
  nullRoot: pruneToMode(null, 'Conquest'),
  caseInsensitive: (() => {
    const s = scene();
    return { removed: pruneToMode(s, 'conquest'), kept: names(s) };
  })(),
};

results.nodeInMode = {
  untagged: nodeInMode(node('x', {}), 'Ctf'),
  tagged: nodeInMode(node('x', { modes: ['Ctf'] }), 'Ctf'),
  other: nodeInMode(node('x', { modes: ['Ctf'] }), 'Tdm'),
  notAnArray: nodeInMode(node('x', { modes: 'Ctf' }), 'Tdm'),
  noNode: nodeInMode(null, 'Ctf'),
};

results.spawnerWindow = {
  plain: spawnerWindow({ minSpawnDelay: 30, maxSpawnDelay: 40 }, 'Conquest'),
  byMode: spawnerWindow({
    name: 'x', minSpawnDelay: 40, maxSpawnDelay: 80,
    byMode: {
      Conquest: { minSpawnDelay: 40, maxSpawnDelay: 80 },
      Tdm: { minSpawnDelay: 70, maxSpawnDelay: 110 },
    },
  }, 'Tdm'),
  byModeMissing: spawnerWindow({
    minSpawnDelay: 40, maxSpawnDelay: 80,
    byMode: { Conquest: { minSpawnDelay: 40, maxSpawnDelay: 80 } },
  }, 'Ctf'),
  // A mode that parks the pad with no window at all.
  byModeNull: spawnerWindow({
    minSpawnDelay: 40, maxSpawnDelay: 80, byMode: { Tdm: null },
  }, 'Tdm'),
  nothing: spawnerWindow(null, 'Conquest'),
};

process.stdout.write(JSON.stringify(results));
