// A life the server already has (viewer/server-life.js): the resume decision,
// the kit template to deploy row mapping, the flag a resumed life is filed
// under, and the sidecar state's kit for a player whose pickupKit arrived
// before its kit object (net-sidecar.js `kitOf`). See
// test_server_life_resume.py.
import { deployRowForKit, nearestFlagIndex, shouldResumeServerLife } from '../viewer/server-life.js';
import { createSidecarState } from '../viewer/net-sidecar.js';

const res = {};

const alive = { alive: true, x: 10, y: 5, z: -20, team: 2, kit: 'UsMarine_AT' };
const ready = { row: alive, worldReady: true };
res.decide = {
  reload: shouldResumeServerLife(ready),
  dead: shouldResumeServerLife({ ...ready, row: { ...alive, alive: false } }),
  noRow: shouldResumeServerLife({ worldReady: true }),
  hasBody: shouldResumeServerLife({ ...ready, hasSoldier: true }),
  asked: shouldResumeServerLife({ ...ready, awaiting: true }),
  waiting: shouldResumeServerLife({ ...ready, waiting: true }),
  joined: shouldResumeServerLife({ ...ready, joined: true }),
  pilot: shouldResumeServerLife({ ...ready, pilot: true }),
  notReady: shouldResumeServerLife({ row: alive }),
  noPose: shouldResumeServerLife({ ...ready, row: { alive: true, x: NaN, z: 0 } }),
  seated: shouldResumeServerLife({ ...ready, row: { ...alive, seated: true, inVehicle: true } }),
};

// Wake's rows as `_shared/loadouts.json` has them (note the mixed case the
// level's Init.con writes: `UsMarine_AT`, `USMarine_Engineer`).
const loadouts = {
  kits: {
    USMarine_Scout: { class: 'Scout' }, UsMarine_Assault: { class: 'Assault' },
    UsMarine_AT: { class: 'Anti-tank' }, USMarine_Medic: { class: 'Medic' },
    USMarine_Engineer: { class: 'Engineer' },
    Jap_Scout: { class: 'Scout' }, Jap_Assault: { class: 'Assault' }, Jap_AT: { class: 'Anti-tank' },
    Jap_Medic: { class: 'Medic' }, Jap_Engineer: { class: 'Engineer' },
    German_Engineer: { class: 'Engineer' },
  },
  levels: {
    wake: {
      1: { soldier: 'JapaneseSoldier', slots: { 0: 'Jap_Scout', 1: 'Jap_Assault', 2: 'Jap_AT', 3: 'Jap_Medic', 4: 'Jap_Engineer' } },
      2: { soldier: 'USMarineSoldier', slots: { 0: 'USMarine_Scout', 1: 'UsMarine_Assault', 2: 'UsMarine_AT', 3: 'USMarine_Medic', 4: 'USMarine_Engineer' } },
    },
  },
};
res.kit = {
  ownAT: deployRowForKit(loadouts, 'wake', 2, 'UsMarine_AT'),
  ownCase: deployRowForKit(loadouts, 'wake', 2, 'usmarine_engineer'),
  axisScout: deployRowForKit(loadouts, 'wake', 1, 'Jap_Scout'),
  pickedUpEnemy: deployRowForKit(loadouts, 'wake', 2, 'Jap_Medic'),
  otherLevelKit: deployRowForKit(loadouts, 'wake', 2, 'German_Engineer'),
  unknown: deployRowForKit(loadouts, 'wake', 2, 'NoSuchKit'),
  none: deployRowForKit(loadouts, 'wake', 2, null),
  noFile: deployRowForKit(null, 'wake', 2, 'UsMarine_AT'),
};

const flags = [
  { name: 'Japanese base', team: 1, position: [0, 0, 0], spawns: [{ position: [0, 0, 0] }] },
  { name: 'Airfield', team: 2, position: [500, 0, 0], spawns: [{ position: [500, 0, 0] }] },
  { name: 'Village', team: 2, position: [100, 0, 0], spawns: [{ position: [100, 0, 0] }] },
  { name: 'Carrier', team: 2, vehicle: true, position: [20, 0, 0], spawns: [{ position: [20, 0, 0] }] },
  { name: 'Hill', team: 2, captureOnly: true, position: [10, 0, 0], spawns: [] },
];
res.flag = {
  allied: nearestFlagIndex(flags, 2, 30, 0),
  axis: nearestFlagIndex(flags, 1, 480, 0),
  none: nearestFlagIndex([], 2, 0, 0),
  onlyShip: nearestFlagIndex([flags[3]], 2, 0, 0),
  // The server has him alive, so the page's flag bookkeeping never refuses
  // the resume: a ship flag whose points are not bound yet, or one with no
  // position, still files him (Japan on Wake, browser.md "The join").
  shipNoPoints: nearestFlagIndex([flags[1], { name: 'Shokaku', team: 1, vehicle: true, spawns: [] }], 1, 0, 0),
  shipNoPosition: nearestFlagIndex([{ name: 'Shokaku', team: 1, vehicle: true, spawns: [{}] }], 1, 0, 0),
  // ... but a flag with points of his side still comes first.
  pointsFirst: nearestFlagIndex([{ name: 'Empty', team: 1, spawns: [] }, flags[0]], 1, 900, 0),
  onlyCapture: nearestFlagIndex([flags[4]], 2, 0, 0),
};

// The sidecar's snapshot for a page that joins mid-life sends every event
// before every object, so the pickup names a kit object the page has not
// been told about yet.
{
  const s = createSidecarState();
  s.ingest({ k: 'h', name: 'probe' });
  s.ingest({ k: 'e', e: 'createPlayer', pid: 3, name: 'probe', team: 2, netId: 700, vehNetId: 701, kitNetId: 0 });
  s.ingest({ k: 'e', e: 'pickupKit', pid: 3, netId: 906 });
  res.sidecar = { beforeObject: s.playerRow(4)?.kit ?? null };
  s.ingest({ k: 'o', id: 906, tid: 1523, tmpl: 'UsMarine_AT', team: 0, cls: 'KitNetworkable' });
  res.sidecar.afterObject = s.playerRow(4)?.kit ?? null;
  // Gone from scope while he holds it: the template is kept.
  s.ingest({ k: 'd', id: 906 });
  res.sidecar.afterDespawn = s.playerRow(4)?.kit ?? null;
  // A second pickup replaces the first.
  s.ingest({ k: 'o', id: 950, tid: 1530, tmpl: 'USMarine_Engineer', team: 0, cls: 'KitNetworkable' });
  s.ingest({ k: 'e', e: 'pickupKit', pid: 3, netId: 950 });
  res.sidecar.secondPickup = s.playerRow(4)?.kit ?? null;
}

process.stdout.write(JSON.stringify(res));
