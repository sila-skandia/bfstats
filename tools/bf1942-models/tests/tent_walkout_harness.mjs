// A soldier stood inside FHSW's BigTent (Operation Spring Awakening's
// axis_base1_spawn2) walks out through its door and not through its walls.
//
// The tent's soldier collision (`col1`) is double-walled: every wall carries a
// face each way, so from inside the engine's one-sided narrow phase
// (collision-response.md 5.5, `checkFaceAndEdgeCollision` 0x08374880) meets a
// wall as surely as from outside, and the lab's sidecar soldier spent minutes
// inside it walking at the canvas (runs 20261028-003918, -015422). The door,
// 1.4 m wide and 1.9 m high in the tent's -Z end, is open, and the lab's
// server walked the sidecar out through it in 2.5 s (run 20261028-020859).
// The fixture is the baked mesh in the tent's own frame; the harness stands
// the tent at the middle of a flat 64 m tile, the spawn point where the level
// has it relative to the tent, and walks him at a waypoint the way the probe
// did. Run by `tests/test_tent_walkout.py`, which copies the soldier's modules
// in; prints one JSON object.

import { readFileSync } from 'node:fs';
import { buildHeightfield } from './heightfield.js';
import { buildCollisionIndex } from './static-index.js';
import { WorldCollider } from './world-collider.js';
import { Soldier } from './soldier.js';

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const CENTRE = [32, 0, -32];

function mesh(positions, { material = 0, collision = true, kind = '' } = {}) {
  const node = {
    isMesh: true, name: kind || 'mesh', parent: null, children: [],
    userData: collision ? { collision: true } : { kind },
    matrixWorld: { elements: IDENTITY },
    geometry: {
      attributes: { position: { array: Float32Array.from(positions), count: positions.length / 3 } },
      index: null,
      userData: { defenseMaterial: material, collision },
    },
    traverse(fn) { fn(node); },
  };
  return node;
}

// The tent's yaw about +Y from its quaternion, and its frame onto the tile.
const [, qy, , qw] = fixture.placed.rotation;
const yaw = 2 * Math.atan2(qy, qw);
const c = Math.cos(yaw), s = Math.sin(yaw);
const toWorld = ([x, y, z]) => [CENTRE[0] + x * c + z * s, CENTRE[1] + y, CENTRE[2] - x * s + z * c];
const toLocal = ([x, y, z]) => {
  const dx = x - CENTRE[0], dz = z - CENTRE[2];
  return [dx * c - dz * s, y - CENTRE[1], dx * s + dz * c];
};
const parts = fixture.primitives.map(p => {
  const out = [];
  for (let i = 0; i < p.positions.length; i += 3) out.push(...toWorld(p.positions.slice(i, i + 3)));
  return mesh(out, { material: p.material });
});
const tile = [];
for (let iz = 0; iz < 16; iz++) for (let ix = 0; ix < 16; ix++) {
  const x0 = ix * 4, x1 = x0 + 4, z0 = -iz * 4, z1 = z0 - 4;
  tile.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
}
const terrain = mesh(tile, { collision: false, kind: 'terrain' });
const root = { children: [terrain, ...parts], parent: null, userData: {}, traverse(fn) { fn(root); for (const k of root.children) k.traverse(fn); } };
for (const k of root.children) k.parent = root;
const field = buildHeightfield([terrain], { worldSize: 64, dim: 16 });
const statics = buildCollisionIndex(root, { ownerRoots: parts, cellSize: 8 });
const collider = new WorldCollider({ heightfield: field, statics, waterLevel: -50 });

// The spawn point where the level has it, in the tent's frame.
const sp = fixture.spawn.position, tp = fixture.placed.translation;
const spawnLocal = (() => {
  const dx = sp[0] - tp[0], dz = sp[2] - tp[2];
  return [dx * c - dz * s, 0, dx * s + dz * c];
})();

const DT = 1 / 30;
/** Walk at a point in the tent's frame, turning the body to face it each tick
 *  (forward is (sin yaw, cos yaw)), for at most `seconds`. */
function walkTo(soldier, local, seconds) {
  const [tx, , tz] = toWorld(local);
  for (let t = 0; t < seconds; t += DT) {
    const dx = tx - soldier.x, dz = tz - soldier.z;
    if (Math.hypot(dx, dz) < 0.3) break;
    soldier.yaw = Math.atan2(dx, dz);
    soldier.step(DT, { forward: 1 });
  }
  return toLocal([soldier.x, soldier.y, soldier.z]).map(v => +v.toFixed(2));
}
const stand = () => new Soldier({ collider }).spawn(...toWorld(spawnLocal), 0);

const out = { spawnLocal: spawnLocal.map(v => +v.toFixed(3)), tentYawDeg: +(yaw * 180 / Math.PI).toFixed(1) };
// Out through the door (local -Z) and four metres on.
{
  const soldier = stand();
  walkTo(soldier, [0, 0, -2.4], 4);
  out.outThroughDoor = walkTo(soldier, [0, 0, -6], 6);
}
// At the back wall, the side walls: held inside the canvas.
for (const [name, at] of [['back', [0, 0, 6]], ['left', [-6, 0, -1]], ['right', [6, 0, -1]]]) {
  out[name] = walkTo(stand(), at, 6);
}
process.stdout.write(JSON.stringify(out));
