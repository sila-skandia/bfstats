// Drives `viewer/deploy-spots.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_deploy_spots.py`
// copies the viewer module in under its own name, so the file under test is
// the file the page loads, byte for byte. The module imports nothing and
// reads no global state — every case passes its own flags, the same shapes
// `soldier.js` `spawnFlags` builds, so this is the contract between that
// join and the deploy screen that reads it.

import { activeDeployGroup, flagGroupIds, flagMapSpots, servedDraws } from './deploy-spots.js';

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
const deck = (groups, spawns) => ({
  name: 'Deck', team: 2, group: groups[0], vehicle: true,
  groups: groups.map((group, i) => ({ group, position: [i, 0, 0] })),
  position: [0, 0, 0], uncapturable: true, spawns,
});
const helmFirst = deck([72, 73, 74], [
  { group: 72, enterOnSpawn: true }, { group: 72, enterOnSpawn: true },
  { group: 73 }, { group: 74 },
]);
const deckDown = deck([72, 73, 74], [
  { group: 72, enterOnSpawn: true }, { group: 73, inactive: true }, { group: 74 },
]);
const allSeats = deck([1, 2], [{ group: 1, enterOnSpawn: true }, { group: 2, enterOnSpawn: true }]);
const allSeatsOneOn = deck([1, 2], [
  { group: 1, enterOnSpawn: true, inactive: true }, { group: 2, enterOnSpawn: true },
]);
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
  // The selection law beside the painter: the group a click chose when it
  // is one of the flag's, nothing otherwise. There is no default: retail's
  // map selects nothing until the player clicks (ledger SPAWNGRP-12).
  deployGroup: {
    shipUnclicked: activeDeployGroup(ship),
    shipChosen: activeDeployGroup(ship, 65),
    shipStale: activeDeployGroup(ship, 9),
    land: activeDeployGroup(landDual),
    landNamed: activeDeployGroup(landDual, 6),
    landOther: activeDeployGroup(landDual, 65),
    none: activeDeployGroup(null),
    // Midway's Enterprise: nothing is chosen before a click, the helm group
    // included; a click on a deck ring is his.
    helmUnclicked: activeDeployGroup(helmFirst),
    helmChosen: activeDeployGroup(helmFirst, 73),
    allSeats: activeDeployGroup(allSeats),
  },
  groupIds: {
    landSingle: flagGroupIds(landSingle),
    landDual: flagGroupIds(landDual),
    ship: flagGroupIds(ship),
    bare: flagGroupIds({ group: 4 }),
    none: flagGroupIds(flagless),
  },
};

// A group no human can spawn on is not on the screen at all: retail's map
// draws a dot, and lets a click select, only for a group whose active byte
// (the server's `getActive(false)`) is set. Midway's helm group 72 as the
// server sends it (inactive), its deck groups on; then a ship whose every
// group is down, which draws nothing rather than a hull ring.
const helmOff = deck([72, 73, 74], [
  { group: 72, enterOnSpawn: true, inactive: true }, { group: 72, enterOnSpawn: true, inactive: true },
  { group: 73 }, { group: 74 },
]);
const shipDown = deck([75, 76], [{ group: 75, inactive: true }, { group: 76, inactive: true }]);
results.offScreen = {
  helmOff: flagMapSpots(helmOff).map(spotOf).map((s) => s.group),
  shipDown: flagMapSpots(shipDown).map(spotOf),
  // One point of a group still on keeps the group drawn (the group's
  // `getActive` passes when any of its points does).
  halfOn: flagMapSpots(deck([5], [{ group: 5, inactive: true }, { group: 5 }])).map(spotOf).map((s) => s.group),
};

// The server's table on a sidecar page decides, per group, what retail's map
// draws for the player's side: the group's side is his and its active byte
// is set (SPAWNGRP-11). A table group the page does not know says nothing.
const table = (rows) => ({
  live: true,
  team: (g) => (rows[g] ? rows[g][0] : null),
  active: (g) => (rows[g] ? !!rows[g][1] : null),
});
const capturedBravo = table({ 2: [1, 0], 6: [2, 1] });
const groupsOf = (spots) => spots.map(spotOf).map((s) => s.group);
results.served = {
  // Kasserine's two-group point after an Allied capture: the holder's group
  // is the one drawn, for the holder only.
  landHeldAllied: groupsOf(flagMapSpots(landDual, { team: 2, table: capturedBravo })),
  landHeldAlliedAxis: groupsOf(flagMapSpots(landDual, { team: 1, table: capturedBravo })),
  // The page's own capture state says Axis (team 1); the table says the
  // Allies hold it: the table wins.
  landSideFromTable: groupsOf(flagMapSpots(landSingle, { team: 2, table: table({ 1: [2, 1] }) })),
  landSideFromTableAxis: groupsOf(flagMapSpots(landSingle, { team: 1, table: table({ 1: [2, 1] }) })),
  // A point being taken: its group stays the holder's and goes off.
  landOff: groupsOf(flagMapSpots(landSingle, { team: 1, table: table({ 1: [1, 0] }) })),
  // The table names none of the flag's groups: the page's own ring.
  landUnknown: groupsOf(flagMapSpots(landSingle, { team: 1, table: table({ 7: [1, 1] }) })),
  // No table yet (not live): the page's own.
  landNotLive: groupsOf(flagMapSpots(landSingle, { team: 2, table: { live: false, team: () => 2, active: () => true } })),
  // A deck: the table's word beats the page's point state either way.
  helmByTable: groupsOf(flagMapSpots(helmFirst, { team: 2, table: table({ 72: [2, 0], 73: [2, 1], 74: [2, 1] }) })),
  deckDownByPage: groupsOf(flagMapSpots(deckDown, { team: 2, table: table({ 73: [2, 1] }) })),
  deckOtherSide: groupsOf(flagMapSpots(helmFirst, { team: 2, table: table({ 72: [2, 0], 73: [1, 1], 74: [2, 1] }) })),
  draws: [
    servedDraws(capturedBravo, 6, 2), servedDraws(capturedBravo, 6, 1),
    servedDraws(capturedBravo, 2, 1), servedDraws(capturedBravo, 9, 1),
    servedDraws(null, 6, 2), servedDraws(capturedBravo, 6, 0),
  ],
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
