// Drives `viewer/server-entities.js`'s engine voice outside a browser: a hull
// the SERVER stands claims the page's vehicle sound rack while a remote crews
// it or its engine turns over, with a drive whose rpm is the server's revs
// (`Engine::updateSound` 0x0823e930 reads |PhysicsEngine+0xa0|, the field
// `setNetUpdate` writes the ghosted revs into) and whose velocity is the drawn
// motion.
import * as THREE from 'three';
import { createServerEntities } from './server-entities.js';

const DT_MS = 1000 / 30;

function make({ driven = () => null } = {}) {
  const calls = [];
  const entities = createServerEntities({
    scene: new THREE.Group(),
    model: () => Promise.resolve(new THREE.Group()),
    isKit: () => false, collider: () => null, registerDamageable: () => null,
    drivenId: driven,
    claimVehicleAudio: (key, node, drive) => calls.push({ op: 'claim', key, node: node.name, drive }),
    releaseVehicleAudio: (key, node) => calls.push({ op: 'release', key, node: node.name }),
    cutVehicleAudio: node => calls.push({ op: 'cut', node: node.name }),
  });
  return { entities, calls };
}

/** The sidecar client: an object table, and a live pose per id. */
function client(vehicles, poses) {
  return {
    vehicles: new Map(vehicles.map(v => [v.id, v])),
    remoteVehicle: id => poses.get(id) ?? null,
    playerOwned: () => false,
  };
}

const ops = calls => calls.map(c => `${c.op}:${c.key ?? c.node}`);
const out = {};

// A Sherman a bot climbs into, drives off at 10 m/s, then leaves.
{
  const { entities, calls } = make();
  const v = { id: 560, template: 'Sherman', cls: 'SimpleObjectNetworkable', spawnPos: [0, 0, 0] };
  const pose = { x: 0, y: 0, z: 0, q: [0, 0, 0, 1], occupied: false };
  const c = client([v], new Map([[560, pose]]));
  let t = 0;
  entities.sync(c, t);
  await Promise.resolve(); await Promise.resolve();
  for (let i = 0; i < 30; i++) entities.sync(c, t += DT_MS);
  out.parked = ops(calls);

  pose.occupied = true;
  v.revs = [0];
  entities.sync(c, t += DT_MS);
  out.boarded = ops(calls);
  const drive = calls.find(c => c.op === 'claim')?.drive;
  out.boardedRunning = drive?.engineRunning ?? null;

  v.revs = [0.77];
  for (let i = 0; i < 45; i++) { pose.x += 10 * DT_MS / 1000; entities.sync(c, t += DT_MS); }
  out.driving = {
    rpm: +drive.engineRpm('ShermanEngine').toFixed(3),
    speed: +Math.hypot(drive.state.velocity.x, drive.state.velocity.y, drive.state.velocity.z).toFixed(2),
    claims: calls.filter(c => c.op === 'claim').length,
  };

  pose.occupied = false;
  v.revs = [0];
  entities.sync(c, t += DT_MS);
  entities.sync(c, t += DT_MS);
  out.left = ops(calls);
  out.leftRunning = drive.engineRunning;
}

// A destroyer backing off: negative revs, magnitude on the note.
{
  const { entities, calls } = make();
  const v = { id: 539, template: 'Hatsuzuki', cls: 'SimpleObjectNetworkable', spawnPos: [0, 0, 0], revs: [-0.312] };
  const c = client([v], new Map([[539, { x: 0, y: 0, z: 0, q: [0, 0, 0, 1], occupied: true }]]));
  entities.sync(c, 0);
  await Promise.resolve(); await Promise.resolve();
  entities.sync(c, DT_MS);
  out.astern = +calls[0].drive.engineRpm('x').toFixed(3);
}

// An empty plane whose engine still turns over (revs above zero, no crew):
// voiced. The same plane wrecked: cut at once, never released.
{
  const { entities, calls } = make();
  const v = { id: 837, template: 'Corsair', cls: 'SimpleObjectNetworkable', spawnPos: [0, 0, 0], revs: [0.4] };
  const c = client([v], new Map([[837, { x: 0, y: 0, z: 0, q: [0, 0, 0, 1], occupied: false }]]));
  entities.sync(c, 0);
  await Promise.resolve(); await Promise.resolve();
  entities.sync(c, DT_MS);
  out.windingDown = ops(calls);
  v.destroyed = true;
  entities.sync(c, DT_MS * 2);
  entities.sync(c, DT_MS * 3);
  out.wrecked = ops(calls);
}

// A crewed hull the server takes away: its claim goes with it.
{
  const { entities, calls } = make();
  const v = { id: 562, template: 'Zero', cls: 'SimpleObjectNetworkable', spawnPos: [0, 0, 0], revs: [0.8] };
  const c = client([v], new Map([[562, { x: 0, y: 0, z: 0, q: [0, 0, 0, 1], occupied: true }]]));
  entities.sync(c, 0);
  await Promise.resolve(); await Promise.resolve();
  entities.sync(c, DT_MS);
  c.vehicles.delete(562);
  entities.sync(c, DT_MS * 2);
  out.removed = ops(calls);
}

// The hull the page drives: its own drive sounds it, never the server's copy.
{
  const { entities, calls } = make({ driven: () => 886 });
  const v = { id: 886, template: 'M3A1', cls: 'SimpleObjectNetworkable', spawnPos: [0, 0, 0], revs: [0.7] };
  const c = client([v], new Map([[886, { x: 0, y: 0, z: 0, q: [0, 0, 0, 1], occupied: true }]]));
  entities.sync(c, 0);
  await Promise.resolve(); await Promise.resolve();
  entities.sync(c, DT_MS);
  out.ownDrive = ops(calls);
}

console.log(JSON.stringify(out, null, 1));
