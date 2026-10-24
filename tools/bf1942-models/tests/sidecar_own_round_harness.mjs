// The local player's own grenade on a real server: drawn once, from the
// server's ghost, as the retail client draws it (ledger NET-15).
//
// The fixture is a lab session (Wake, 2026-10-25, lab/own_round_probe.mjs)
// in which the sidecar's own soldier threw three US grenades. Its rows go
// through the page's state (`net-sidecar.js`) and the page's server-rounds
// module (`net-server-rounds.js`), and the page's own gun (`gunfire.js`) is
// pointed at `fliesRound` as `net-room.js` points it. Read out:
//
//   * what the server sent the thrower of his own pool's rounds: the rows the
//     page draws from (`roundRows` away from the origin), where each first
//     appears against his soldier, and the detonate rows;
//   * how many rounds the page's own gun launches for a pull of the grenade
//     before the pool is known, after it, and for a rifle beside it.
//
// Run by tests/test_sidecar_own_round.py, which copies the import closure
// into a temp dir and passes the fixture.
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { createSidecarState } from './net-sidecar.js';
import { createServerRounds } from './net-server-rounds.js';
import { GunFire } from './gunfire.js';

const [fixture] = process.argv.slice(2);
const rows = zlib.gunzipSync(fs.readFileSync(fixture)).toString('utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const out = {};
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
guns.rand = () => 0.5;
let shots = 0;
guns.onShot = () => { shots += 1; };

// No mesh source: the module's loads fail and it carries on (niceties never
// throw), which leaves its decisions, not its drawing, under test.
const rounds = createServerRounds({
  scene, loader: { load: (_u, _ok, _p, fail) => fail?.(new Error('no assets')), loadAsync: async () => { throw new Error('no assets'); } },
  modelsBase: '/none/', bust: () => '', guns: () => guns, effects: () => null,
});
guns.serverFlies = (group) => rounds.fliesRound(group);

/** A hand weapon of one muzzle whose round is `template`. */
function handGun(name, template, extra = {}) {
  const weapon = new THREE.Group();
  weapon.name = name;
  weapon.userData.fireArms = {
    roundOfFire: 1, fireOnce: true, velocity: 15, muzzles: 1, magSize: 4, numOfMag: 1,
    projectile: { kind: 'shell', template, timeToLive: 4, gravity: 1, material: 70,
                  damage: { damageType: 1, radius: 8 }, endEffect: 'e_ExplGranade' },
    ...extra,
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.userData.muzzle = true;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), new THREE.MeshBasicMaterial());
  body.userData.projectileMesh = true;
  weapon.add(muzzle, body);
  return guns.collect(weapon, {
    replace: true, speedScale: 1, roundLifetime: 'data',
    aimRay: () => ({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 1, y: 0, z: 0 } }),
  })[0];
}

const grenade = handGun('GrenadeAllies', 'GrenadeAlliesProjectile',
  { throw: { fireDelay: 1, hideDuringFireTime: 0.4 } });
const rifle = handGun('M1Garand', 'M1GarandProjectile');

/** One pull of `group`: the rounds it put in the world and the `onShot`s. */
function pull(group) {
  const before = guns.projectiles.length;
  const shotsBefore = shots;
  group.cooldown = 0;
  guns.fireShot(group);
  const launched = guns.projectiles.length - before;
  return { launched, onShot: shots - shotsBefore };
}

out.beforePool = pull(grenade);

// The session's rows, through the page's state and its server-rounds module.
const st = createSidecarState();
let me = null, soldier = null, mePos = null;
const owned = new Set();
const firstAway = new Map();    // id -> metres from his soldier at its first drawn row
const detonates = [];
const shown = new Set();
for (const r of rows) {
  st.ingest(r);
  for (const ev of st.state.pending.splice(0)) rounds.onRow(ev);
  if (r.e === 'createPlayer' && r.name === rows[0].name) me = r.pid;
  if (r.e === 'control' && r.pid === me) soldier = r.netId;
  if (r.e === 'projPool' && soldier != null) for (let i = 0; i < r.count; i++) owned.add(r.netId + i);
  if (r.e === 'detonate' && owned.has(r.id)) detonates.push(r.id);
  if (r.k !== 's') continue;
  const at = st.state.xform.get(soldier);
  if (at) mePos = [at.x, at.y, at.z];
  for (const row of st.roundRows()) {
    if (!owned.has(row.id) || Math.hypot(row.x, row.y, row.z) < 1) continue;
    shown.add(row.id);
    if (!firstAway.has(row.id) && mePos) {
      firstAway.set(row.id, +Math.hypot(row.x - mePos[0], row.y - mePos[1], row.z - mePos[2]).toFixed(2));
    }
  }
}
out.me = me;
out.owned = [...owned].sort();
out.shown = [...shown].sort();
out.firstAway = [...firstAway.values()];
out.detonates = detonates;
out.pooled = rounds.isPooled('GrenadeAlliesProjectile');

out.afterPool = pull(grenade);
out.rifle = pull(rifle);

console.log(JSON.stringify(out));
process.exit(0);
