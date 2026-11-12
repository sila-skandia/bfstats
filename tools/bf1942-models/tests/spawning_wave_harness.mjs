// The page's own player waits for the reinforcement wave off a retail server
// (SPAWN-35), on the round's clock: `viewer/spawning.js` driven in node over
// a stub page. A commit before the wave closes the screen to the free camera
// and `waveTick` stands the body once the wave has the player; SUICIDE is a
// death of their own with its wave; a room's wait is its server's `sw`.
//
// Run by `tests/test_spawning_wave.py`; prints one JSON object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const { createSpawning } = await import(path.join(viewer, 'spawning.js'));

globalThis.document ??= { activeElement: null, body: null, createElement: () => ({}) };
const el = () => ({ on: {}, addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }, blur() {}, classList: { add() {}, remove() {} }, dataset: {},
                    setAttribute() {}, getBoundingClientRect: () => ({ width: 0, height: 0 }), value: '0',
                    hidden: false, disabled: false, innerHTML: '', appendChild() {}, selectedIndex: 0 });
const flag = { name: 'Axis_Base', team: 1, group: 1, spawns: [{ position: [0, 0, 0], group: 1 }],
               position: [0, 0, 0] };
const round = { clock: 0, status: 'playing', restarts: 0 };
const state = { soldier: null, soldierDead: false, deployActive: true, roomJoined: false, sent: [], free: 0 };
const page = {
  get flags() { return [flag]; },
  get round() { return round; },
  get soldier() { return state.soldier; },
  get soldierDead() { return state.soldierDead; },
  get roomJoined() { return state.roomJoined; },
  get worldReady() { return true; },
  deployActive: () => state.deployActive,
  serverOwnsSpawn: () => false,
  watchingRound: () => false,
  deployTabs: [], deployKitHits: [],
  deploySuicideBtn: el(), deployResumeBtn: el(), deployScoreBtn: el(),
  fullmapCanvas: el(), fullmapBox: el(), spawnFlagSelect: el(),
  toggleFullMap: on => { state.deployActive = !!on; },
  setOnFoot: on => { if (on) { state.soldier = {}; state.soldierDead = false; } else state.soldier = null; },
  markOnFoot() {}, placeCamera() { state.free++; }, capture() {},
  discardSoldier: () => { state.soldier = null; state.soldierDead = false; },
  disposeHandWeapon() {}, logToConsole() {},
  netSendAction: row => state.sent.push(row),
  LOCAL_PLAYER: 'local',
  params: new URLSearchParams(''),
};
// Everything else the module reads is a no-op that answers anything.
const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : any), apply: () => undefined });
const stub = new Proxy(page, { get: (t, k) => (k in t ? t[k] : any) });
const spawning = createSpawning(stub);

const r2 = v => Math.round(v * 100) / 100;
const commit = () => {
  state.deployActive = true;
  spawning.selectDeployFlag(0);
  const stood = spawning.deploySpawn();
  return { at: r2(round.clock), stood, waiting: spawning.waveWaiting, left: r2(spawning.waveSecondsLeft()),
           plate: spawning.waveCountdown()?.text ?? null, screenOpen: state.deployActive };
};
const die = () => { state.soldierDead = true; spawning.noteDeath(); };
const tickTo = until => {
  let stoodAt = null;
  while (round.clock < until - 1e-9) {
    round.clock += 1 / 30;
    spawning.waveTick();
    if (stoodAt == null && state.soldier && !state.soldierDead) stoodAt = r2(round.clock);
  }
  return stoodAt;
};

const out = {};
// A fresh join waits for nothing (`+0x8c` starts at 0).
out.join = commit();
tickTo(10);
die();
out.deathAt10 = { plate: spawning.waveCountdown()?.text ?? null };
tickTo(13);                                  // the death cam's beat
out.commitAt13 = commit();
out.commitAt13.stoodAt = tickTo(40);         // the window at 25
// SUICIDE over a live soldier (the footer's left button with a life behind
// the screen): a death now, at 40, 10 s before the window at 50.
state.deployActive = true;
spawning.deployRejoin = true;
const click = btn => btn.on.click.forEach(fn => fn({ stopPropagation() {} }));
click(page.deploySuicideBtn);
out.suicide = { at: r2(round.clock), waiting: spawning.waveWaiting, left: r2(spawning.waveSecondsLeft()),
                soldier: !!state.soldier, stoodAt: tickTo(60) };
// A restart starts the clock over: the old round's wait is gone.
die();
round.restarts = 1; round.clock = 0;
out.afterRestart = commit();
// A room: the server's word (`sw`) is the wait, not the page's own clock.
state.roomJoined = true;
die();
spawning.noteServerSpawnWait(0.2);
out.room = commit();
const t0 = Date.now();
while (Date.now() - t0 < 300) { /* the room's deadline is performance.now()'s */ }
spawning.waveTick();
out.room.stoodAfterWait = !!state.soldier && !state.soldierDead;
process.stdout.write(JSON.stringify(out));
