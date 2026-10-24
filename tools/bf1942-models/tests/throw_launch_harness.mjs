// A thrown grenade's flight on the page against the lab server's
// (test_throw_launch.py, fixtures/throw_launch_grenade.json). For each throw:
// the launch velocity as `round-launch.js` `muzzleVelocity` composes it
// (`velocity x heat` down the frame's +Z, the soldier's velocity, and
// `ROOT_SPEED_LIFT`), flown by `contact-response.js` `FuseRoundBody` a tick
// at a time in the open air, against the server's places. Then a plain
// ballistic round through `projectile-flight.js` `advanceProjectiles` at
// several frame rates, against the engine's tick law.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [{ FuseRoundBody }, { ROOT_SPEED_LIFT }, { advanceProjectiles }, THREE] = await Promise.all([
  imp('contact-response.js'), imp('round-launch.js'), imp('projectile-flight.js'), import('three'),
]);
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'throw_launch_grenade.json'), 'utf8'));
const TICK = 1 / 30;
const G = -14.73;

function fly(t, { lift = ROOT_SPEED_LIFT, firstTickGravity = false } = {}) {
  const v = t.d.map((c, i) => fx.velocity * t.heat * c + t.soldierVelocity[i]);
  v[1] += lift;
  const position = { x: t.p[0], y: t.p[1], z: t.p[2] };
  const velocity = { x: v[0], y: v[1], z: v[2] };
  const body = new FuseRoundBody({ gravity: G });
  if (firstTickGravity) body.ticks = 1;
  const out = [];
  for (let k = 0; k < 8; k++) {
    body.tick(position, velocity, null);
    out.push([position.x, position.y, position.z]);
  }
  const miss = out.map((p, k) => Math.hypot(p[0] - t.track[k][0], p[1] - t.track[k][1], p[2] - t.track[k][2]));
  return { label: t.label, worst: Math.max(...miss), lastY: out[7][1] - t.track[7][1] };
}

// A plain round (no fuse, no drag) out of a still gun at 20 m/s, 30 deg up,
// flown 1 s by the page's loop at `frame`, against the engine's body: no
// gravity on its first tick, `g dt` a tick after.
function ballistic(frame) {
  const shot = {
    group: { stats: { projectile: {} } }, mesh: new THREE.Object3D(),
    velocity: new THREE.Vector3(0, 10, 17.32), gravity: 1, gravityScale: 1, age: 0, travelled: 0,
    origin: new THREE.Vector3(),
  };
  const guns = { projectiles: [shot], collider: null, casts: 0, scene: null };
  let t = 0;
  const samples = [];
  for (let n = 1; n <= 30; n++) {
    while (t < n * TICK - 1e-9) {
      advanceProjectiles(guns, frame);
      t += frame;
    }
    samples.push(shot.mesh.position.y);
  }
  const engine = n => 10 * TICK * n + 0.5 * G * TICK * TICK * n * (n - 1);
  return { worst: Math.max(...samples.map((y, i) => Math.abs(y - engine(i + 1)))) };
}

let ball = null;
try {
  ball = Object.fromEntries([['fps30', 1 / 30], ['fps60', 1 / 60], ['fps120', 1 / 120]].map(([k, f]) => [k, ballistic(f)]));
} catch (e) {
  ball = { error: String(e?.stack ?? e) };
}
console.log(JSON.stringify({
  law: fx.throws.map(t => fly(t)),
  noLift: fx.throws.map(t => fly(t, { lift: 0 })),
  gravityFirst: fx.throws.map(t => fly(t, { firstTickGravity: true })),
  ballistic: ball,
}));
