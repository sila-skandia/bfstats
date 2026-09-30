// Drives `viewer/recoil.js` through the world's own soldier tick
// (`viewer/world-soldier-tick.js`) under node, and prints one JSON blob for
// `tests/test_recoil.py`.
//
// The tick is the real one: `soldierTick` consumes the player's buffered look
// axes, adds the recoil ride's share (`recoilStep`) and turns the soldier by
// the engine's look law (`mouse-input.js` `soldierLookDegrees`). The soldier
// is a stub that records what it was turned by; everything else the tick
// touches (fall damage, drowning, barbed wire) is left empty.
//
// Run by `tests/test_recoil.py`; the modules are the viewer's own, loaded
// through `sim/env.mjs` the way the other world harnesses load them.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(path.join(viewer, f));
const { calcRecoil, recoilStep, RECOIL_TABLE, RECOIL_TABLE2, GO_BACK_TICKS, KICK_TICKS } =
  await imp('recoil.js');
const { soldierTick } = await imp('world-soldier-tick.js');
const { bufferInput } = await imp('world-input.js');

const DEG = 180 / Math.PI;
const out = {};

const sum = (t, from, to) => {
  let s = 0;
  for (let i = from; i >= to; i--) s = Math.fround(s + t[i]);
  return +s.toFixed(6);
};
out.tables = {
  goBackKick: sum(RECOIL_TABLE, 20, 13),
  goBackReturn: sum(RECOIL_TABLE, 12, 1),
  goBackAll: sum(RECOIL_TABLE, 20, 1),
  kickOnly: sum(RECOIL_TABLE2, 8, 1),
  goBackTicks: GO_BACK_TICKS,
  kickTicks: KICK_TICKS,
};

// --- calcRecoil's words -----------------------------------------------------------

{
  const half = () => 0.5;
  const ride = { count: 5, pitch: 9, yaw: 9, goBack: true, devMod: null };
  const none = calcRecoil(ride, { up: [1, 1], hasForce: false }, half);
  out.noForce = { armed: none, count: ride.count, pitch: ride.pitch };
  const def = {};
  calcRecoil(def, { hasForce: true }, half);
  out.defaults = { count: def.count, pitch: def.pitch, yaw: def.yaw, goBack: def.goBack };
  const off = {};
  calcRecoil(off, { up: [0.28, 0.32], leftRight: [-0.2, 0.2], hasForce: true, goBack: false }, half);
  out.noGoBack = { count: off.count, pitch: +off.pitch.toFixed(4), yaw: +off.yaw.toFixed(4), goBack: off.goBack };
}

// --- through the world's tick -------------------------------------------------------

function stubPlayer(stance = 'stand') {
  const soldier = {
    stance, yaw: 0, pitch: 0, recoil: null, landing: null,
    look(dYaw, dPitch) { this.yaw += dYaw; this.pitch += dPitch; },
    step() {}, drainDrowning() { return 0; }, drainObstacles() { return null; },
  };
  return {
    id: 1, soldier, armor: null, buffer: [], pending: null, held: null, last: null, lastSeen: -1,
    lookApplied: { yaw: 0, pitch: 0 },
  };
}
const world = { collider: null, damageTables: null, report: { obstacles: [] } };

/** Run `ticks` world ticks, shooting on the listed tick numbers with the
 *  weapon's `recoil` block (and `devMod`), the mouse's own per-tick axis in
 *  `mouse` (c_PIMouseLookY). Returns pitch and yaw in degrees after every tick. */
function run(recoil, { ticks, shots, rand = () => 0.5, devMod = null, stance = 'stand', mouse = 0 }) {
  const player = stubPlayer(stance);
  const s = player.soldier;
  const pitch = [], yaw = [];
  for (let t = 0; t < ticks; t++) {
    if (shots.includes(t)) {
      s.recoil ??= { count: 0, pitch: 0, yaw: 0, goBack: true, devMod: null };
      calcRecoil(s.recoil, recoil, rand, devMod);
    }
    bufferInput(player, {}, { x: 0, y: mouse });
    soldierTick(world, player, 1 / 30);
    pitch.push(+(s.pitch * DEG).toFixed(4));
    yaw.push(+(s.yaw * DEG).toFixed(4));
  }
  return { pitch, yaw };
}

const TABUK = { up: [1.2, 1.2], leftRight: [-0.1, -0.3], hasForce: true, goBack: true };
const REMINGTON = { up: [2, 2], leftRight: [-1, 1], hasForce: true, goBack: true };
const M9 = { up: [0.4, 0.6], leftRight: [-0.2, -0.2], hasForce: true, goBack: true };
const AK47 = { up: [0.28, 0.32], leftRight: [-0.2, 0.2], hasForce: true, goBack: false };
const AK47GP30 = { up: [0.28, 0.32], leftRight: [-0.2, 0.2], hasForce: false, goBack: false };

out.tabukOne = run(TABUK, { ticks: 24, shots: [0], rand: () => 0 });
out.remingtonOne = run(REMINGTON, { ticks: 24, shots: [0] });
// Six pistol shots a full ride apart, then six as fast as a finger clicks.
out.m9Slow = run(M9, { ticks: 6 * 30, shots: [0, 30, 60, 90, 120, 150] });
out.m9Fast = run(M9, { ticks: 6 * 6 + 24, shots: [0, 6, 12, 18, 24, 30] });
// An automatic: a round every three ticks, and no return.
out.akBurst = run(AK47, { ticks: 40, shots: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27] });
out.gp30 = run(AK47GP30, { ticks: 24, shots: [0] });
// Crouched, a weapon with `setDevMod 1 0.5 0.25` kicks half as far.
out.crouched = run(TABUK, { ticks: 24, shots: [0], rand: () => 0, devMod: [1, 0.5, 0.25], stance: 'crouch' });
// The player pulling down at 0.05 a tick through a Tabuk shot: the ride still
// nets to zero, and the view ends where his hand alone put it.
out.againstMouse = run(TABUK, { ticks: 24, shots: [0], rand: () => 0, mouse: 0.05 });
out.mouseAlone = run({ hasForce: false }, { ticks: 24, shots: [0], mouse: 0.05 });

// One ride stepped by hand: the per-tick shares, for the pitch profile.
{
  const ride = {};
  calcRecoil(ride, TABUK, () => 0);
  const step = { x: 0, y: 0 };
  const ys = [];
  for (let i = 0; i < 22; i++) ys.push(+recoilStep(ride, 'stand', step).y.toFixed(4));
  out.profile = ys;
}

process.stdout.write(JSON.stringify(out));
