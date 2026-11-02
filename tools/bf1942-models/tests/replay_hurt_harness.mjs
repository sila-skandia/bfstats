// `ReplaySoldiers.hurt` under node: a replayed soldier's flinch, grunt and
// view shake for a blow he lives through, played frame by frame over small
// synthetic lives. `hurt` reads only `player` (playing, rec, ctx, camera),
// `dragging` and `bodies.botHit`, so it runs on a stand-in object.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(root, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(root, 'viewer'));
installModuleHooks(viewer);
const [{ ReplaySoldiers }, recording] = await Promise.all([
  import(pathToFileURL(path.join(viewer, 'replay-bodies.js')).href),
  import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href),
]);

// One soldier, nid 5: recorded upper states [t, name] and hit points [t, hp].
function play({ states = null, hp = [], from = 0, to = 3, playing = true }) {
  const names = states ? [...new Set(['Lb_Stand', ...states.map(([, n]) => n)])] : [];
  const rec = {
    animStates: names.map(name => ({ name, flags: 0 })),
    stances: states ? new Map([[5, states.map(([t, n]) => ({ t, lower: 0, upper: names.indexOf(n), item: 3 }))]]) : new Map(),
  };
  const life = { nid: 5, hp: hp.map(([t, v]) => ({ t, hp: v })) };
  const log = [];
  const self = {
    player: {
      playing, rec,
      ctx: { playSoldierHurtSound: () => log.push(['grunt', +t.toFixed(2)]) },
      camera: { hurt: () => log.push(['shake', +t.toFixed(2)]) },
    },
    dragging: false,
    bodies: { botHit: (actor, name, opts = {}) => { log.push(['flinch', +t.toFixed(2), name, !!opts.recorded]); return true; } },
  };
  const actor = { stance: 'stand', team: 2, state: { soldier: { x: 0, y: 0, z: 0 } } };
  let t = from;
  for (; t <= to + 1e-9; t += 1 / 30) {
    const body = states ? recording.bodyAt(rec, 5, t) : null;
    ReplaySoldiers.prototype.hurt.call(self, actor, life, body, t, false, false);
  }
  return log;
}

console.log(JSON.stringify({
  // Omaha's case: the recorded flinch, no hit-point row for him at all.
  noHp: play({ states: [[0, 'Ub_StandAimThompson'], [1, 'Ub_HitChestStand'], [2, 'Ub_StandAimThompson']] }),
  // A drop and its state in the same sample (8t224pppqe): one grunt, one
  // shake, one flinch, the recorded one.
  dropAndState: play({ states: [[0, 'Ub_StandAimThompson'], [1, 'Ub_HitBackStand'], [2, 'Ub_StandAimThompson']],
    hp: [[0, 100], [1, 70]] }),
  // A drop with no hit state (a reload kept the torso): the grunt and shake only.
  dropNoState: play({ states: [[0, 'Ub_StandReloadThompson']], hp: [[0, 100], [1, 70]] }),
  // Opened mid-flinch (a seek into it): nothing.
  seekedIn: play({ states: [[0, 'Ub_StandAimThompson'], [1, 'Ub_HitChestStand'], [2, 'Ub_StandAimThompson']], from: 1.7 }),
  // A file without body states (v3): the chest state of his stance on the drop.
  v3: play({ hp: [[0, 100], [1, 70]] }),
  // Paused: nothing.
  paused: play({ states: [[0, 'Ub_StandAimThompson'], [1, 'Ub_HitChestStand']], playing: false }),
}));
