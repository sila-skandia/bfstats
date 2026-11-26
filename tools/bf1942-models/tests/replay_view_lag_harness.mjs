// `ReplaySoldiers.update` under node: through a followed player's eyes, the
// others on foot are placed as his client drew them, behind by the rewind the
// server judged his rounds with (`replay-recording.js` `shooterViewLag`,
// `BFSoldier::getLatencyPosition`). `place` is stubbed to record the time
// each man is placed at; nothing is drawn.

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

const T = 50;
/** pid 0 and pid 1 on foot (soldiers 10 and 11), pid 2 in seat 21 of hull
 *  20; `ping` is pid 0's on the board, `boardAt` the hull pid 1 boards
 *  (null: never). */
function placed({ mode = 'pov', follow = 0, ping = 34, boardAt = null, rig = null }) {
  const lives = [
    { nid: 10, pid: 0, soldier: true, created: 0, destroyed: Infinity },
    { nid: 11, pid: 1, soldier: true, created: 0, destroyed: Infinity },
    { nid: 12, pid: 2, soldier: true, created: 0, destroyed: Infinity },
    { nid: 20, created: 0, destroyed: Infinity },
  ];
  const nids1 = [{ t: 0, nid: 11 }];
  if (boardAt !== null) nids1.push({ t: boardAt, nid: 21 });
  const rec = {
    sampleHz: 30, lives,
    playerNids: new Map([[0, [{ t: 0, nid: 10 }]], [1, nids1], [2, [{ t: 0, nid: 21 }]]]),
    playerStats: new Map([[0, [{ t: 0, ping: 0 }, { t: 10, ping }]], [1, [{ t: 0, ping: 22 }]]]),
  };
  const out = {};
  const self = {
    player: { rec, camera: { mode, rig }, followPid: follow, focus: null, ctx: { loadouts: () => null }, guard: null },
    drawn: [], warming: true, bodies: null,
    actorFor: () => ({}),
    place: (actor, pid, nid, t) => { out[pid] = +(T - t).toFixed(4); return false; },
    viewerPid: ReplaySoldiers.prototype.viewerPid,
    onFoot: ReplaySoldiers.prototype.onFoot,
  };
  ReplaySoldiers.prototype.update.call(self, T, 1 / 30, new Map());
  return out;
}

console.log(JSON.stringify({
  pov: placed({}),
  orbit: placed({ mode: 'orbit' }),
  free: placed({ mode: 'free' }),
  rig: placed({ rig: {} }),
  followOther: placed({ follow: 1 }),
  highPing: placed({ ping: 450 }),
  bot: placed({ ping: 0 }),
  boarding: placed({ boardAt: T - 0.05 }),
  lag: recording.shooterViewLag({ sampleHz: 30, playerStats: new Map([[0, [{ t: 0, ping: 34 }]]]) }, 0, 5),
}));
