// The replay's third-person tracer for a recorded soldier's round
// (`replay-bodies.js` `ReplaySoldiers.flash`): it leaves the row's `p` (a
// sidecar's or a v4 recorder's launch point, the eye, ledger XHIT-18) when
// the row has one, and keeps the old start (the drawn weapon, else the feet
// plus 1.4 m) for a row without one and for a v3 press, whose `pos` is his
// origin. The direction is `d` either way. Run by
// tests/test_sidecar_hand_rounds.py; one JSON object on stdout.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const THREE = await import(pathToFileURL(path.join(viewer, 'vendor', 'three.module.js')).href);
const { ReplaySoldiers } = await import(pathToFileURL(path.join(viewer, 'replay-bodies.js')).href);

const launched = [];
const group = { stats: { input: 'c_PIFire', projectile: { template: 'BarBullet' } } };
const root = new THREE.Group();
const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
const self = {
  player: {
    ctx: { guns: { fireShot: () => launched.push({ origin: ray.origin.toArray(), dir: ray.dir.toArray(),
                                                    flash: root.position.toArray() }) } },
    networkedRounds: new Set(),
  },
  guns: new Map([['7|BAR1918', { root, groups: [group], ray }]]),
  bodies: null,
};
const actor = { playerId: 7, state: { soldier: { x: 100, y: 20, z: -50, yaw: 0 } } };
const flash = (f) => ReplaySoldiers.prototype.flash.call(self, actor, 'BAR1918', f);
await flash({ pos: [101, 21.65, 50], dir: [0, 0, 1], press: false });   // a row with p
await flash({ pos: null, dir: [0, 0, 1], press: false });               // a row without
await flash({ pos: [100, 20, 50], dir: [0, 0, 1], press: true });       // a v3 press
console.log(JSON.stringify(launched.map(l => ({ origin: l.origin.map(v => +v.toFixed(4)),
  dir: l.dir.map(v => +v.toFixed(4)), flash: l.flash.map(v => +v.toFixed(4)) }))));
