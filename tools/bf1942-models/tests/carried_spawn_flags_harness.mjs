// `viewer/spawn-flags.js` on spawn points an object carries: one flag per set
// of carriers sharing a spawn group, one ring per group at the average of its
// points, labelled by the points' own name (ledger SPAWNGRP-10).
//
// Argv: `<name> <scene.json>` pairs for the extracted levels to read (Desert
// Combat's No Fly Zone Day 2 and Operation Bragg, vanilla's Wake); a synthetic
// level always runs. Run by `tests/test_carried_spawn_flags.py`; prints one
// JSON object.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const { spawnFlags } = await import(path.join(viewer, 'spawn-flags.js'));
const { flagMapSpots } = await import(path.join(viewer, 'deploy-spots.js'));

const round = v => (Array.isArray(v) ? v.map(x => +x.toFixed(3)) : v);
const describe = flags => flags.filter(f => f.vehicle).map(f => ({
  name: f.name,
  team: f.team,
  groups: f.groups.map(g => g.group),
  rings: flagMapSpots(f).map(s => ({ group: s.group, position: round(s.position) })),
  spawns: f.spawns.length,
  carriers: [...new Set(f.spawns.map(s => s.vehicle))],
}));
const average = points => {
  const at = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) at[i] += p.position[i];
  return round(at.map(v => v / points.length));
};

const out = { levels: {} };
const argv = process.argv.slice(2);
for (let i = 0; i + 2 <= argv.length; i += 2) {
  const extras = JSON.parse(readFileSync(argv[i + 1], 'utf8'));
  const carried = extras.vehicleSoldierSpawns || [];
  const byGroup = {};
  for (const p of carried) (byGroup[p.group] ??= []).push(p);
  out.levels[argv[i]] = {
    flags: describe(spawnFlags(extras)),
    averages: Object.fromEntries(Object.entries(byGroup).map(([g, pts]) => [g, average(pts)])),
    names: spawnFlags(extras).map(f => f.name),
  };
}

// Synthetic: two buildings share group 99, a third carries 98 of its own, a
// ship two deck groups. A hull under way moves its points' arrays in place;
// the ring and the flag's position follow.
{
  const pt = (vehicle, pad, group, team, name, position) =>
    ({ vehicle, spawner: `${vehicle}spawner`, pad, group, team, name, position, rotation: [0, 0, 0] });
  const extras = {
    controlPoints: [], soldierSpawns: [],
    vehicleSoldierSpawns: [
      pt('air_hangar', 1, 99, 1, 'airbase_soldierspawn', [0, 0, 0]),
      pt('air_hangar', 1, 99, 1, 'airbase_soldierspawn', [10, 0, 0]),
      pt('air_tower', 2, 99, 1, 'airbase_soldierspawn', [20, 0, 30]),
      pt('air_dome', 3, 98, 2, 'dome_soldierspawn', [500, 0, 500]),
      pt('carrier', 4, 75, 1, 'carrierdriversoldierspawn', [1000, 20, 0]),
      pt('carrier', 4, 76, 1, 'carrieraircraftsoldierspawn', [1000, 20, 100]),
      pt('carrier', 4, 76, 1, 'carrieraircraftsoldierspawn', [1000, 20, 120]),
    ],
  };
  const flags = spawnFlags(extras);
  const ship = flags.find(f => f.groups.some(g => g.group === 75));
  const before = round(ship.groups[1].position);
  for (const p of extras.vehicleSoldierSpawns) if (p.vehicle === 'carrier') p.position[0] += 50;
  out.synthetic = {
    flags: describe(flags),
    shipRingBefore: before,
    shipRingAfter: round(ship.groups[1].position),
    shipPositionAfter: round(ship.position),
  };
}

process.stdout.write(JSON.stringify(out));
