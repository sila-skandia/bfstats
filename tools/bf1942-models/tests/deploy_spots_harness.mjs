// Drives `viewer/deploy-spots.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_deploy_spots.py`
// copies the viewer module in under its own name, so the file under test is
// the file the page loads, byte for byte. The module imports nothing and
// reads no global state — every case passes its own flags, the same shapes
// `soldier.js` `spawnFlags` builds, so this is the contract between that
// join and the deploy screen that reads it.

import { activeDeployGroup, flagMapSpots } from './deploy-spots.js';

// The three `spawnFlags` flag shapes, in the page's own idiom.
const landSingle = {
  name: 'Alpha', team: 1, group: 1, groups: [1],
  position: [0, 0, 0], uncapturable: true, spawns: [{ group: 1 }],
};
const landDual = {
  name: 'Bravo', team: 0, group: 2, groups: [2, 6],
  position: [100, 0, 100], uncapturable: false, spawns: [{ group: 2 }, { group: 6 }],
};
const standalone = {
  name: 'Airfield', team: 2, group: 9, groups: [9],
  position: [50, 0, 50], uncapturable: true, standalone: true, spawns: [{ group: 9 }],
};
const ship = {
  name: 'Carrier', team: 1, group: 64, vehicle: true,
  groups: [
    { group: 64, position: [200, 5, 200] },
    { group: 65, position: [210, 5, 210] },
  ],
  position: [200, 5, 200], uncapturable: true,
  spawns: [{ group: 64 }, { group: 65 }],
};
const empty = { name: 'Nowhere', team: 0, group: 99, groups: [99], position: null, spawns: [] };
const flagless = { name: 'Ghost', team: null, spawns: [] };

const spotOf = (spot) => spot
  ? { group: spot.group, position: spot.position ? [...spot.position] : spot.position }
  : spot;

const results = {
  landSingle: flagMapSpots(landSingle).map(spotOf),
  landDual: flagMapSpots(landDual).map(spotOf),
  standalone: flagMapSpots(standalone).map(spotOf),
  ship: flagMapSpots(ship).map(spotOf),
  empty: flagMapSpots(empty).map(spotOf),
  flagless: flagMapSpots(flagless).map(spotOf),
  missing: flagMapSpots(null).map(spotOf),
  // A ship flag whose deck list somehow carries no positions still gets its
  // one ring at the hull position: a malformed deck must never take the
  // whole flag off the map.
  shipNoDeckPositions: flagMapSpots({
    name: 'Hulk', team: 1, vehicle: true, groups: [],
    position: [7, 0, 7], spawns: [],
  }).map(spotOf),
  // The regression itself, stated as shapes: the buggy reader mapped numeric
  // ids through the deck shape and produced position-less spots.
  buggyLandDual: landDual.groups.map((g) => ({ group: g.group, position: g.position })),
  // The click/selection law beside the painter: the deck spot a click chose,
  // else the ship's first group, else null on land.
  deployGroup: {
    shipDefault: activeDeployGroup(ship),
    shipChosen: activeDeployGroup(ship, 65),
    shipStale: activeDeployGroup(ship, 9),
    land: activeDeployGroup(landDual),
    landNamed: activeDeployGroup(landDual, 6),
    none: activeDeployGroup(null),
  },
};

// The ring painter's own filter, beside the spots: a spot without a position
// draws nothing. Every spot above must survive it, every buggy one must not.
const drawable = (spots) => spots.filter((spot) => spot && spot.position).length;
results.drawable = {
  landSingle: drawable(results.landSingle),
  landDual: drawable(results.landDual),
  standalone: drawable(results.standalone),
  ship: drawable(results.ship),
  buggyLandDual: drawable(results.buggyLandDual),
};

process.stdout.write(JSON.stringify(results, null, 1));
